use crate::error::AppError;
use crate::infra::git_cli::{run_git, GitRun};
use std::path::Path;
use std::time::Duration;

pub fn create_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    branch: &str,
    base_ref: &str,
) -> Result<GitRun, AppError> {
    run_git(
        Some(repo_path),
        &[
            "worktree".to_string(),
            "add".to_string(),
            "-b".to_string(),
            branch.to_string(),
            worktree_path.to_string_lossy().to_string(),
            base_ref.to_string(),
        ],
        Duration::from_secs(120),
    )
}

pub fn remove_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    branch: &str,
) -> Result<(), AppError> {
    let _ = run_git(
        Some(repo_path),
        &[
            "worktree".to_string(),
            "remove".to_string(),
            "--force".to_string(),
            worktree_path.to_string_lossy().to_string(),
        ],
        Duration::from_secs(60),
    )?;
    let _ = run_git(
        Some(repo_path),
        &["branch".to_string(), "-D".to_string(), branch.to_string()],
        Duration::from_secs(30),
    )?;
    Ok(())
}

pub fn merge_squash(worktree: &Path, branch: &str) -> Result<GitRun, AppError> {
    run_git(
        Some(worktree),
        &[
            "merge".to_string(),
            "--squash".to_string(),
            branch.to_string(),
        ],
        Duration::from_secs(180),
    )
}

pub fn cherry_pick_no_commit(worktree: &Path, sha: &str) -> Result<GitRun, AppError> {
    run_git(
        Some(worktree),
        &["cherry-pick".to_string(), "-n".to_string(), sha.to_string()],
        Duration::from_secs(120),
    )
}

pub fn cherry_pick_quit(worktree: &Path) -> Result<(), AppError> {
    let _ = run_git(
        Some(worktree),
        &["cherry-pick".to_string(), "--quit".to_string()],
        Duration::from_secs(15),
    )?;
    Ok(())
}

pub fn unmerged_files(worktree: &Path) -> Result<Vec<String>, AppError> {
    let run = run_git(
        Some(worktree),
        &[
            "diff".to_string(),
            "--name-only".to_string(),
            "--diff-filter=U".to_string(),
            "-z".to_string(),
        ],
        Duration::from_secs(30),
    )?;
    if !run.success {
        return Ok(Vec::new());
    }
    Ok(run
        .stdout
        .split('\0')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect())
}

pub fn has_staged_changes(worktree: &Path) -> Result<bool, AppError> {
    let run = run_git(
        Some(worktree),
        &[
            "diff".to_string(),
            "--cached".to_string(),
            "--name-only".to_string(),
            "-z".to_string(),
        ],
        Duration::from_secs(30),
    )?;
    Ok(!run.stdout.trim_matches('\0').is_empty())
}

pub fn commit_wip(worktree: &Path, label: &str) -> Result<GitRun, AppError> {
    run_git(
        Some(worktree),
        &[
            "commit".to_string(),
            "-m".to_string(),
            format!("wip: {label}"),
        ],
        Duration::from_secs(60),
    )
}

pub fn commit_final(worktree: &Path, message: &str) -> Result<GitRun, AppError> {
    let path = std::env::temp_dir().join(format!(
        "flowmanager-squash-{}-{}.txt",
        std::process::id(),
        uuid::Uuid::now_v7()
    ));
    std::fs::write(&path, message)?;
    let result = run_git(
        Some(worktree),
        &[
            "commit".to_string(),
            "-F".to_string(),
            path.to_string_lossy().to_string(),
        ],
        Duration::from_secs(60),
    );
    let _ = std::fs::remove_file(path);
    result
}

pub fn soft_reset(worktree: &Path, base_sha: &str) -> Result<GitRun, AppError> {
    run_git(
        Some(worktree),
        &[
            "reset".to_string(),
            "--soft".to_string(),
            base_sha.to_string(),
        ],
        Duration::from_secs(30),
    )
}

