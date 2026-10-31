use crate::error::AppError;
use chrono::Utc;
use std::fs::File;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone)]
pub struct GitRun {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
}

/// Ejecuta Git sin shell, con timeout y sin abrir consola en Windows.
/// La salida se redirige a archivos temporales para no bloquear pipes.
pub fn run_git(cwd: Option<&Path>, args: &[String], timeout: Duration) -> Result<GitRun, AppError> {
    let stamp = Utc::now().timestamp_nanos_opt().unwrap_or_default();
    let base = std::env::temp_dir().join(format!("flowmanager-git-{}-{stamp}", std::process::id()));
    let stdout_path = base.with_extension("out");
    let stderr_path = base.with_extension("err");

    let stdout_file = File::create(&stdout_path)?;
    let stderr_file = File::create(&stderr_path)?;

    let mut command = Command::new("git");
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never");

    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let started = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|err| AppError::GitUnavailable(format!("No se pudo ejecutar Git: {err}")))?;

    let mut timed_out = false;
    let mut exit_status = None;
    loop {
        match child.try_wait()? {
            Some(status) => {
                exit_status = Some(status);
                break;
            }
            None => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(60));
            }
        }
    }

    let stdout = std::fs::read_to_string(&stdout_path).unwrap_or_default();
    let stderr = std::fs::read_to_string(&stderr_path).unwrap_or_default();
    let _ = std::fs::remove_file(&stdout_path);
    let _ = std::fs::remove_file(&stderr_path);

    if timed_out {
        return Err(AppError::GitTimeout(format!(
            "Git tardó más de {} segundos. Revisa la conexión o las credenciales.",
            timeout.as_secs()
        )));
    }

    let duration_ms = started.elapsed().as_millis();
    Ok(GitRun {
        success: exit_status.map(|status| status.success()).unwrap_or(false),
        stdout: stdout.trim().to_string(),
        stderr: stderr.trim().to_string(),
        duration_ms,
    })
}

pub fn fetch(repo_path: &Path, remote: &str) -> Result<GitRun, AppError> {
    run_git(
        Some(repo_path),
        &[
            "fetch".to_string(),
            "--prune".to_string(),
            remote.to_string(),
        ],
        Duration::from_secs(120),
    )
}

/// Actualiza solo la rama base remota antes de crear una rama nueva.
pub fn fetch_base(repo_path: &Path, remote: &str, base_branch: &str) -> Result<GitRun, AppError> {
    run_git(
        Some(repo_path),
        &[
            "fetch".to_string(),
            "--prune".to_string(),
            remote.to_string(),
            base_branch.to_string(),
        ],
        Duration::from_secs(120),
    )
}

pub fn clone(url: &str, target: &Path) -> Result<GitRun, AppError> {
    validate_clone_url(url)?;
    run_git(
        None,
        &[
            "clone".to_string(),
            "--origin".to_string(),
            "origin".to_string(),
            "--".to_string(),
            url.to_string(),
            target.to_string_lossy().to_string(),
        ],
        Duration::from_secs(300),
    )
}

pub fn validate_clone_url(url: &str) -> Result<(), AppError> {
    let url = url.trim();
    if url.is_empty() {
        return Err(AppError::Validation(
            "La URL del repositorio es obligatoria.".into(),
        ));
    }
    if url.starts_with('-') {
        return Err(AppError::Validation(
            "La URL no puede comenzar con '-'. ".into(),
        ));
    }
    if url.chars().any(|character| character.is_control()) {
        return Err(AppError::Validation(
            "La URL contiene caracteres inválidos.".into(),
        ));
    }
    Ok(())
}

pub fn sanitize_folder_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation(
            "El nombre de la carpeta es obligatorio.".into(),
        ));
    }
    if name == "." || name == ".." || name.starts_with('.') {
        return Err(AppError::Validation(
            "El nombre de la carpeta no es válido.".into(),
        ));
    }
    if name.chars().any(|character| {
        matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        )
    }) {
        return Err(AppError::Validation(
            "El nombre de la carpeta contiene caracteres no permitidos.".into(),
        ));
    }
    Ok(name.to_string())
}

pub fn validate_branch_name(name: &str) -> Result<(), AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation(
            "El nombre de la rama es obligatorio.".into(),
        ));
    }
    let run = run_git(
        None,
        &[
            "check-ref-format".to_string(),
            "--branch".to_string(),
            name.to_string(),
        ],
        Duration::from_secs(10),
    )?;
    if !run.success {
        return Err(AppError::Validation(format!(
            "'{name}' no es un nombre de rama válido para Git."
        )));
    }
    Ok(())
}

pub fn create_branch(
    repo_path: &Path,
    branch_name: &str,
    start_ref: &str,
) -> Result<GitRun, AppError> {
    run_git(
        Some(repo_path),
        &[
            "branch".to_string(),
            branch_name.to_string(),
            start_ref.to_string(),
        ],
        Duration::from_secs(60),
    )
}

