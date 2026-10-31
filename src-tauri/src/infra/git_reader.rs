use crate::domain::branch_resolver::BranchRef;
use crate::error::AppError;
use chrono::{DateTime, Utc};
use git2::{BranchType, Repository};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct RepoSnapshot {
    pub branches: Vec<BranchRef>,
    pub remote_url: Option<String>,
    pub remote_name: Option<String>,
    pub default_branch: String,
    pub head_branch: Option<String>,
    pub path_warning: Option<String>,
}

pub fn read_snapshot(path: &Path) -> Result<RepoSnapshot, AppError> {
    let repo = Repository::open(path).map_err(|err| {
        AppError::NotARepository(format!(
            "{} no es un repositorio Git válido: {}",
            path.display(),
            err.message()
        ))
    })?;

    if repo.is_bare() {
        return Err(AppError::NotARepository(
            "La ruta apunta a un repositorio bare; se necesita una copia de trabajo.".into(),
        ));
    }

    let (remote_name, remote_url) = pick_remote(&repo);
    let mut branches = BTreeMap::<String, BranchRef>::new();

    if let Some(remote) = remote_name.as_deref() {
        let prefix = format!("{remote}/");
        if let Ok(iter) = repo.branches(Some(BranchType::Remote)) {
            for item in iter.flatten() {
                let (branch, _) = item;
                let Some(name) = branch.name().ok().flatten() else {
                    continue;
                };
                let Some(stripped) = name.strip_prefix(&prefix) else {
                    continue;
                };
                if stripped.eq_ignore_ascii_case("HEAD") {
                    continue;
                }
                if let Some(reference) = branch_to_ref(&branch, stripped, true) {
                    branches.insert(stripped.to_string(), reference);
                }
            }
        }
    }

    // Las ramas locales completan el selector y permiten trabajar en repos
    // sin remoto. Si existe la misma rama en origin, gana la remota.
    if let Ok(iter) = repo.branches(Some(BranchType::Local)) {
        for item in iter.flatten() {
            let (branch, _) = item;
            let Some(name) = branch.name().ok().flatten() else {
                continue;
            };
            if branches.contains_key(name) {
                continue;
            }
            if let Some(reference) = branch_to_ref(&branch, name, false) {
                branches.insert(name.to_string(), reference);
            }
        }
    }

    let head_branch = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_string))
        .filter(|name| name != "HEAD");

    let default_branch = find_default_branch(&repo, remote_name.as_deref())
        .or_else(|| {
            ["master", "main"]
                .into_iter()
                .find(|candidate| branches.contains_key(*candidate))
                .map(str::to_string)
        })
        .or_else(|| {
            branches
                .values()
                .find(|branch| !branch.is_remote)
                .map(|branch| branch.name.clone())
        })
        .or_else(|| head_branch.clone())
        .unwrap_or_else(|| "master".to_string());

    let path_warning = path_warning(path);

    Ok(RepoSnapshot {
        branches: branches.into_values().collect(),
        remote_url,
        remote_name,
        default_branch,
        head_branch,
        path_warning,
    })
}

fn pick_remote(repo: &Repository) -> (Option<String>, Option<String>) {
    if let Ok(remote) = repo.find_remote("origin") {
        return (Some("origin".to_string()), remote.url().map(str::to_string));
    }

    if let Ok(names) = repo.remotes() {
        if let Some(name) = names.iter().flatten().next() {
            if let Ok(remote) = repo.find_remote(name) {
                return (Some(name.to_string()), remote.url().map(str::to_string));
            }
        }
    }

    (None, None)
}

fn branch_to_ref(branch: &git2::Branch<'_>, name: &str, is_remote: bool) -> Option<BranchRef> {
    let commit = branch.get().peel_to_commit().ok()?;
    let committed_at =
        DateTime::<Utc>::from_timestamp(commit.time().seconds(), 0).unwrap_or_else(Utc::now);
    let author = commit.author().name().map(str::to_string);
    let message = commit.summary().map(str::to_string);

    Some(BranchRef {
        name: name.to_string(),
        sha: commit.id().to_string(),
        committed_at,
        author,
        message,
        is_remote,
    })
}

fn find_default_branch(repo: &Repository, remote: Option<&str>) -> Option<String> {
    if let Some(remote) = remote {
        let reference = format!("refs/remotes/{remote}/HEAD");
        if let Ok(reference) = repo.find_reference(&reference) {
            if let Some(target) = reference.symbolic_target() {
                let prefix = format!("refs/remotes/{remote}/");
                return target.strip_prefix(&prefix).map(str::to_string);
            }
        }
    }

    if let Ok(head) = repo.head() {
        if let Some(name) = head.shorthand() {
            return Some(name.to_string());
        }
    }

    None
}

pub fn path_warning(path: &Path) -> Option<String> {
    let lower = path.to_string_lossy().to_lowercase();
    if lower.contains("onedrive") {
        return Some(
            "La ruta está dentro de OneDrive. Los archivos sincronizados pueden bloquear operaciones de Git; se recomienda una carpeta local."
                .into(),
        );
    }

    if let Ok(root) = std::env::var("OneDrive") {
        if !root.trim().is_empty() && path.to_string_lossy().starts_with(&root) {
            return Some(
                "La ruta está dentro de OneDrive. Los archivos sincronizados pueden bloquear operaciones de Git; se recomienda una carpeta local."
                    .into(),
            );
        }
    }

    None
}

/// Extrae owner/repo de las URLs habituales de GitHub.
pub fn github_slug(url: &str) -> Option<(String, String)> {
    let normalized = url.trim().trim_end_matches('/').trim_end_matches(".git");

    let after_host = if let Some((_, rest)) = normalized.split_once("github.com/") {
        rest
    } else if let Some(rest) = normalized.strip_prefix("git@github.com:") {
        rest
    } else {
        return None;
    };

    let after_host = after_host.trim_start_matches('/');
    let mut parts = after_host.split('/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_github_https_urls() {
        assert_eq!(
            github_slug("https://github.com/acme/payments.git"),
            Some(("acme".into(), "payments".into()))
        );
        assert_eq!(
            github_slug("https://github.com/acme/payments/"),
            Some(("acme".into(), "payments".into()))
        );
    }

    #[test]
    fn parses_github_ssh_urls() {
        assert_eq!(
            github_slug("git@github.com:acme/payments.git"),
            Some(("acme".into(), "payments".into()))
        );
        assert_eq!(
            github_slug("ssh://git@github.com/acme/payments.git"),
            Some(("acme".into(), "payments".into()))
        );
    }

    #[test]
    fn ignores_non_github_remotes() {
        assert_eq!(github_slug("https://gitlab.com/acme/payments.git"), None);
    }

    #[test]
    fn detects_onedrive_paths() {
        assert!(path_warning(Path::new(r"C:\Users\me\OneDrive\repo")).is_some());
        assert!(path_warning(Path::new(r"C:\work\repo")).is_none());
    }
}