pub fn hard_reset_clean(worktree: &Path, base_sha: &str) -> Result<(), AppError> {
    let _ = run_git(
        Some(worktree),
        &[
            "reset".to_string(),
            "--hard".to_string(),
            base_sha.to_string(),
        ],
        Duration::from_secs(60),
    )?;
    let _ = run_git(
        Some(worktree),
        &["clean".to_string(), "-fd".to_string()],
        Duration::from_secs(60),
    )?;
    Ok(())
}

pub fn stage_file(worktree: &Path, file: &str) -> Result<GitRun, AppError> {
    run_git(
        Some(worktree),
        &["add".to_string(), "--".to_string(), file.to_string()],
        Duration::from_secs(30),
    )
}

pub fn stage_all(worktree: &Path) -> Result<GitRun, AppError> {
    run_git(
        Some(worktree),
        &["add".to_string(), "-A".to_string()],
        Duration::from_secs(60),
    )
}

pub fn head_sha(worktree: &Path) -> Result<String, AppError> {
    let run = run_git(
        Some(worktree),
        &["rev-parse".to_string(), "HEAD".to_string()],
        Duration::from_secs(15),
    )?;
    if !run.success {
        return Err(AppError::GitFailed(run.stderr));
    }
    Ok(run
        .stdout
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string())
}

pub fn head_is_detached(worktree: &Path) -> Result<bool, AppError> {
    let run = run_git(
        Some(worktree),
        &[
            "symbolic-ref".to_string(),
            "-q".to_string(),
            "HEAD".to_string(),
        ],
        Duration::from_secs(15),
    )?;
    Ok(!run.success)
}

pub fn diff_stat(worktree: &Path, base_sha: &str) -> Result<(usize, usize, usize), AppError> {
    diff_stat_between(worktree, base_sha, "HEAD")
}

/// (archivos, adiciones, eliminaciones) entre dos revisiones.
pub fn diff_stat_between(
    repo_path: &Path,
    from: &str,
    to: &str,
) -> Result<(usize, usize, usize), AppError> {
    let run = run_git(
        Some(repo_path),
        &[
            "diff".to_string(),
            "--numstat".to_string(),
            format!("{from}..{to}"),
        ],
        Duration::from_secs(30),
    )?;
    if !run.success {
        return Ok((0, 0, 0));
    }

    let mut files = 0;
    let mut additions = 0;
    let mut deletions = 0;
    for line in run.stdout.lines() {
        let mut parts = line.split('\t');
        let add = parts.next().unwrap_or("0");
        let del = parts.next().unwrap_or("0");
        if parts.next().is_none() {
            continue;
        }
        files += 1;
        additions += add.parse::<usize>().unwrap_or(0);
        deletions += del.parse::<usize>().unwrap_or(0);
    }
    Ok((files, additions, deletions))
}

/// Archivos que difieren entre dos revisiones.
pub fn changed_files(
    repo_path: &Path,
    from: &str,
    to: &str,
) -> Result<Vec<String>, AppError> {
    let run = run_git(
        Some(repo_path),
        &[
            "diff".to_string(),
            "--name-only".to_string(),
            "-z".to_string(),
            format!("{from}..{to}"),
        ],
        Duration::from_secs(60),
    )?;
    if !run.success {
        return Ok(Vec::new());
    }
    Ok(run
        .stdout
        .split('\0')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect())
}

/// Archivos que difieren entre dos revisiones ignorando espacios y líneas en
/// blanco. Sirve para saber si un commit solo aporta ruido de formato.
pub fn changed_files_ignoring_space(
    repo_path: &Path,
    from: &str,
    to: &str,
) -> Result<Vec<String>, AppError> {
    let run = run_git(
        Some(repo_path),
        &[
            "diff".to_string(),
            "--name-only".to_string(),
            "-z".to_string(),
            "--ignore-all-space".to_string(),
            "--ignore-blank-lines".to_string(),
            format!("{from}..{to}"),
        ],
        Duration::from_secs(60),
    )?;
    if !run.success {
        return Ok(Vec::new());
    }
    Ok(run
        .stdout
        .split('\0')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect())
}