pub fn create_tracking_branch(
    repo_path: &Path,
    branch_name: &str,
    remote_ref: &str,
) -> Result<GitRun, AppError> {
    run_git(
        Some(repo_path),
        &[
            "branch".to_string(),
            "--track".to_string(),
            branch_name.to_string(),
            remote_ref.to_string(),
        ],
        Duration::from_secs(60),
    )
}

pub fn delete_local_branch(repo_path: &Path, branch_name: &str) -> Result<GitRun, AppError> {
    run_git(
        Some(repo_path),
        &[
            "branch".to_string(),
            "-D".to_string(),
            branch_name.to_string(),
        ],
        Duration::from_secs(30),
    )
}

pub fn checkout_detached(repo_path: &Path, sha: &str) -> Result<GitRun, AppError> {
    run_git(
        Some(repo_path),
        &[
            "checkout".to_string(),
            "--detach".to_string(),
            sha.to_string(),
        ],
        Duration::from_secs(60),
    )
}

pub fn create_branch_at(
    repo_path: &Path,
    branch_name: &str,
    sha: &str,
) -> Result<GitRun, AppError> {
    run_git(
        Some(repo_path),
        &[
            "branch".to_string(),
            branch_name.to_string(),
            sha.to_string(),
        ],
        Duration::from_secs(30),
    )
}

pub fn update_branch_ref(
    repo_path: &Path,
    branch_name: &str,
    new_sha: &str,
    expected_sha: &str,
) -> Result<GitRun, AppError> {
    run_git(
        Some(repo_path),
        &[
            "update-ref".to_string(),
            format!("refs/heads/{branch_name}"),
            new_sha.to_string(),
            expected_sha.to_string(),
        ],
        Duration::from_secs(30),
    )
}

pub fn remote_branch_sha(
    repo_path: &Path,
    remote: &str,
    branch_name: &str,
) -> Result<Option<String>, AppError> {
    let run = run_git(
        Some(repo_path),
        &[
            "ls-remote".to_string(),
            "--heads".to_string(),
            remote.to_string(),
            format!("refs/heads/{branch_name}"),
        ],
        Duration::from_secs(60),
    )?;
    if !run.success {
        return Err(AppError::GitFailed(run.stderr));
    }
    Ok(run
        .stdout
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().next())
        .map(str::to_string))
}

pub fn push_branch(repo_path: &Path, remote: &str, branch_name: &str) -> Result<GitRun, AppError> {
    run_git(
        Some(repo_path),
        &[
            "push".to_string(),
            "-u".to_string(),
            remote.to_string(),
            branch_name.to_string(),
        ],
        Duration::from_secs(180),
    )
}

/// Empuja exactamente el commit preparado, aunque la rama local esté libre o
/// haya sido abierta por otra herramienta. El nombre remoto se crea/actualiza
/// solo si no existía con otro SHA (validado antes por deployment_push).
pub fn push_branch_at(
    repo_path: &Path,
    remote: &str,
    branch_name: &str,
    sha: &str,
) -> Result<GitRun, AppError> {
    run_git(
        Some(repo_path),
        &[
            "push".to_string(),
            "-u".to_string(),
            remote.to_string(),
            format!("{sha}:refs/heads/{branch_name}"),
        ],
        Duration::from_secs(180),
    )
}

pub fn invalidate_run(run: &GitRun, action: &str) -> AppError {
    let detail = if !run.stderr.is_empty() {
        run.stderr.clone()
    } else if !run.stdout.is_empty() {
        run.stdout.clone()
    } else {
        "Git terminó con un error desconocido.".to_string()
    };
    classify_git_error(action, &detail)
}

pub fn classify_git_error(action: &str, detail: &str) -> AppError {
    let lower = detail.to_lowercase();
    if lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("could not read password")
        || lower.contains("permission denied")
        || lower.contains("terminal prompts disabled")
        || lower.contains("access denied")
    {
        return AppError::GitAuth(format!("{action}: {detail}"));
    }
    AppError::GitFailed(format!("{action}: {detail}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_option_like_urls() {
        assert!(validate_clone_url("--upload-pack=evil").is_err());
        assert!(validate_clone_url("").is_err());
        assert!(validate_clone_url("https://github.com/acme/repo.git").is_ok());
    }

    #[test]
    fn sanitizes_folder_names() {
        assert_eq!(sanitize_folder_name("payments").unwrap(), "payments");
        assert!(sanitize_folder_name("../escape").is_err());
        assert!(sanitize_folder_name("a/b").is_err());
        assert!(sanitize_folder_name("").is_err());
    }

    #[test]
    fn classifies_auth_failures() {
        match classify_git_error("fetch", "fatal: Authentication failed for 'https://...'") {
            AppError::GitAuth(_) => {}
            other => panic!("se esperaba GitAuth, llegó {other:?}"),
        }
    }
}
