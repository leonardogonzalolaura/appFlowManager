use crate::error::AppError;
use chrono::{DateTime, SecondsFormat, Utc};
use git2::{BranchType, Oid, Repository};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCommit {
    pub sha: String,
    pub summary: String,
    pub author: Option<String>,
    pub committed_at: String,
    pub is_foreign: bool,
    /// Rama del requerimiento de la que proviene el commit. Solo se completa en
    /// la selección de commits de un despliegue con repositorios compartidos.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_branch: Option<String>,
    /// Clave del requerimiento dueño de esa rama, para contexto en la UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requirement_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCheck {
    pub branch_name: String,
    pub base_branch: String,
    pub base_ref: String,
    pub base_sha: Option<String>,
    pub local_exists: bool,
    pub remote_exists: bool,
    pub local_sha: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub commits: Vec<BranchCommit>,
    pub warning: Option<String>,
    pub fetched: bool,
    pub fetch_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchFile {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchAnalysis {
    pub branch_name: String,
    pub base_branch: String,
    pub base_ref: String,
    pub status: String,
    pub base_sha: Option<String>,
    pub branch_sha: Option<String>,
    pub merge_base_sha: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub commits: Vec<BranchCommit>,
    pub files: Vec<BranchFile>,
    pub total_additions: usize,
    pub total_deletions: usize,
    pub foreign_commits: usize,
    pub message: String,
}

pub fn check(
    repo_path: &Path,
    remote: &str,
    branch_name: &str,
    base_branch: &str,
    requirement_key: &str,
) -> Result<BranchCheck, AppError> {
    let repo = open(repo_path)?;
    validate_branch_name(branch_name)?;
    let (base_ref, base_oid) = resolve_base(&repo, remote, base_branch)?;
    let local = repo
        .find_branch(branch_name, BranchType::Local)
        .ok()
        .and_then(|branch| branch.get().peel_to_commit().ok());
    let remote_ref_name = format!("refs/remotes/{remote}/{branch_name}");
    let remote_exists = repo.find_reference(&remote_ref_name).is_ok();

    let (local_sha, ahead, behind, commits) = match &local {
        Some(commit) => {
            let (ahead, behind) = repo
                .graph_ahead_behind(commit.id(), base_oid)
                .unwrap_or((0, 0));
            (
                Some(commit.id().to_string()),
                ahead,
                behind,
                collect_commits(&repo, commit.id(), base_oid, requirement_key, 20),
            )
        }
        None => (None, 0, 0, Vec::new()),
    };

    let warning = if local.is_some() && ahead > 0 {
        Some(format!(
            "La rama local ya existe y tiene {ahead} commit(s) que no están en {base_branch}. Decide si conservarla."
        ))
    } else if local.is_some() {
        Some(format!(
            "La rama local ya existe, pero no tiene commits propios respecto a {base_branch}."
        ))
    } else if remote_exists {
        Some(format!(
            "La rama ya existe en {remote}. Se puede conservar creando una copia local sin sobrescribir el remoto."
        ))
    } else {
        None
    };

    Ok(BranchCheck {
        branch_name: branch_name.to_string(),
        base_branch: base_branch.to_string(),
        base_ref,
        base_sha: Some(base_oid.to_string()),
        local_exists: local.is_some(),
        remote_exists,
        local_sha,
        ahead,
        behind,
        commits,
        warning,
        fetched: false,
        fetch_error: None,
    })
}

pub fn analyze(
    repo_path: &Path,
    remote: &str,
    branch_name: &str,
    base_branch: &str,
    requirement_key: &str,
) -> Result<BranchAnalysis, AppError> {
    let repo = open(repo_path)?;
    let (base_ref, base_oid) = resolve_base(&repo, remote, base_branch)?;
    let base_commit = repo.find_commit(base_oid)?;

    let Some(branch_commit) = repo
        .find_branch(branch_name, BranchType::Local)
        .ok()
        .and_then(|branch| branch.get().peel_to_commit().ok())
    else {
        return Ok(BranchAnalysis {
            branch_name: branch_name.to_string(),
            base_branch: base_branch.to_string(),
            base_ref,
            status: "branch_missing".into(),
            base_sha: Some(base_oid.to_string()),
            branch_sha: None,
            merge_base_sha: None,
            ahead: 0,
            behind: 0,
            commits: Vec::new(),
            files: Vec::new(),
            total_additions: 0,
            total_deletions: 0,
            foreign_commits: 0,
            message: format!("La rama local '{branch_name}' no existe todavía."),
        });
    };

    let (ahead, behind) = repo
        .graph_ahead_behind(branch_commit.id(), base_oid)
        .unwrap_or((0, 0));
    let commits = collect_commits(&repo, branch_commit.id(), base_oid, requirement_key, 200);
    let foreign_commits = commits.iter().filter(|commit| commit.is_foreign).count();
    let merge_base_sha = repo
        .merge_base(branch_commit.id(), base_oid)
        .ok()
        .map(|oid| oid.to_string());

    let mut files = Vec::new();
    let mut total_additions = 0;
    let mut total_deletions = 0;

    if ahead > 0 {
        let base_tree = base_commit.tree()?;
        let branch_tree = branch_commit.tree()?;
        let diff = repo.diff_tree_to_tree(Some(&base_tree), Some(&branch_tree), None)?;
        let stats = diff.stats()?;
        total_additions = stats.insertions();
        total_deletions = stats.deletions();

        for delta in diff.deltas().take(500) {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_else(|| "(sin ruta)".into());
            files.push(BranchFile {
                path,
                status: delta_status(delta.status()),
            });
        }
    }

    Ok(BranchAnalysis {
        branch_name: branch_name.to_string(),
        base_branch: base_branch.to_string(),
        base_ref,
        status: if ahead == 0 { "no_commits" } else { "ok" }.into(),
        base_sha: Some(base_oid.to_string()),
        branch_sha: Some(branch_commit.id().to_string()),
        merge_base_sha,
        ahead,
        behind,
        commits,
        files,
        total_additions,
        total_deletions,
        foreign_commits,
        message: if ahead == 0 {
            format!(
                "La rama existe pero no tiene commits respecto a {base_branch}. No se debe desplegar todavía."
            )
        } else {
            format!("{ahead} commit(s) listos para preparar el despliegue.")
        },
    })
}

fn open(repo_path: &Path) -> Result<Repository, AppError> {
    Repository::open(repo_path).map_err(|error| {
        AppError::NotARepository(format!("{}: {}", repo_path.display(), error.message()))
    })
}

pub fn resolve_base(
    repo: &Repository,
    remote: &str,
    base_branch: &str,
) -> Result<(String, Oid), AppError> {
    let remote_ref_name = format!("refs/remotes/{remote}/{base_branch}");
    if let Ok(reference) = repo.find_reference(&remote_ref_name) {
        if let Ok(commit) = reference.peel_to_commit() {
            return Ok((remote_ref_name, commit.id()));
        }
    }

    let local_ref_name = format!("refs/heads/{base_branch}");
    if let Ok(reference) = repo.find_reference(&local_ref_name) {
        if let Ok(commit) = reference.peel_to_commit() {
            return Ok((local_ref_name, commit.id()));
        }
    }

    Err(AppError::BranchNotFound(format!(
        "La rama base '{base_branch}' no existe en local ni en {remote}."
    )))
}

fn collect_commits(
    repo: &Repository,
    branch_oid: Oid,
    base_oid: Oid,
    requirement_key: &str,
    limit: usize,
) -> Vec<BranchCommit> {
    let Ok(mut walk) = repo.revwalk() else {
        return Vec::new();
    };
    if walk.push(branch_oid).is_err() || walk.hide(base_oid).is_err() {
        return Vec::new();
    }

    let mut commits = Vec::new();
    for oid in walk.flatten().take(limit) {
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };
        let summary = commit.summary().unwrap_or("(sin mensaje)").to_string();
        let full_message = commit.message().unwrap_or("");
        let committed_at = DateTime::<Utc>::from_timestamp(commit.time().seconds(), 0)
            .unwrap_or_else(Utc::now)
            .to_rfc3339_opts(SecondsFormat::Secs, true);
        commits.push(BranchCommit {
            sha: oid.to_string(),
            summary,
            author: commit.author().name().map(str::to_string),
            committed_at,
            is_foreign: !requirement_key.is_empty()
                && !full_message
                    .to_lowercase()
                    .contains(&requirement_key.to_lowercase()),
            source_branch: None,
            requirement_key: None,
        });
    }
    commits
}

/// Carga commits de una rama de requerimiento respecto a la rama base del ambiente.
/// Se usa en on-demand cuando el usuario quiere seleccionar commits específicos.
pub fn collect_deployment_commits(
    repo_path: &Path,
    branch_name: &str,
    target_branch: &str,
    target_sha: &Option<String>,
    requirement_key: &str,
) -> Result<Vec<BranchCommit>, crate::error::AppError> {
    let repo = open(repo_path)?;
    
    // Resolver la rama local del requerimiento
    let branch_commit = repo
        .find_branch(branch_name, BranchType::Local)
        .ok()
        .and_then(|branch| branch.get().peel_to_commit().ok())
        .ok_or_else(|| crate::error::AppError::Validation(
            format!("La rama '{branch_name}' no existe localmente.")
        ))?;
    
    // Resolver la rama base del ambiente
    let base_oid = if let Some(sha) = target_sha.as_ref() {
        // Si tenemos el SHA exacto, úsalo
        repo.revparse_single(sha)
            .ok()
            .and_then(|obj| obj.peel_to_commit().ok())
            .map(|commit| commit.id())
            .ok_or_else(|| crate::error::AppError::Validation(
                format!("No se puede resolver el SHA '{sha}'")
            ))?
    } else {
        // Si no, intenta resolver la rama
        let (_, oid) = resolve_base(&repo, "origin", target_branch)?;
        oid
    };
    
    // Recolectar commits
    Ok(collect_commits(
        &repo,
        branch_commit.id(),
        base_oid,
        requirement_key,
        50, // Mostrar hasta 50 commits
    ))
}

fn delta_status(status: git2::Delta) -> String {
    match status {
        git2::Delta::Added => "A",
        git2::Delta::Deleted => "D",
        git2::Delta::Modified => "M",
        git2::Delta::Renamed => "R",
        git2::Delta::Copied => "C",
        _ => "?",
    }
    .to_string()
}

fn validate_branch_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation(
            "El nombre de la rama es obligatorio.".into(),
        ));
    }
    if name.contains(' ') || name.starts_with('-') || name.contains("..") {
        return Err(AppError::Validation(format!(
            "'{name}' no es un nombre de rama válido."
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;

    fn init_repo(path: &Path) -> git2::Repository {
        let repo = git2::Repository::init(path).expect("init");
        std::fs::write(path.join("README.md"), "# demo\n").expect("write");
        let mut index = repo.index().expect("index");
        index.add_path(Path::new("README.md")).expect("add");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("tree");
        let tree = repo.find_tree(tree_id).expect("tree");
        let sig = Signature::now("Test", "test@flow.local").expect("sig");
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .expect("commit");
        let commit = repo.find_commit(oid).expect("commit");
        if repo.find_branch("master", BranchType::Local).is_err() {
            repo.branch("master", &commit, false).expect("master");
        }
        drop(commit);
        drop(tree);
        repo
    }

    fn add_commit(repo: &git2::Repository, branch: &str, message: &str) {
        let parent = repo
            .find_branch(branch, BranchType::Local)
            .expect("branch")
            .get()
            .peel_to_commit()
            .expect("commit");
        let tree = parent.tree().expect("tree");
        let sig = Signature::now("Test", "test@flow.local").expect("sig");
        let oid = repo
            .commit(
                Some(&format!("refs/heads/{branch}")),
                &sig,
                &sig,
                message,
                &tree,
                &[&parent],
            )
            .expect("commit");
        let _ = oid;
    }

    #[test]
    fn check_and_analyze_local_branch() {
        let dir = tempfile::tempdir().expect("temp");
        let path = dir.path();
        let repo = init_repo(path);

        let initial = check(path, "origin", "BPIM-183", "master", "BPIM-183").expect("check");
        assert!(!initial.local_exists);
        assert!(!initial.remote_exists);
        assert_eq!(initial.ahead, 0);

        let run = crate::infra::git_cli::create_branch(path, "BPIM-183", "refs/heads/master")
            .expect("create");
        assert!(run.success, "{}", run.stderr);

        let created = check(path, "origin", "BPIM-183", "master", "BPIM-183").expect("check");
        assert!(created.local_exists);
        assert_eq!(created.ahead, 0);

        let no_commits =
            analyze(path, "origin", "BPIM-183", "master", "BPIM-183").expect("analyze");
        assert_eq!(no_commits.status, "no_commits");
        assert!(no_commits.commits.is_empty());

        add_commit(&repo, "BPIM-183", "feat(BPIM-183): retry payment");
        let analysis = analyze(path, "origin", "BPIM-183", "master", "BPIM-183").expect("analyze");
        assert_eq!(analysis.status, "ok");
        assert_eq!(analysis.ahead, 1);
        assert_eq!(analysis.commits.len(), 1);
        assert!(!analysis.commits[0].is_foreign);
    }

    #[test]
    fn recreate_branch_starts_from_base() {
        let dir = tempfile::tempdir().expect("temp");
        let path = dir.path();
        let repo = init_repo(path);
        crate::infra::git_cli::create_branch(path, "BPIM-900", "refs/heads/master")
            .expect("create");
        add_commit(&repo, "BPIM-900", "feat: old work");

        let check_before = check(path, "origin", "BPIM-900", "master", "BPIM-900").expect("check");
        assert_eq!(check_before.ahead, 1);

        let delete = crate::infra::git_cli::delete_local_branch(path, "BPIM-900").expect("delete");
        assert!(delete.success, "{}", delete.stderr);
        let recreate = crate::infra::git_cli::create_branch(path, "BPIM-900", "refs/heads/master")
            .expect("recreate");
        assert!(recreate.success, "{}", recreate.stderr);

        let analysis = analyze(path, "origin", "BPIM-900", "master", "BPIM-900")
            .expect("analyze after recreate");
        assert_eq!(analysis.status, "no_commits");
    }

    #[test]
    fn analyses_missing_branch_without_error() {
        let dir = tempfile::tempdir().expect("temp");
        let path = dir.path();
        init_repo(path);
        let analysis = analyze(path, "origin", "BPIM-404", "master", "BPIM-404").expect("analyze");
        assert_eq!(analysis.status, "branch_missing");
    }
}
