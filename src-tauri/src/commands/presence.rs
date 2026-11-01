use crate::error::{ApiError, AppError};
use crate::infra::squash_ops;
use crate::state::AppState;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::Path;
use tauri::State;

/// Estado de un requerimiento en un ambiente concreto.
///
/// La comparación es por **contenido**, no por SHA: un squash merge cambia el
/// commit, así que preguntar "¿existe este SHA en la rama?" daría falsos
/// negativos casi siempre.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentPresence {
    pub environment: String,
    pub label: String,
    pub color: Option<String>,
    pub branch: Option<String>,
    /// `applied` | `partial` | `pending` | `unknown` | `no_changes`
    pub status: String,
    pub files_total: usize,
    pub files_applied: usize,
    pub files_pending: usize,
    /// `ancestry` | `content` | `none`
    pub evidence: String,
    pub pending_files: Vec<String>,
    pub pushed_at: Option<String>,
    pub pushed_branch: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPresence {
    pub repository_id: String,
    pub repository_name: String,
    pub branch_name: String,
    pub branch_status: String,
    pub environments: Vec<EnvironmentPresence>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementPresence {
    pub requirement_id: String,
    pub external_key: String,
    pub repositories: Vec<RepositoryPresence>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct MappingRow {
    repository_id: String,
    repository_name: String,
    local_path: String,
    remote_name: String,
    base_branch: String,
    branch_name: String,
    branch_status: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct EnvRow {
    environment: String,
    label: String,
    color: Option<String>,
    branch_name: Option<String>,
    resolved_sha: Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct HistoryRow {
    environment: String,
    deploy_branch: Option<String>,
    deploy_sha: Option<String>,
    pushed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PresenceCounts {
    total: usize,
    applied: usize,
    pending: usize,
    status: &'static str,
}

#[tauri::command]
pub async fn environment_status(
    state: State<'_, AppState>,
    requirement_ids: Vec<String>,
) -> Result<Vec<RequirementPresence>, ApiError> {
    let pool = state.pool()?;
    let mut result = Vec::new();
    for requirement_id in requirement_ids {
        result.push(build_requirement_presence(pool, &requirement_id).await?);
    }
    Ok(result)
}

async fn build_requirement_presence(
    pool: &SqlitePool,
    requirement_id: &str,
) -> Result<RequirementPresence, AppError> {
    let external_key: Option<String> =
        sqlx::query_scalar("SELECT external_key FROM requirements WHERE id = ?1")
            .bind(requirement_id)
            .fetch_optional(pool)
            .await?;
    let Some(external_key) = external_key else {
        return Err(AppError::NotFound("el requerimiento".into()));
    };

    let mappings = sqlx::query_as::<_, MappingRow>(
        "SELECT rr.repository_id, r.name AS repository_name, r.local_path,
                r.remote_name, r.base_branch,
                rr.branch_name, rr.branch_status
         FROM requirement_repositories rr
         JOIN repositories r ON r.id = rr.repository_id
         WHERE rr.requirement_id = ?1 AND r.is_active = 1
         ORDER BY r.name COLLATE NOCASE",
    )
    .bind(requirement_id)
    .fetch_all(pool)
    .await?;

    let mut repositories = Vec::new();
    let mut tasks = tokio::task::JoinSet::new();
    for mapping in mappings {
        let pool = pool.clone();
        let requirement_id = requirement_id.to_string();
        tasks.spawn(async move { evaluate_repository(pool, &requirement_id, mapping).await });
    }
    while let Some(joined) = tasks.join_next().await {
        match joined {
            Ok(Ok(repository)) => repositories.push(repository),
            Ok(Err(error)) => return Err(error),
            Err(error) => {
                return Err(AppError::Validation(format!(
                    "No se pudo evaluar un repositorio: {error}"
                )))
            }
        }
    }
    repositories.sort_by(|left, right| {
        left.repository_name
            .to_lowercase()
            .cmp(&right.repository_name.to_lowercase())
    });

    Ok(RequirementPresence {
        requirement_id: requirement_id.to_string(),
        external_key,
        repositories,
    })
}

async fn evaluate_repository(
    pool: SqlitePool,
    requirement_id: &str,
    mapping: MappingRow,
) -> Result<RepositoryPresence, AppError> {
    let envs = load_environments(&pool, &mapping.repository_id).await?;
    let history = load_history(&pool, requirement_id, &mapping.repository_id).await?;
    let repository_id = mapping.repository_id.clone();
    let repository_name = mapping.repository_name.clone();
    let branch_name = mapping.branch_name.clone();
    let branch_status = mapping.branch_status.clone();

    let environments =
        tokio::task::spawn_blocking(move || compute_repository(&mapping, &envs, &history))
            .await
            .map_err(|error| {
                AppError::Validation(format!("No se pudo evaluar el repositorio: {error}"))
            })?;

    Ok(RepositoryPresence {
        repository_id,
        repository_name,
        branch_name,
        branch_status,
        environments,
    })
}

fn compute_repository(
    mapping: &MappingRow,
    envs: &[EnvRow],
    history: &HashMap<String, HistoryRow>,
) -> Vec<EnvironmentPresence> {
    let repo_path = Path::new(&mapping.local_path);
    let remote = mapping.remote_name.as_str();
    let refs = squash_ops::ref_map(repo_path).unwrap_or_default();

    let requirement_sha = resolve_branch_sha(&refs, remote, &mapping.branch_name, true);
    let base_sha = resolve_branch_sha(&refs, remote, &mapping.base_branch, false);

    let (req_files, change_base) = match (requirement_sha.as_deref(), base_sha.as_deref()) {
        (Some(requirement_sha), Some(base_sha)) => (
            requirement_change_files(repo_path, base_sha, requirement_sha).unwrap_or_default(),
            Some(base_sha.to_string()),
        ),
        _ => (Vec::new(), None),
    };

    envs.iter()
        .map(|env| {
            let env_history = history.get(&env.environment);
            compute_environment(
                mapping,
                env,
                env_history,
                &refs,
                requirement_sha.as_deref(),
                change_base.as_deref(),
                &req_files,
            )
            .unwrap_or_else(|error| {
                unknown_presence(
                    env,
                    req_files.len(),
                    format!("No se pudo comparar con este ambiente: {error}"),
                    env_history,
                )
            })
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn compute_environment(
    mapping: &MappingRow,
    env: &EnvRow,
    history: Option<&HistoryRow>,
    refs: &HashMap<String, String>,
    requirement_sha: Option<&str>,
    change_base: Option<&str>,
    req_files: &[String],
) -> Result<EnvironmentPresence, AppError> {
    let repo_path = Path::new(&mapping.local_path);
    let remote = mapping.remote_name.as_str();
    let mut presence = EnvironmentPresence {
        environment: env.environment.clone(),
        label: env.label.clone(),
        color: env.color.clone(),
        branch: env.branch_name.clone(),
        status: "unknown".into(),
        files_total: req_files.len(),
        files_applied: 0,
        files_pending: req_files.len(),
        evidence: "none".into(),
        pending_files: Vec::new(),
        pushed_at: history.and_then(|row| row.pushed_at.clone()),
        pushed_branch: history.and_then(|row| row.deploy_branch.clone()),
        detail: None,
    };

    let Some(requirement_sha) = requirement_sha else {
        presence.detail = Some(format!(
            "La rama '{}' no existe en el clon local ni en el remoto.",
            mapping.branch_name
        ));
        return Ok(presence);
    };

    let Some(env_branch) = env.branch_name.as_deref() else {
        presence.detail = Some("Sin rama configurada para este ambiente.".into());
        return Ok(presence);
    };

    let from_refs = refs
        .get(&format!("refs/remotes/{remote}/{env_branch}"))
        .or_else(|| refs.get(&format!("refs/heads/{env_branch}")))
        .cloned();
    let env_sha = match from_refs {
        Some(sha) => Some(sha),
        None => match env.resolved_sha.clone() {
            Some(sha) if squash_ops::rev_parse(repo_path, &sha)?.is_some() => Some(sha),
            _ => None,
        },
    };
    let Some(env_sha) = env_sha else {
        presence.detail = Some(format!(
            "No se encontró la rama '{env_branch}' del ambiente. Actualiza las ramas del repositorio."
        ));
        return Ok(presence);
    };

    if change_base.is_none() {
        presence.detail =
            Some(format!("No se encontró la rama base '{}'.", mapping.base_branch));
        return Ok(presence);
    }

    let (counts, differing) = evaluate_tips(repo_path, requirement_sha, &env_sha, req_files)?;
    presence.status = counts.status.into();
    presence.files_applied = counts.applied;
    presence.files_pending = counts.pending;
    presence.pending_files = differing;

    // La ancestría solo aporta cuando el contenido ya está aplicado; en los
    // demás casos el resultado ya lo explica la comparación de archivos.
    if counts.status == "applied" {
        let branch_merged = squash_ops::is_ancestor(repo_path, requirement_sha, &env_sha)?;
        let child_merged = match history.and_then(|row| row.deploy_sha.as_deref()) {
            Some(deploy_sha) => squash_ops::is_ancestor(repo_path, deploy_sha, &env_sha)?,
            None => false,
        };
        presence.evidence = if branch_merged || child_merged {
            "ancestry".into()
        } else {
            "content".into()
        };
    }

    presence.detail = build_detail(&presence, counts.status);
    Ok(presence)
}

fn unknown_presence(
    env: &EnvRow,
    files_total: usize,
    detail: String,
    history: Option<&HistoryRow>,
) -> EnvironmentPresence {
    EnvironmentPresence {
        environment: env.environment.clone(),
        label: env.label.clone(),
        color: env.color.clone(),
        branch: env.branch_name.clone(),
        status: "unknown".into(),
        files_total,
        files_applied: 0,
        files_pending: files_total,
        evidence: "none".into(),
        pending_files: Vec::new(),
        pushed_at: history.and_then(|row| row.pushed_at.clone()),
        pushed_branch: history.and_then(|row| row.deploy_branch.clone()),
        detail: Some(detail),
    }
}

fn build_detail(presence: &EnvironmentPresence, status: &str) -> Option<String> {
    let branch = presence.branch.clone().unwrap_or_default();
    Some(match status {
        "applied" => format!("Contenido ya presente en '{branch}'."),
        "partial" => format!(
            "{} de {} archivo(s) ya están en '{branch}'.",
            presence.files_applied, presence.files_total
        ),
        "pending" => format!("Ninguno de los {} archivo(s) está en '{branch}'.", presence.files_total),
        "no_changes" => "El requerimiento no tiene cambios propios que verificar.".into(),
        _ => return None,
    })
}

/// Archivos que el requerimiento modifica respecto del punto donde se separó
/// de la rama base. Es independiente de cuántos commits haya de por medio.
fn requirement_change_files(
    repo_path: &Path,
    base_sha: &str,
    requirement_sha: &str,
) -> Result<Vec<String>, AppError> {
    squash_ops::changed_files_since_merge_base(repo_path, base_sha, requirement_sha)
}

fn evaluate_tips(
    repo_path: &Path,
    requirement_sha: &str,
    env_sha: &str,
    req_files: &[String],
) -> Result<(PresenceCounts, Vec<String>), AppError> {
    if req_files.is_empty() {
        return Ok((
            PresenceCounts {
                total: 0,
                applied: 0,
                pending: 0,
                status: "no_changes",
            },
            Vec::new(),
        ));
    }
    if requirement_sha == env_sha {
        return Ok((
            PresenceCounts {
                total: req_files.len(),
                applied: req_files.len(),
                pending: 0,
                status: "applied",
            },
            Vec::new(),
        ));
    }
    let differing = squash_ops::differing_files(repo_path, requirement_sha, env_sha, req_files)?;
    let pending = differing.len().min(req_files.len());
    let applied = req_files.len() - pending;
    let status = if pending == 0 {
        "applied"
    } else if applied == 0 {
        "pending"
    } else {
        "partial"
    };
    Ok((
        PresenceCounts {
            total: req_files.len(),
            applied,
            pending,
            status,
        },
        differing,
    ))
}

fn resolve_branch_sha(
    refs: &std::collections::HashMap<String, String>,
    remote: &str,
    branch: &str,
    prefer_local: bool,
) -> Option<String> {
    let remote_ref = format!("refs/remotes/{remote}/{branch}");
    let local_ref = format!("refs/heads/{branch}");
    let candidates = if prefer_local {
        [local_ref, remote_ref]
    } else {
        [remote_ref, local_ref]
    };
    candidates.iter().find_map(|key| refs.get(key).cloned())
}

async fn load_environments(
    pool: &SqlitePool,
    repository_id: &str,
) -> Result<Vec<EnvRow>, AppError> {
    Ok(sqlx::query_as::<_, EnvRow>(
        "SELECT e.key AS environment, e.label, e.color,
                re.branch_name, re.resolved_sha
         FROM environments e
         LEFT JOIN repo_environments re
           ON re.environment = e.key AND re.repository_id = ?1
         WHERE e.is_active = 1
         ORDER BY e.position_no, e.key",
    )
    .bind(repository_id)
    .fetch_all(pool)
    .await?)
}

async fn load_history(
    pool: &SqlitePool,
    requirement_id: &str,
    repository_id: &str,
) -> Result<HashMap<String, HistoryRow>, AppError> {
    let rows = sqlx::query_as::<_, HistoryRow>(
        "SELECT environment, deploy_branch, deploy_sha, pushed_at
         FROM squash_sessions
         WHERE repository_id = ?1 AND environment IS NOT NULL
           AND instr(selected_requirements_json, ?2) > 0
         ORDER BY created_at DESC",
    )
    .bind(repository_id)
    .bind(requirement_id)
    .fetch_all(pool)
    .await?;
    let mut map = HashMap::new();
    for row in rows {
        // El ORDER BY deja primero la sesión más reciente de cada ambiente.
        map.entry(row.environment.clone()).or_insert(row);
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Oid, Repository, Signature};
    use std::fs;

    fn signature() -> Signature<'static> {
        Signature::now("FlowManager", "flow@example.com").expect("signature")
    }

    fn commit_files(
        repo: &Repository,
        branch: &str,
        parent: Option<Oid>,
        files: &[(&str, &str)],
        message: &str,
    ) -> Oid {
        let parent_tree = parent.map(|oid| repo.find_commit(oid).unwrap().tree().unwrap());
        let mut builder = repo
            .treebuilder(parent_tree.as_ref())
            .expect("tree builder");
        for (path, content) in files {
            let blob = repo.blob(content.as_bytes()).expect("blob");
            builder.insert(*path, blob, 0o100644).expect("insert");
        }
        let tree_id = builder.write().expect("write tree");
        let tree = repo.find_tree(tree_id).unwrap();
        let parent_commit = parent.map(|oid| repo.find_commit(oid).unwrap());
        let parents: Vec<&git2::Commit> = parent_commit.iter().collect();
        let sig = signature();
        repo.commit(
            Some(&format!("refs/heads/{branch}")),
            &sig,
            &sig,
            message,
            &tree,
            &parents,
        )
        .expect("commit")
    }

    struct Scenario {
        _dir: tempfile::TempDir,
        path: std::path::PathBuf,
        feature: Oid,
        dev: Oid,
        main: Oid,
    }

    fn scenario() -> Scenario {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("repo");
        fs::create_dir_all(&path).expect("repo dir");
        let repo = Repository::init(&path).expect("init");
        let main = commit_files(
            &repo,
            "main",
            None,
            &[("a.txt", "a-base\n"), ("b.txt", "b-base\n")],
            "init",
        );
        // dev ya recibió el cambio de a.txt (como si se hubiera mergeado).
        let dev = commit_files(
            &repo,
            "dev",
            Some(main),
            &[("a.txt", "a-change\n")],
            "squash merge previo",
        );
        let feature = commit_files(
            &repo,
            "feature/BPIM-1",
            Some(main),
            &[("a.txt", "a-change\n"), ("b.txt", "b-change\n")],
            "feature",
        );
        repo.set_head("refs/heads/main").expect("head");
        Scenario {
            _dir: dir,
            path,
            feature,
            dev,
            main,
        }
    }

    #[test]
    fn requirement_files_ignora_commits_previos_de_la_base() {
        let scenario = scenario();
        let files = requirement_change_files(
            &scenario.path,
            &scenario.main.to_string(),
            &scenario.feature.to_string(),
        )
        .expect("files");
        assert_eq!(files, vec!["a.txt".to_string(), "b.txt".to_string()]);
    }

    #[test]
    fn detecta_parcial_cuando_el_ambiente_ya_tiene_parte() {
        let scenario = scenario();
        let files = requirement_change_files(
            &scenario.path,
            &scenario.main.to_string(),
            &scenario.feature.to_string(),
        )
        .expect("files");
        let (counts, _) = evaluate_tips(
            &scenario.path,
            &scenario.feature.to_string(),
            &scenario.dev.to_string(),
            &files,
        )
        .expect("counts");
        assert_eq!(counts.status, "partial");
        assert_eq!(counts.applied, 1);
        assert_eq!(counts.pending, 1);
    }

    #[test]
    fn detecta_pendiente_y_aplicado() {
        let scenario = scenario();
        let files = requirement_change_files(
            &scenario.path,
            &scenario.main.to_string(),
            &scenario.feature.to_string(),
        )
        .expect("files");

        let (pending, _) = evaluate_tips(
            &scenario.path,
            &scenario.feature.to_string(),
            &scenario.main.to_string(),
            &files,
        )
        .expect("pending");
        assert_eq!(pending.status, "pending");

        let (applied, _) = evaluate_tips(
            &scenario.path,
            &scenario.feature.to_string(),
            &scenario.feature.to_string(),
            &files,
        )
        .expect("applied");
        assert_eq!(applied.status, "applied");
    }

    #[test]
    fn sin_cambios_propios_no_hay_nada_que_verificar() {
        let (counts, _) = evaluate_tips(Path::new("."), "aaa", "bbb", &[]).expect("counts");
        assert_eq!(counts.status, "no_changes");
    }
}