/// SHA del blob de `path` en `rev`, o None si el archivo no existe allí.
pub fn blob_id(
    repo_path: &Path,
    rev: &str,
    path: &str,
) -> Result<Option<String>, AppError> {
    let run = run_git(
        Some(repo_path),
        &[
            "rev-parse".to_string(),
            "--verify".to_string(),
            format!("{rev}:{path}"),
        ],
        Duration::from_secs(15),
    )?;
    if run.success {
        Ok(Some(
            run.stdout
                .lines()
                .next()
                .unwrap_or_default()
                .trim()
                .to_string(),
        ))
    } else {
        Ok(None)
    }
}

/// Archivos del índice que todavía conservan marcadores de conflicto.
pub fn conflict_marker_files(worktree: &Path) -> Result<Vec<String>, AppError> {
    let run = run_git(
        Some(worktree),
        &[
            "diff".to_string(),
            "--cached".to_string(),
            "--name-only".to_string(),
            "-z".to_string(),
        ],
        Duration::from_secs(30),
    )?;
    if !run.success {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for file in run
        .stdout
        .split('\0')
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let staged = run_git(
            Some(worktree),
            &["show".to_string(), format!(":{file}")],
            Duration::from_secs(15),
        )?;
        if !staged.success {
            continue;
        }
        let has_marker = staged
            .stdout
            .lines()
            .any(|line| line.starts_with("<<<<<<<") || line.starts_with(">>>>>>>"));
        if has_marker {
            files.push(file.to_string());
        }
    }
    Ok(files)
}

/// Indica si el índice agrega cambios además de líneas **completamente
/// vacías**. Evita crear commits con solo líneas en blanco (típico al borrar
/// marcadores de conflicto) sin descartar cambios reales: un espacio dentro de
/// un string o un cambio de indentación sí cuentan.
pub fn has_meaningful_staged_changes(worktree: &Path) -> Result<bool, AppError> {
    let run = run_git(
        Some(worktree),
        &[
            "diff".to_string(),
            "--cached".to_string(),
            "--numstat".to_string(),
            "--ignore-blank-lines".to_string(),
        ],
        Duration::from_secs(30),
    )?;
    Ok(!run.stdout.trim().is_empty())
}

/// Toma la versión del ambiente (ours) o del requerimiento (theirs) para un
/// archivo en conflicto. No hace stage: lo hace el llamador.
pub fn checkout_conflict_side(
    worktree: &Path,
    file: &str,
    side: &str,
) -> Result<GitRun, AppError> {
    let flag = if side == "ours" { "--ours" } else { "--theirs" };
    run_git(
        Some(worktree),
        &[
            "checkout".to_string(),
            flag.to_string(),
            "--".to_string(),
            file.to_string(),
        ],
        Duration::from_secs(30),
    )
}

pub fn rev_parse(repo_path: &Path, rev: &str) -> Result<Option<String>, AppError> {
    let run = run_git(
        Some(repo_path),
        &[
            "rev-parse".to_string(),
            "--verify".to_string(),
            format!("{rev}^{{commit}}"),
        ],
        Duration::from_secs(15),
    )?;
    if run.success {
        Ok(Some(
            run.stdout
                .lines()
                .next()
                .unwrap_or_default()
                .trim()
                .to_string(),
        ))
    } else {
        Ok(None)
    }
}

pub fn commit_is_merge(repo_path: &Path, sha: &str) -> Result<bool, AppError> {
    let run = run_git(
        Some(repo_path),
        &[
            "rev-list".to_string(),
            "--parents".to_string(),
            "-n".to_string(),
            "1".to_string(),
            sha.to_string(),
        ],
        Duration::from_secs(15),
    )?;
    if !run.success {
        return Ok(false);
    }
    Ok(run.stdout.split_whitespace().count() > 2)
}

/// Devuelve (timestamp, resumen) del commit.
pub fn commit_meta(repo_path: &Path, sha: &str) -> Result<(i64, String), AppError> {
    let run = run_git(
        Some(repo_path),
        &[
            "show".to_string(),
            "-s".to_string(),
            "--format=%ct%x00%s".to_string(),
            sha.to_string(),
        ],
        Duration::from_secs(15),
    )?;
    if !run.success {
        return Err(AppError::GitFailed(run.stderr));
    }
    let mut parts = run.stdout.split('\0');
    let timestamp = parts
        .next()
        .unwrap_or("0")
        .trim()
        .parse::<i64>()
        .unwrap_or(0);
    let summary = parts.next().unwrap_or("").trim().to_string();
    Ok((timestamp, summary))
}

/// `true` si `ancestor` ya está contenido en `descendant`. Es la evidencia
/// más fuerte de que un commit llegó al ambiente sin squash de por medio.
pub fn is_ancestor(
    repo_path: &Path,
    ancestor: &str,
    descendant: &str,
) -> Result<bool, AppError> {
    let run = run_git(
        Some(repo_path),
        &[
            "merge-base".to_string(),
            "--is-ancestor".to_string(),
            ancestor.to_string(),
            descendant.to_string(),
        ],
        Duration::from_secs(30),
    )?;
    Ok(run.success)
}

/// Subconjunto de `paths` cuyo contenido difiere entre `from` y `to`.
/// Una sola llamada a Git aunque la lista tenga decenas de archivos.
pub fn differing_files(
    repo_path: &Path,
    from: &str,
    to: &str,
    paths: &[String],
) -> Result<Vec<String>, AppError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let mut args = vec![
        "diff".to_string(),
        "--name-only".to_string(),
        "-z".to_string(),
        "--no-renames".to_string(),
        from.to_string(),
        to.to_string(),
        "--".to_string(),
    ];
    args.extend(paths.iter().cloned());
    let run = run_git(Some(repo_path), &args, Duration::from_secs(60))?;
    if !run.success {
        return Err(AppError::GitFailed(run.stderr));
    }
    Ok(run
        .stdout
        .split('\0')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect())
}

/// Mapa `refname -> sha` de todas las referencias locales. Permite resolver
/// muchas ramas con una sola invocación de Git.
pub fn ref_map(repo_path: &Path) -> Result<std::collections::HashMap<String, String>, AppError> {
    let run = run_git(
        Some(repo_path),
        &[
            "for-each-ref".to_string(),
            "--format=%(refname)%09%(objectname)".to_string(),
        ],
        Duration::from_secs(30),
    )?;
    let mut map = std::collections::HashMap::new();
    if !run.success {
        return Ok(map);
    }
    for line in run.stdout.lines() {
        let Some((name, sha)) = line.split_once('\t') else {
            continue;
        };
        map.insert(name.trim().to_string(), sha.trim().to_string());
    }
    Ok(map)
}

/// Archivos que difieren entre `head` y el punto donde se separó de `base`
/// (equivalente a `git diff --name-only base...head`). Una sola invocación.
pub fn changed_files_since_merge_base(
    repo_path: &Path,
    base: &str,
    head: &str,
) -> Result<Vec<String>, AppError> {
    let run = run_git(
        Some(repo_path),
        &[
            "diff".to_string(),
            "--name-only".to_string(),
            "-z".to_string(),
            format!("{base}...{head}"),
        ],
        Duration::from_secs(60),
    )?;
    if !run.success {
        return Ok(Vec::new());
    }
    Ok(run
        .stdout
        .split('\0')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect())
}

pub fn worktree_exists(path: &Path) -> bool {
    path.is_dir() && path.join(".git").exists()
}

pub fn validate_inside(worktree: &Path, relative: &str) -> Result<(), AppError> {
    let candidate = worktree.join(relative);
    let canonical = std::fs::canonicalize(&candidate)?;
    let root = std::fs::canonicalize(worktree)?;
    if !canonical.starts_with(&root) {
        return Err(AppError::Validation(
            "El archivo está fuera del worktree.".into(),
        ));
    }
    Ok(())
}
