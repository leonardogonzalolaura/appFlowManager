use crate::commands::system::open_in_file_manager;
use crate::domain::deployment;
use crate::error::{ApiError, AppError};
use crate::infra::branch_ops::{self, BranchCommit};
use crate::infra::{git_cli, squash_ops};
use crate::state::AppState;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquashCandidate {
    pub requirement_id: String,
    pub external_key: String,
    pub title: String,
    #[serde(rename = "type")]
    pub requirement_type: Option<String>,
    pub branch_name: String,
    pub branch_status: String,
    pub ahead: usize,
    pub behind: usize,
    pub commits: Vec<BranchCommit>,
    pub available: bool,
    pub warning: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SquashRequirementRef {
    pub id: String,
    pub external_key: String,
    pub title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquashSession {
    pub id: String,
    pub batch_id: Option<String>,
    pub repository_id: String,
    pub repository_name: String,
    pub github_owner: Option<String>,
    pub github_repo: Option<String>,
    pub environment: Option<String>,
    pub target_branch: Option<String>,
    pub target_base_sha: Option<String>,
    pub deploy_branch: Option<String>,
    pub deploy_sha: Option<String>,
    pub pushed_sha: Option<String>,
    pub pushed_at: Option<String>,
    pub phase: String,
    pub base_branch: String,
    pub base_ref: String,
    pub base_sha: String,
    pub internal_branch: String,
    pub worktree_path: String,
    pub strategy: String,
    pub status: String,
    pub message: String,
    pub selected_requirements: Vec<SquashRequirementRef>,
    pub selected_commits: Vec<BranchCommit>,
    pub conflicts: Vec<String>,
    pub current_action: Option<String>,
    pub squash_sha: Option<String>,
    pub files_changed: i64,
    pub additions: i64,
    pub deletions: i64,
    pub deploy_files_changed: i64,
    pub deploy_additions: i64,
    pub deploy_deletions: i64,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquashPrepareInput {
    pub repository_id: String,
    pub requirement_ids: Vec<String>,
    pub strategy: String,
    pub commit_shas: Option<Vec<String>>,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquashStageInput {
    pub session_id: String,
    pub file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquashResolveInput {
    pub session_id: String,
    pub file_path: String,
    /// `ours` = versión del ambiente, `theirs` = versión del requerimiento.
    pub side: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquashOpenInput {
    pub session_id: String,
    pub file_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentPreviewInput {
    pub requirement_ids: Vec<String>,
    pub environment: String,
    pub strategy: Option<String>,
    pub selected_commits: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoCommitsConfig {
    pub repository_id: String,
    pub strategy: String, // 'all_commits' o 'selected_commits'
    pub selected_commits: Vec<String>, // SHAs de commits seleccionados
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentPrepareInput {
    pub requirement_ids: Vec<String>,
    pub environment: String,
    pub repo_configs: Option<Vec<RepoCommitsConfig>>, // Nueva: estrategia por repo
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentRequirementRef {
    pub requirement_id: String,
    pub external_key: String,
    pub title: String,
    pub branch_name: String,
    pub branch_status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentRepoGroup {
    pub repository_id: String,
    pub repository_name: String,
    pub local_path: String,
    pub target_branch: Option<String>,
    pub target_sha: Option<String>,
    pub requirements: Vec<DeploymentRequirementRef>,
    pub available: bool,
    pub warning: Option<String>,
    pub common: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentPreview {
    pub environment: String,
    pub environment_label: String,
    pub repositories: Vec<DeploymentRepoGroup>,
    pub requirement_count: usize,
    pub common_repository_count: usize,
    pub unmapped_requirements: Vec<SquashRequirementRef>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentReport {
    /// Archivos que toca el commit squash (paso 1).
    pub squash_files: Vec<String>,
    /// Archivos del squash cuyo contenido ya es idéntico en la rama del
    /// ambiente; por eso no generan cambios en la rama hija.
    pub already_in_environment: Vec<String>,
    /// Archivos que realmente agrega el commit de la rama hija.
    pub deploy_files: Vec<String>,
    /// Archivos de la rama hija que solo cambian espacios o líneas en blanco.
    pub whitespace_only_files: Vec<String>,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentBatchSummary {
    pub batch_id: String,
    pub environment: Option<String>,
    pub environment_label: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub repository_count: usize,
    pub requirement_count: usize,
    pub pushed_count: usize,
    pub pending_count: usize,
    pub conflict_count: usize,
    pub repositories: Vec<String>,
    pub requirements: Vec<SquashRequirementRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SquashAction {
    kind: String,
    label: String,
    branch: Option<String>,
    sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SquashPlan {
    actions: Vec<SquashAction>,
    next_index: usize,
    current: Option<SquashAction>,
}

#[derive(Debug, sqlx::FromRow)]
struct RepoRow {
    id: String,
    local_path: String,
    base_branch: String,
    remote_name: String,
    remote_url: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct CandidateRow {
    requirement_id: String,
    external_key: String,
    title: String,
    requirement_type: Option<String>,
    branch_name: String,
    branch_status: String,
    base_branch: String,
}

#[derive(Debug, sqlx::FromRow)]
struct DeploymentRow {
    requirement_id: String,
    external_key: String,
    title: String,
    repository_id: String,
    repository_name: String,
    local_path: String,
    branch_name: String,
    branch_status: String,
    target_branch: Option<String>,
    target_sha: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct SessionRow {
    id: String,
    batch_id: Option<String>,
    repository_id: String,
    repository_name: String,
    github_owner: Option<String>,
    github_repo: Option<String>,
    environment: Option<String>,
    target_branch: Option<String>,
    target_base_sha: Option<String>,
    deploy_branch: Option<String>,
    deploy_sha: Option<String>,
    pushed_sha: Option<String>,
    pushed_at: Option<String>,
    phase: String,
    base_branch: String,
    base_ref: String,
    base_sha: String,
    internal_branch: String,
    worktree_path: String,
    strategy: String,
    status: String,
    message: String,
    selected_requirements_json: String,
    selected_commits_json: String,
    plan_json: String,
    conflicts_json: String,
    squash_sha: Option<String>,
    files_changed: i64,
    additions: i64,
    deletions: i64,
    deploy_files_changed: i64,
    deploy_additions: i64,
    deploy_deletions: i64,
    error_message: Option<String>,
    created_at: String,
    updated_at: String,
}

#[tauri::command]
pub async fn squash_candidates(
    state: State<'_, AppState>,
    repository_id: String,
) -> Result<Vec<SquashCandidate>, ApiError> {
    let pool = state.pool()?;
    let repo = load_repo(pool, &repository_id).await?;

    if repo.remote_url.is_some() {
        let run = git_cli::fetch_base(
            Path::new(&repo.local_path),
            &repo.remote_name,
            &repo.base_branch,
        )?;
        if !run.success {
            return Err(git_cli::invalidate_run(&run, "No se pudo actualizar la base").into());
        }
    }

    let mappings = load_candidate_rows(pool, &repository_id).await?;
    let mut result = Vec::new();
    for mapping in mappings {
        let analysis = branch_ops::analyze(
            Path::new(&repo.local_path),
            &repo.remote_name,
            &mapping.branch_name,
            &mapping.base_branch,
            &mapping.external_key,
        );
        match analysis {
            Ok(analysis) => {
                let available = analysis.status == "ok";
                let warning = match analysis.status.as_str() {
                    "no_commits" => Some("La rama no tiene commits respecto a la base.".into()),
                    "branch_missing" => Some("La rama local todavía no existe.".into()),
                    _ => None,
                };
                result.push(SquashCandidate {
                    requirement_id: mapping.requirement_id,
                    external_key: mapping.external_key,
                    title: mapping.title,
                    requirement_type: mapping.requirement_type,
                    branch_name: mapping.branch_name,
                    branch_status: mapping.branch_status,
                    ahead: analysis.ahead,
                    behind: analysis.behind,
                    commits: analysis.commits,
                    available,
                    warning,
                });
            }
            Err(error) => {
                result.push(SquashCandidate {
                    requirement_id: mapping.requirement_id,
                    external_key: mapping.external_key,
                    title: mapping.title,
                    requirement_type: mapping.requirement_type,
                    branch_name: mapping.branch_name,
                    branch_status: mapping.branch_status,
                    ahead: 0,
                    behind: 0,
                    commits: Vec::new(),
                    available: false,
                    warning: Some(error.to_string()),
                });
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn squash_prepare(
    state: State<'_, AppState>,
    input: SquashPrepareInput,
) -> Result<SquashSession, ApiError> {
    let pool = state.pool()?;
    prepare_squash(pool, &state.paths.worktrees_dir, input, None, None, None).await
}

async fn prepare_squash(
    pool: &SqlitePool,
    worktrees_dir: &Path,
    input: SquashPrepareInput,
    environment: Option<String>,
    target_branch: Option<String>,
    batch_id: Option<String>,
) -> Result<SquashSession, ApiError> {
    let repo = load_repo(pool, &input.repository_id).await?;
    if input.requirement_ids.is_empty() {
        return Err(AppError::Validation("Selecciona al menos un requerimiento.".into()).into());
    }
    let strategy = match input.strategy.as_str() {
        "all_commits" => "all_commits",
        "selected_commits" => "selected_commits",
        other => {
            return Err(
                AppError::Validation(format!("Estrategia de squash desconocida: {other}")).into(),
            )
        }
    };

    if repo.remote_url.is_some() {
        let run = git_cli::fetch_base(
            Path::new(&repo.local_path),
            &repo.remote_name,
            &repo.base_branch,
        )?;
        if !run.success {
            return Err(git_cli::invalidate_run(&run, "No se pudo actualizar la base").into());
        }
    }

    let base_ref = if repo.remote_url.is_some() {
        format!("refs/remotes/{}/{}", repo.remote_name, repo.base_branch)
    } else {
        format!("refs/heads/{}", repo.base_branch)
    };
    let base_sha =
        squash_ops::rev_parse(Path::new(&repo.local_path), &base_ref)?.ok_or_else(|| {
            AppError::BranchNotFound(format!("La base {} no existe.", repo.base_branch))
        })?;

    let target_base_sha = if let Some(target) = target_branch.as_deref() {
        if repo.remote_url.is_some() {
            let run = git_cli::fetch_base(
                Path::new(&repo.local_path),
                &repo.remote_name,
                target,
            )?;
            if !run.success {
                return Err(git_cli::invalidate_run(
                    &run,
                    "No se pudo actualizar la rama del ambiente",
                )
                .into());
            }
        }
        let target_ref = if repo.remote_url.is_some() {
            format!("refs/remotes/{}/{}", repo.remote_name, target)
        } else {
            format!("refs/heads/{}", target)
        };
        let sha = squash_ops::rev_parse(Path::new(&repo.local_path), &target_ref)?
            .ok_or_else(|| {
                AppError::BranchNotFound(format!(
                    "La rama del ambiente '{target}' no existe."
                ))
            })?;
        Some(sha)
    } else {
        None
    };

    let mappings = load_candidate_rows_for_ids(pool, &repo.id, &input.requirement_ids).await?;
    if mappings.len() != input.requirement_ids.len() {
        return Err(AppError::Validation(
            "Uno o más requerimientos no están mapeados a este repositorio.".into(),
        )
        .into());
    }

    let mut analyses = Vec::new();
    for mapping in &mappings {
        let analysis = branch_ops::analyze(
            Path::new(&repo.local_path),
            &repo.remote_name,
            &mapping.branch_name,
            &mapping.base_branch,
            &mapping.external_key,
        )?;
        if analysis.status != "ok" {
            return Err(AppError::Validation(format!(
                "{}: {}",
                mapping.external_key, analysis.message
            ))
            .into());
        }
        analyses.push(analysis);
    }

    let selected_requirements: Vec<SquashRequirementRef> = mappings
        .iter()
        .map(|mapping| SquashRequirementRef {
            id: mapping.requirement_id.clone(),
            external_key: mapping.external_key.clone(),
            title: mapping.title.clone(),
        })
        .collect();

    let mut selected_commits: Vec<BranchCommit> = Vec::new();
    let actions = if strategy == "all_commits" {
        mappings
            .iter()
            .enumerate()
            .map(|(index, mapping)| SquashAction {
                kind: "merge".into(),
                label: mapping.external_key.clone(),
                branch: Some(mapping.branch_name.clone()),
                // Guardamos el tip de la rama al unificar: si luego se agregan
                // commits, la rama hija no debe salir con el squash viejo.
                sha: analyses
                    .get(index)
                    .and_then(|analysis| analysis.branch_sha.clone()),
            })
            .collect::<Vec<_>>()
    } else {
        let allowed: std::collections::HashSet<String> = analyses
            .iter()
            .flat_map(|analysis| analysis.commits.iter().map(|commit| commit.sha.clone()))
            .collect();
        let mut shas: Vec<String> = input
            .commit_shas
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|sha| sha.trim().to_string())
            .filter(|sha| !sha.is_empty())
            .collect();
        shas.sort();
        shas.dedup();
        for sha in &shas {
            if !allowed.contains(sha) {
                return Err(AppError::Validation(format!(
                    "El commit {sha} no pertenece a las ramas seleccionadas."
                ))
                .into());
            }
            if squash_ops::commit_is_merge(Path::new(&repo.local_path), sha)? {
                return Err(AppError::Validation(format!(
                    "El commit {sha} es un merge commit y no se puede aplicar con cherry-pick."
                ))
                .into());
            }
            let (timestamp, summary) = squash_ops::commit_meta(Path::new(&repo.local_path), sha)?;
            selected_commits.push(BranchCommit {
                sha: sha.clone(),
                summary,
                author: None,
                committed_at: chrono::DateTime::<Utc>::from_timestamp(timestamp, 0)
                    .unwrap_or_else(Utc::now)
                    .to_rfc3339_opts(SecondsFormat::Secs, true),
                is_foreign: false,
                source_branch: None,
                requirement_key: None,
            });
        }
        selected_commits.sort_by(|left, right| {
            left.committed_at
                .cmp(&right.committed_at)
                .then_with(|| left.sha.cmp(&right.sha))
        });
        selected_commits
            .iter()
            .map(|commit| SquashAction {
                kind: "cherry".into(),
                label: commit.summary.clone(),
                branch: None,
                sha: Some(commit.sha.clone()),
            })
            .collect::<Vec<_>>()
    };

    let message = input
        .message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| default_squash_message(&mappings));

    let session_id = Uuid::now_v7().to_string();
    let compact = session_id.replace('-', "");
    let short = compact
        .get(compact.len().saturating_sub(8)..)
        .unwrap_or(&compact)
        .to_string();
    let internal_branch = format!("flowmgr/squash/{short}");
    let worktree_path = worktrees_dir.join(&repo.id).join(&short);
    if squash_ops::worktree_exists(&worktree_path) {
        return Err(AppError::Validation(
            "Ya existe un worktree para esta sesión. Intenta de nuevo.".into(),
        )
        .into());
    }
    std::fs::create_dir_all(worktree_path.parent().unwrap_or(worktrees_dir))?;

    let plan = SquashPlan {
        actions,
        next_index: 0,
        current: None,
    };
    let now = now();
    sqlx::query(
        "INSERT INTO squash_sessions
           (id, batch_id, repository_id, environment, target_branch, target_base_sha,
            base_branch, base_ref, base_sha, internal_branch, worktree_path,
            strategy, status, message, selected_requirements_json,
            selected_commits_json, plan_json, conflicts_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'preparing',
                 ?13, ?14, ?15, ?16, '[]', ?17, ?17)",
    )
    .bind(&session_id)
    .bind(&batch_id)
    .bind(&repo.id)
    .bind(&environment)
    .bind(&target_branch)
    .bind(&target_base_sha)
    .bind(&repo.base_branch)
    .bind(&base_ref)
    .bind(&base_sha)
    .bind(&internal_branch)
    .bind(worktree_path.to_string_lossy().to_string())
    .bind(strategy)
    .bind(&message)
    .bind(serde_json::to_string(&selected_requirements).unwrap_or_else(|_| "[]".into()))
    .bind(serde_json::to_string(&selected_commits).unwrap_or_else(|_| "[]".into()))
    .bind(serde_json::to_string(&plan).unwrap_or_else(|_| "{}".into()))
    .bind(&now)
    .execute(pool)
    .await?;

    let run = squash_ops::create_worktree(
        Path::new(&repo.local_path),
        &worktree_path,
        &internal_branch,
        &base_ref,
    )?;
    if !run.success {
        let message = git_cli::invalidate_run(&run, "No se pudo crear el worktree").to_string();
        set_failed(pool, &session_id, message.clone()).await?;
        return Err(AppError::GitFailed(message).into());
    }

    let mut plan = plan;
    run_plan(
        pool,
        &session_id,
        &repo,
        &worktree_path,
        &base_sha,
        &internal_branch,
        &mut plan,
    )
    .await
}

#[tauri::command]
pub async fn deployment_preview(
    state: State<'_, AppState>,
    input: DeploymentPreviewInput,
) -> Result<DeploymentPreview, ApiError> {
    let pool = state.pool()?;
    let label = environment_label(pool, &input.environment).await?;
    let rows = load_deployment_rows(pool, &input.requirement_ids, &input.environment).await?;
    let repositories = group_deployment_rows(rows);
    let mapped_ids: std::collections::HashSet<String> = repositories
        .iter()
        .flat_map(|repo| {
            repo.requirements
                .iter()
                .map(|requirement| requirement.requirement_id.clone())
        })
        .collect();
    let selected = load_selected_requirements(pool, &input.requirement_ids).await?;
    let unmapped_requirements = selected
        .into_iter()
        .filter(|requirement| !mapped_ids.contains(&requirement.id))
        .collect::<Vec<_>>();
    let common_repository_count = repositories
        .iter()
        .filter(|repo| repo.requirements.len() > 1)
        .count();

    Ok(DeploymentPreview {
        environment: input.environment,
        environment_label: label,
        repositories,
        requirement_count: input.requirement_ids.len(),
        common_repository_count,
        unmapped_requirements,
    })
}

#[tauri::command]
pub async fn deployment_prepare(
    state: State<'_, AppState>,
    input: DeploymentPrepareInput,
) -> Result<Vec<SquashSession>, ApiError> {
    let pool = state.pool()?;
    
    // Convertir a DeploymentPreviewInput para carga de datos
    let preview_input = DeploymentPreviewInput {
        requirement_ids: input.requirement_ids.clone(),
        environment: input.environment.clone(),
        strategy: None,
        selected_commits: None,
    };
    
    prepare_deployment(pool, &state.paths.worktrees_dir, preview_input, input.repo_configs).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentCommitsInput {
    pub repository_id: String,
    pub requirement_ids: Vec<String>,
    pub target_branch: String,
    pub target_sha: Option<String>,
}

#[tauri::command]
pub async fn deployment_load_commits(
    state: State<'_, AppState>,
    input: DeploymentCommitsInput,
) -> Result<Vec<BranchCommit>, ApiError> {
    let pool = state.pool()?;
    
    // Cargar la ruta local del repo
    let repo_path: String = sqlx::query_scalar(
        "SELECT local_path FROM repositories WHERE id = ?1 AND is_active = 1"
    )
    .bind(&input.repository_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("repositorio".into()))?;
    
    let mut all_commits = Vec::new();
    
    // Cargar commits de cada requerimiento
    for requirement_id in &input.requirement_ids {
        let branch_name: String = sqlx::query_scalar(
            "SELECT branch_name FROM requirement_repositories 
             WHERE requirement_id = ?1 AND repository_id = ?2"
        )
        .bind(requirement_id)
        .bind(&input.repository_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("rama del requerimiento".into()))?;
        
        let requirement_key: String = sqlx::query_scalar(
            "SELECT external_key FROM requirements WHERE id = ?1"
        )
        .bind(requirement_id)
        .fetch_optional(pool)
        .await?
        .unwrap_or_default();
        
        // Cargar commits usando branch_ops
        let mut commits = branch_ops::collect_deployment_commits(
            Path::new(&repo_path),
            &branch_name,
            &input.target_branch,
            &input.target_sha,
            &requirement_key,
        )?;

        // Cada commit queda identificado con la rama del requerimiento que lo
        // aporta; la UI lo muestra cuando el repositorio es compartido.
        for commit in &mut commits {
            commit.source_branch = Some(branch_name.clone());
            if !requirement_key.is_empty() {
                commit.requirement_key = Some(requirement_key.clone());
            }
        }

        all_commits.extend(commits);
    }
    
    // Deduplicar por SHA
    let mut seen = HashSet::new();
    all_commits.retain(|commit| seen.insert(commit.sha.clone()));
    
    Ok(all_commits)
}

/// Vuelve a preparar un lote completo con los mismos requerimientos y
/// ambiente. Útil cuando un lote quedó a medias o falló.
#[tauri::command]
pub async fn deployment_batch_retry(
    state: State<'_, AppState>,
    batch_id: String,
) -> Result<Vec<SquashSession>, ApiError> {
    let pool = state.pool()?;
    let rows = sqlx::query_as::<_, (Option<String>, String)>(
        "SELECT environment, selected_requirements_json
         FROM squash_sessions
         WHERE batch_id = ?1
         ORDER BY created_at",
    )
    .bind(&batch_id)
    .fetch_all(pool)
    .await?;
    if rows.is_empty() {
        return Err(AppError::NotFound("el lote".into()).into());
    }
    let environment = rows
        .iter()
        .find_map(|(environment, _)| environment.clone())
        .ok_or_else(|| AppError::Validation("El lote no tiene un ambiente destino.".into()))?;
    let mut requirement_ids = Vec::new();
    for (_, json) in &rows {
        let refs: Vec<SquashRequirementRef> = serde_json::from_str(json).unwrap_or_default();
        for reference in refs {
            if !requirement_ids.contains(&reference.id) {
                requirement_ids.push(reference.id);
            }
        }
    }
    if requirement_ids.is_empty() {
        return Err(
            AppError::Validation("El lote no tiene requerimientos para reintentar.".into()).into(),
        );
    }
    prepare_deployment(
        pool,
        &state.paths.worktrees_dir,
        DeploymentPreviewInput {
            requirement_ids,
            environment,
            strategy: None,
            selected_commits: None,
        },
        None,
    )
    .await
}

async fn prepare_deployment(
    pool: &SqlitePool,
    worktrees_dir: &Path,
    input: DeploymentPreviewInput,
    repo_configs: Option<Vec<RepoCommitsConfig>>,
) -> Result<Vec<SquashSession>, ApiError> {
    environment_label(pool, &input.environment).await?;
    let rows = load_deployment_rows(pool, &input.requirement_ids, &input.environment).await?;
    let repositories = group_deployment_rows(rows);
    if repositories.is_empty() {
        return Err(AppError::Validation(
            "Ninguno de los requerimientos está mapeado a repositorios.".into(),
        )
        .into());
    }
    let blocked: Vec<&str> = repositories
        .iter()
        .filter(|repo| !repo.available)
        .map(|repo| repo.repository_name.as_str())
        .collect();
    if !blocked.is_empty() {
        return Err(AppError::Validation(format!(
            "Estos repositorios no tienen rama para {}: {}",
            input.environment,
            blocked.join(", ")
        ))
        .into());
    }

    let mut sessions = Vec::new();
    let batch_id = Uuid::now_v7().to_string();
    let strategy = input.strategy.as_deref().unwrap_or("all_commits");
    let configs_by_repo = repo_configs
        .iter()
        .flatten()
        .map(|config| (config.repository_id.clone(), config))
        .collect::<std::collections::HashMap<_, _>>();
    
    for repository in repositories {
        let Some(target_branch) = repository.target_branch.clone() else {
            continue;
        };
        let requirement_ids = repository
            .requirements
            .iter()
            .map(|requirement| requirement.requirement_id.clone())
            .collect::<Vec<_>>();
        
        // Obtener config específica para este repo, si existe
        let (repo_strategy, repo_commits) = if let Some(config) = configs_by_repo.get(&repository.repository_id) {
            (config.strategy.as_str(), Some(config.selected_commits.clone()))
        } else {
            (strategy, input.selected_commits.clone())
        };
        
        let session = prepare_squash(
            pool,
            worktrees_dir,
            SquashPrepareInput {
                repository_id: repository.repository_id,
                requirement_ids,
                strategy: repo_strategy.to_string(),
                commit_shas: repo_commits,
                message: None,
            },
            Some(input.environment.clone()),
            Some(target_branch),
            Some(batch_id.clone()),
        )
        .await;
        match session {
            Ok(session) => sessions.push(session),
            Err(error) => {
                for created in &sessions {
                    cleanup_session(pool, created).await;
                }
                return Err(error);
            }
        }
    }
    Ok(sessions)
}

async fn cleanup_session(pool: &SqlitePool, session: &SquashSession) {
    if let Ok(repo) = load_repo(pool, &session.repository_id).await {
        let worktree = Path::new(&session.worktree_path);
        if worktree.exists() {
            let _ = squash_ops::hard_reset_clean(worktree, &session.base_sha);
            let _ = squash_ops::remove_worktree(
                Path::new(&repo.local_path),
                worktree,
                &session.internal_branch,
            );
        }
        if let Some(deploy_branch) = session.deploy_branch.as_deref() {
            let _ = git_cli::delete_local_branch(Path::new(&repo.local_path), deploy_branch);
        }
    }
    let _ = sqlx::query(
        "UPDATE squash_sessions SET status = 'aborted', conflicts_json = '[]',
            updated_at = ?1 WHERE id = ?2",
    )
    .bind(now())
    .bind(&session.id)
    .execute(pool)
    .await;
}

#[tauri::command]
pub async fn deployment_apply(
    state: State<'_, AppState>,
    session_id: String,
    replace_existing: Option<bool>,
) -> Result<SquashSession, ApiError> {
    let pool = state.pool()?;
    apply_deployment_with(pool, &session_id, replace_existing.unwrap_or(false)).await
}

/// Explica el delta real de una sesión de despliegue: qué archivos toca el
/// squash, cuáles ya están idénticos en el ambiente y cuáles agrega la rama
/// hija. Evita la falsa sensación de que "se perdieron archivos".
#[tauri::command]
pub async fn deployment_report(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<DeploymentReport, ApiError> {
    let pool = state.pool()?;
    let session = load_session(pool, &session_id).await?;
    let repo = load_repo(pool, &session.repository_id).await?;
    Ok(build_deployment_report(&repo, &session)?)
}

fn build_deployment_report(
    repo: &RepoRow,
    session: &SessionRow,
) -> Result<DeploymentReport, AppError> {
    let mut report = DeploymentReport {
        squash_files: Vec::new(),
        already_in_environment: Vec::new(),
        deploy_files: Vec::new(),
        whitespace_only_files: Vec::new(),
        additions: 0,
        deletions: 0,
    };
    let Some(squash_sha) = session.squash_sha.clone() else {
        return Ok(report);
    };
    let Some(target_base) = session.target_base_sha.clone() else {
        return Ok(report);
    };
    let repo_path = Path::new(&repo.local_path);
    let Some(parent) = squash_ops::rev_parse(repo_path, &format!("{squash_sha}^"))? else {
        return Ok(report);
    };
    report.squash_files = squash_ops::changed_files(repo_path, &parent, &squash_sha)?;
    for file in &report.squash_files {
        let squash_blob = squash_ops::blob_id(repo_path, &squash_sha, file)?;
        let base_blob = squash_ops::blob_id(repo_path, &target_base, file)?;
        if squash_blob == base_blob {
            report.already_in_environment.push(file.clone());
        }
    }
    if let Some(deploy_sha) = session.deploy_sha.as_deref() {
        report.deploy_files =
            squash_ops::changed_files(repo_path, &target_base, deploy_sha)?;
        let meaningful =
            squash_ops::changed_files_ignoring_space(repo_path, &target_base, deploy_sha)?;
        report.whitespace_only_files = report
            .deploy_files
            .iter()
            .filter(|file| !meaningful.iter().any(|kept| kept == *file))
            .cloned()
            .collect();
        let (_, additions, deletions) =
            squash_ops::diff_stat_between(repo_path, &target_base, deploy_sha)?;
        report.additions = additions as i64;
        report.deletions = deletions as i64;
    }
    Ok(report)
}

/// Rechaza aplicar un squash preparado antes de que la rama del requerimiento
/// recibiera nuevos commits: la rama hija saldría sin ellos y parecería que
/// FlowManager "no reconoce" el trabajo reciente.
fn ensure_requirement_branches_current(
    repo: &RepoRow,
    plan: &SquashPlan,
) -> Result<(), AppError> {
    let repo_path = Path::new(&repo.local_path);
    for action in &plan.actions {
        if action.kind != "merge" {
            continue;
        }
        let (Some(branch), Some(expected)) = (action.branch.as_deref(), action.sha.as_deref())
        else {
            continue;
        };
        let current = squash_ops::rev_parse(repo_path, &format!("refs/heads/{branch}"))?
            .or(squash_ops::rev_parse(
                repo_path,
                &format!("refs/remotes/{}/{branch}", repo.remote_name),
            )?);
        if let Some(current) = current {
            if current != expected {
                return Err(AppError::Validation(format!(
                    "La rama '{branch}' tiene commits nuevos desde que unificaste los cambios ({} → {}). Vuelve a preparar el despliegue para incluirlos.",
                    short_sha(expected),
                    short_sha(&current)
                )));
            }
        }
    }
    Ok(())
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(8).collect()
}

#[cfg(test)]
async fn apply_deployment(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<SquashSession, ApiError> {
    apply_deployment_with(pool, session_id, false).await
}

async fn apply_deployment_with(
    pool: &SqlitePool,
    session_id: &str,
    replace_existing: bool,
) -> Result<SquashSession, ApiError> {
    let session = load_session(pool, session_id).await?;
    if session.phase == "deploy" && session.status == "ready" {
        return Ok(session.into_dto());
    }
    if session.phase != "squash" || session.status != "ready" {
        return Err(AppError::Validation(
            "El squash todavía no está listo para aplicar al ambiente.".into(),
        )
        .into());
    }
    let Some(squash_sha) = session.squash_sha.clone() else {
        return Err(AppError::Validation(
            "La sesión no tiene el commit squash para aplicar.".into(),
        )
        .into());
    };
    let Some(environment) = session.environment.clone() else {
        return Err(AppError::Validation(
            "La sesión no tiene un ambiente destino.".into(),
        )
        .into());
    };
    let Some(target_branch) = session.target_branch.clone() else {
        return Err(AppError::Validation(
            "La sesión no tiene una rama de ambiente.".into(),
        )
        .into());
    };
    let Some(target_base_sha) = session.target_base_sha.clone() else {
        return Err(AppError::Validation(
            "No se guardó el SHA de la rama del ambiente.".into(),
        )
        .into());
    };
    let repo = load_repo(pool, &session.repository_id).await?;

    // Si la rama del requerimiento recibió commits nuevos, el squash guardado
    // ya no la representa: la rama hija saldría incompleta.
    let plan = parse_plan(&session.plan_json);
    ensure_requirement_branches_current(&repo, &plan)?;

    if repo.remote_url.is_some() {
        let run = git_cli::fetch_base(
            Path::new(&repo.local_path),
            &repo.remote_name,
            &target_branch,
        )?;
        if !run.success {
            return Err(git_cli::invalidate_run(
                &run,
                "No se pudo actualizar la rama del ambiente",
            )
            .into());
        }
    }
    let target_ref = if repo.remote_url.is_some() {
        format!("refs/remotes/{}/{}", repo.remote_name, target_branch)
    } else {
        format!("refs/heads/{}", target_branch)
    };
    let current_target_sha = squash_ops::rev_parse(Path::new(&repo.local_path), &target_ref)?
        .ok_or_else(|| AppError::BranchNotFound(target_branch.clone()))?;
    if current_target_sha != target_base_sha {
        return Err(AppError::BaseDrift(format!(
            "La rama '{target_branch}' cambió desde que se preparó el squash. Vuelve a preparar el despliegue."
        ))
        .into());
    }

    let selected_requirements: Vec<SquashRequirementRef> =
        serde_json::from_str(&session.selected_requirements_json).unwrap_or_default();
    let keys = selected_requirements
        .iter()
        .map(|requirement| requirement.external_key.clone())
        .collect::<Vec<_>>();
    let short = session
        .id
        .replace('-', "")
        .chars()
        .rev()
        .take(8)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    let deploy_branch = deployment::deployment_branch_name(&keys, &environment, &short);

    if squash_ops::rev_parse(
        Path::new(&repo.local_path),
        &format!("refs/heads/{deploy_branch}"),
    )?
    .is_some()
    {
        if !replace_existing {
            return Err(AppError::BranchExistsLocal(format!(
                "La rama local '{deploy_branch}' ya existe. Puedes eliminarla y crear la nueva sin tocar el remoto."
            ))
            .into());
        }
        let run = git_cli::delete_local_branch(Path::new(&repo.local_path), &deploy_branch)?;
        if !run.success {
            let detail = git_cli::invalidate_run(&run, "No se pudo eliminar la rama local")
                .to_string();
            return Err(AppError::Validation(format!(
                "No se pudo eliminar la rama local '{deploy_branch}'. Probablemente está abierta en el clon principal: cambia a otra rama ahí y vuelve a intentar. {detail}"
            ))
            .into());
        }
    }

    let worktree = Path::new(&session.worktree_path);
    if !squash_ops::worktree_exists(worktree) {
        return Err(AppError::Validation(
            "El worktree del squash ya no existe.".into(),
        )
        .into());
    }

    // El worktree queda en HEAD detached: la rama hija se crea como ref pero
    // nunca se deja "checkout" ahí. Así TortoiseGit u otra herramienta pueden
    // abrirla en el clon principal sin el error de "linked repository".
    let run = git_cli::checkout_detached(worktree, &target_base_sha)?;
    if !run.success {
        return fail_deployment_session(
            pool,
            &session.id,
            git_cli::invalidate_run(&run, "No se pudo preparar el worktree del despliegue")
                .to_string(),
        )
        .await;
    }
    let run = git_cli::create_branch_at(worktree, &deploy_branch, &target_base_sha)?;
    if !run.success {
        return fail_deployment_session(
            pool,
            &session.id,
            git_cli::invalidate_run(&run, "No se pudo crear la rama de despliegue")
                .to_string(),
        )
        .await;
    }

    // El commit squash contiene exactamente el delta de los requerimientos
    // respecto a la base. Se reaplica sobre la rama del ambiente con
    // cherry-pick para no arrastrar cambios ajenos si el ambiente divergió.
    let run = squash_ops::cherry_pick_no_commit(worktree, &squash_sha)?;
    if !run.success {
        let _conflicts = squash_ops::unmerged_files(worktree)?;
        
        // Primero, abortar el cherry-pick para limpiar el estado
        let _ = squash_ops::cherry_pick_quit(worktree);
        
        // Después, verificar si realmente hay cambios
        // Caso especial: cuando cherry-pick falla, verificar si realmente hay cambios
        // que merecen ser considerados un conflicto. Si no hay cambios staged
        // significativos, es que todo ya estaba en el ambiente (cambios fantasma).
        let has_changes = squash_ops::has_staged_changes(worktree)?
            && squash_ops::has_meaningful_staged_changes(worktree)?;
        
        if !has_changes {
            // No hay cambios netos, aunque haya archivos marcados como unmerged
            sqlx::query(
                "UPDATE squash_sessions
                 SET phase = 'deploy', status = 'no_changes', environment = ?1,
                     target_branch = ?2, target_base_sha = ?3, deploy_branch = ?4,
                     deploy_sha = ?3, conflicts_json = '[]',
                     deploy_files_changed = 0, deploy_additions = 0, deploy_deletions = 0,
                     updated_at = ?5
                 WHERE id = ?6",
            )
            .bind(&environment)
            .bind(&target_branch)
            .bind(&target_base_sha)
            .bind(&deploy_branch)
            .bind(now())
            .bind(&session.id)
            .execute(pool)
            .await?;
            return Ok(load_session(pool, &session.id).await?.into_dto());
        }
        
        // Si después de limpiar todavía hay archivos unmerged, es un conflicto real
        let unmerged_after_quit = squash_ops::unmerged_files(worktree)?;
        if !unmerged_after_quit.is_empty() {
            sqlx::query(
                "UPDATE squash_sessions
                 SET phase = 'deploy', status = 'conflict', environment = ?1,
                     target_branch = ?2, target_base_sha = ?3, deploy_branch = ?4,
                     conflicts_json = ?5, error_message = NULL, updated_at = ?6
                 WHERE id = ?7",
            )
            .bind(&environment)
            .bind(&target_branch)
            .bind(&target_base_sha)
            .bind(&deploy_branch)
            .bind(serde_json::to_string(&unmerged_after_quit).unwrap_or_else(|_| "[]".into()))
            .bind(now())
            .bind(&session.id)
            .execute(pool)
            .await?;
            return Ok(load_session(pool, &session.id).await?.into_dto());
        }
        
        return fail_deployment_session(
            pool,
            &session.id,
            git_cli::invalidate_run(&run, "No se pudo aplicar el squash al ambiente")
                .to_string(),
        )
        .await;
    }

    let run = squash_ops::commit_final(worktree, &session.message)?;
    if !run.success {
        return fail_deployment_session(
            pool,
            &session.id,
            git_cli::invalidate_run(&run, "No se pudo crear el commit de despliegue")
                .to_string(),
        )
        .await;
    }
    let deploy_sha = squash_ops::head_sha(worktree)?;
    let (deploy_files, deploy_additions, deploy_deletions) =
        squash_ops::diff_stat(worktree, &target_base_sha)?;
    let run = git_cli::update_branch_ref(
        worktree,
        &deploy_branch,
        &deploy_sha,
        &target_base_sha,
    )?;
    if !run.success {
        return fail_deployment_session(
            pool,
            &session.id,
            format!(
                "No se pudo actualizar la rama '{deploy_branch}'. ¿Otra herramienta la modificó mientras se preparaba el despliegue?"
            ),
        )
        .await;
    }
    sqlx::query(
        "UPDATE squash_sessions
         SET phase = 'deploy', status = 'ready', environment = ?1,
             target_branch = ?2, target_base_sha = ?3, deploy_branch = ?4,
             deploy_sha = ?5, deploy_files_changed = ?6, deploy_additions = ?7,
             deploy_deletions = ?8, conflicts_json = '[]', error_message = NULL,
             updated_at = ?9
         WHERE id = ?10",
    )
    .bind(&environment)
    .bind(&target_branch)
    .bind(&target_base_sha)
    .bind(&deploy_branch)
    .bind(&deploy_sha)
    .bind(deploy_files as i64)
    .bind(deploy_additions as i64)
    .bind(deploy_deletions as i64)
    .bind(now())
    .bind(&session.id)
    .execute(pool)
    .await?;
    Ok(load_session(pool, &session.id).await?.into_dto())
}

#[tauri::command]
pub async fn deployment_push(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SquashSession, ApiError> {
    let pool = state.pool()?;
    push_deployment(pool, &session_id).await
}

async fn push_deployment(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<SquashSession, ApiError> {
    let session = load_session(pool, session_id).await?;
    if session.phase != "deploy" || session.status != "ready" {
        return Err(AppError::Validation(
            "La rama de despliegue todavía no está lista para push.".into(),
        )
        .into());
    }
    let Some(deploy_branch) = session.deploy_branch.clone() else {
        return Err(AppError::Validation(
            "La sesión no tiene rama de despliegue.".into(),
        )
        .into());
    };
    let Some(deploy_sha) = session.deploy_sha.clone() else {
        return Err(AppError::Validation(
            "La sesión no tiene commit de despliegue.".into(),
        )
        .into());
    };
    let repo = load_repo(pool, &session.repository_id).await?;
    if repo.remote_url.is_none() {
        return Err(AppError::Validation(
            "El repositorio no tiene remoto configurado.".into(),
        )
        .into());
    }

    let environment_branches: Vec<String> = sqlx::query_scalar(
        "SELECT branch_name FROM repo_environments
         WHERE repository_id = ?1 AND branch_name IS NOT NULL",
    )
    .bind(&repo.id)
    .fetch_all(pool)
    .await?;
    let protected = environment_branches
        .iter()
        .any(|branch| branch.eq_ignore_ascii_case(&deploy_branch))
        || deployment::is_protected_branch(&deploy_branch);
    if protected {
        return Err(AppError::RefusingToPushEnvironmentBranch(format!(
            "La rama '{deploy_branch}' coincide con una rama de ambiente. FlowManager nunca empuja a ambientes."
        ))
        .into());
    }

    let repo_path = Path::new(&repo.local_path);
    let Some(local_sha) =
        squash_ops::rev_parse(repo_path, &format!("refs/heads/{deploy_branch}"))?
    else {
        return Err(AppError::PushRejected(format!(
            "La rama local '{deploy_branch}' no existe. Vuelve a crear la rama hija desde el despliegue."
        ))
        .into());
    };

    // Permite commits añadidos después de crear la rama, siempre que sean
    // descendientes del commit preparado (fast-forward). Si divergió, no se
    // sobrescribe nada.
    let push_sha = if local_sha != deploy_sha {
        if !squash_ops::is_ancestor(repo_path, &deploy_sha, &local_sha)? {
            return Err(AppError::PushRejected(format!(
                "La rama local '{deploy_branch}' divergió del commit preparado. Revisa los commits o vuelve a preparar el despliegue."
            ))
            .into());
        }
        if let Some(target_base) = session.target_base_sha.as_deref() {
            let (files, additions, deletions) =
                squash_ops::diff_stat_between(repo_path, target_base, &local_sha)?;
            sqlx::query(
                "UPDATE squash_sessions SET deploy_sha = ?1, deploy_files_changed = ?2,
                    deploy_additions = ?3, deploy_deletions = ?4, updated_at = ?5
                 WHERE id = ?6",
            )
            .bind(&local_sha)
            .bind(files as i64)
            .bind(additions as i64)
            .bind(deletions as i64)
            .bind(now())
            .bind(&session.id)
            .execute(pool)
            .await?;
        }
        local_sha
    } else {
        local_sha
    };

    let remote_sha = git_cli::remote_branch_sha(
        repo_path,
        &repo.remote_name,
        &deploy_branch,
    )?;
    if let Some(remote_sha) = remote_sha {
        if remote_sha != push_sha {
            // Si el remoto es un ancestro, es un avance normal (fast-forward).
            if !squash_ops::is_ancestor(repo_path, &remote_sha, &push_sha)? {
                return Err(AppError::PushRejected(format!(
                    "La rama '{deploy_branch}' ya existe en {} con otro SHA. No se sobrescribe; renómbrala o elimínala manualmente.",
                    repo.remote_name
                ))
                .into());
            }
        } else {
            mark_pushed(pool, &session.id, &push_sha).await?;
            release_worktree_if_attached(&session, &push_sha);
            return Ok(load_session(pool, &session.id).await?.into_dto());
        }
    }

    let run = git_cli::push_branch_at(
        repo_path,
        &repo.remote_name,
        &deploy_branch,
        &push_sha,
    )?;
    if !run.success {
        return Err(git_cli::invalidate_run(&run, "No se pudo empujar la rama").into());
    }
    let verified = git_cli::remote_branch_sha(
        repo_path,
        &repo.remote_name,
        &deploy_branch,
    )?;
    if verified.as_deref() != Some(push_sha.as_str()) {
        return Err(AppError::PushRejected(
            "El SHA remoto no coincide con el commit preparado.".into(),
        )
        .into());
    }
    mark_pushed(pool, &session.id, &push_sha).await?;
    release_worktree_if_attached(&session, &push_sha);
    Ok(load_session(pool, &session.id).await?.into_dto())
}

#[tauri::command]
pub async fn deployment_batches_list(
    state: State<'_, AppState>,
) -> Result<Vec<DeploymentBatchSummary>, ApiError> {
    let pool = state.pool()?;
    list_deployment_batches(pool).await
}

async fn list_deployment_batches(
    pool: &SqlitePool,
) -> Result<Vec<DeploymentBatchSummary>, ApiError> {
    let rows = sqlx::query_as::<_, SessionRow>(
        "SELECT s.id, s.batch_id, s.repository_id, r.name AS repository_name,
                r.github_owner, r.github_repo,
                s.environment, s.target_branch, s.target_base_sha,
                s.deploy_branch, s.deploy_sha, s.pushed_sha, s.pushed_at, s.phase,
                s.base_branch, s.base_ref, s.base_sha, s.internal_branch,
                s.worktree_path, s.strategy, s.status, s.message,
                s.selected_requirements_json, s.selected_commits_json, s.plan_json,
                s.conflicts_json, s.squash_sha, s.files_changed, s.additions,
                s.deletions, s.deploy_files_changed, s.deploy_additions,
                s.deploy_deletions, s.error_message, s.created_at, s.updated_at
         FROM squash_sessions s
         JOIN repositories r ON r.id = s.repository_id
         WHERE s.batch_id IS NOT NULL
         ORDER BY s.created_at DESC",
    )
    .fetch_all(pool)
    .await?;

    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Vec<SessionRow>> = HashMap::new();
    for row in rows {
        let Some(batch_id) = row.batch_id.clone() else {
            continue;
        };
        if !groups.contains_key(&batch_id) {
            order.push(batch_id.clone());
        }
        groups.entry(batch_id).or_default().push(row);
    }

    let mut summaries = Vec::new();
    for batch_id in order {
        let Some(rows) = groups.remove(&batch_id) else {
            continue;
        };
        let environment = rows.iter().find_map(|row| row.environment.clone());
        let label = match environment.as_deref() {
            Some(environment) => environment_label(pool, environment)
                .await
                .unwrap_or_else(|_| environment.to_string()),
            None => "Sin ambiente".to_string(),
        };
        summaries.push(summarize_batch(&batch_id, rows, environment, label));
    }
    Ok(summaries)
}

#[tauri::command]
pub async fn deployment_batch_sessions(
    state: State<'_, AppState>,
    batch_id: String,
) -> Result<Vec<SquashSession>, ApiError> {
    let pool = state.pool()?;
    let rows = sqlx::query_as::<_, SessionRow>(
        "SELECT s.id, s.batch_id, s.repository_id, r.name AS repository_name,
                r.github_owner, r.github_repo,
                s.environment, s.target_branch, s.target_base_sha,
                s.deploy_branch, s.deploy_sha, s.pushed_sha, s.pushed_at, s.phase,
                s.base_branch, s.base_ref, s.base_sha, s.internal_branch,
                s.worktree_path, s.strategy, s.status, s.message,
                s.selected_requirements_json, s.selected_commits_json, s.plan_json,
                s.conflicts_json, s.squash_sha, s.files_changed, s.additions,
                s.deletions, s.deploy_files_changed, s.deploy_additions,
                s.deploy_deletions, s.error_message, s.created_at, s.updated_at
         FROM squash_sessions s
         JOIN repositories r ON r.id = s.repository_id
         WHERE s.batch_id = ?1
         ORDER BY r.name COLLATE NOCASE",
    )
    .bind(&batch_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(session_from_row).collect())
}

fn summarize_batch(
    batch_id: &str,
    rows: Vec<SessionRow>,
    environment: Option<String>,
    environment_label: String,
) -> DeploymentBatchSummary {
    let sessions: Vec<SquashSession> = rows.into_iter().map(SessionRow::into_dto).collect();
    let active: Vec<&SquashSession> = sessions
        .iter()
        .filter(|session| session.status != "aborted")
        .collect();

    let status = if active.is_empty() {
        "cancelled"
    } else if active.iter().any(|session| session.status == "conflict") {
        "conflict"
    } else if active
        .iter()
        .all(|session| session.pushed_sha.is_some() || session.status == "no_changes")
    {
        "completed"
    } else if active
        .iter()
        .any(|session| session.phase == "deploy" && session.status == "ready")
    {
        "ready_push"
    } else if active
        .iter()
        .any(|session| session.phase == "squash" && session.status == "ready")
    {
        "ready_create"
    } else if active.iter().any(|session| session.status == "failed") {
        "failed"
    } else {
        "in_progress"
    };

    let pushed_count = active
        .iter()
        .filter(|session| session.pushed_sha.is_some())
        .count();
    let conflict_count = active
        .iter()
        .filter(|session| session.status == "conflict")
        .count();
    let pending_count = active
        .iter()
        .filter(|session| session.pushed_sha.is_none() && session.status != "no_changes")
        .count();

    let mut requirements: Vec<SquashRequirementRef> = Vec::new();
    let mut seen_requirements = HashSet::new();
    for session in &sessions {
        for requirement in &session.selected_requirements {
            if seen_requirements.insert(requirement.id.clone()) {
                requirements.push(requirement.clone());
            }
        }
    }
    requirements.sort_by(|left, right| left.external_key.cmp(&right.external_key));

    let mut repositories: Vec<String> = sessions
        .iter()
        .map(|session| session.repository_name.clone())
        .collect();
    repositories.sort_by_key(|name| name.to_ascii_lowercase());
    repositories.dedup();

    DeploymentBatchSummary {
        batch_id: batch_id.to_string(),
        environment,
        environment_label,
        status: status.to_string(),
        created_at: sessions
            .iter()
            .map(|session| session.created_at.clone())
            .min()
            .unwrap_or_default(),
        updated_at: sessions
            .iter()
            .map(|session| session.updated_at.clone())
            .max()
            .unwrap_or_default(),
        repository_count: sessions.len(),
        requirement_count: requirements.len(),
        pushed_count,
        pending_count,
        conflict_count,
        repositories,
        requirements,
    }
}

fn release_worktree_if_attached(session: &SessionRow, sha: &str) {
    let worktree = Path::new(&session.worktree_path);
    if !worktree.exists() {
        return;
    }
    if let Ok(false) = squash_ops::head_is_detached(worktree) {
        let _ = git_cli::checkout_detached(worktree, sha);
    }
}

async fn mark_pushed(
    pool: &SqlitePool,
    session_id: &str,
    deploy_sha: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE squash_sessions
         SET pushed_sha = ?1, pushed_at = ?2, updated_at = ?2
         WHERE id = ?3",
    )
    .bind(deploy_sha)
    .bind(now())
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn fail_deployment_session<T>(
    pool: &SqlitePool,
    session_id: &str,
    detail: String,
) -> Result<T, ApiError> {
    sqlx::query(
        "UPDATE squash_sessions SET phase = 'deploy', status = 'failed',
            error_message = ?1, updated_at = ?2 WHERE id = ?3",
    )
    .bind(&detail)
    .bind(now())
    .bind(session_id)
    .execute(pool)
    .await?;
    Err(AppError::GitFailed(detail).into())
}

async fn environment_label(pool: &SqlitePool, environment: &str) -> Result<String, AppError> {
    sqlx::query_scalar(
        "SELECT label FROM environments WHERE key = ?1 AND is_active = 1",
    )
    .bind(environment)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::EnvironmentNotFound(environment.to_string()))
}

async fn load_deployment_rows(
    pool: &SqlitePool,
    requirement_ids: &[String],
    environment: &str,
) -> Result<Vec<DeploymentRow>, AppError> {
    if requirement_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut query = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT req.id AS requirement_id, req.external_key, req.title,
                r.id AS repository_id, r.name AS repository_name, r.local_path,
                rr.branch_name, rr.branch_status,
                re.branch_name AS target_branch, re.resolved_sha AS target_sha
         FROM requirement_repositories rr
         JOIN requirements req ON req.id = rr.requirement_id
         JOIN repositories r ON r.id = rr.repository_id
         LEFT JOIN repo_environments re
           ON re.repository_id = r.id AND re.environment = ",
    );
    query.push_bind(environment);
    query.push(" WHERE r.is_active = 1 AND req.is_active = 1 AND req.id IN (");
    let mut separated = query.separated(", ");
    for id in requirement_ids {
        separated.push_bind(id);
    }
    drop(separated);
    query.push(") ORDER BY r.name COLLATE NOCASE, req.external_key");
    Ok(query.build_query_as::<DeploymentRow>().fetch_all(pool).await?)
}

fn group_deployment_rows(rows: Vec<DeploymentRow>) -> Vec<DeploymentRepoGroup> {
    use std::collections::BTreeMap;

    let mut groups: BTreeMap<String, DeploymentRepoGroup> = BTreeMap::new();
    for row in rows {
        let entry = groups
            .entry(row.repository_id.clone())
            .or_insert_with(|| DeploymentRepoGroup {
                repository_id: row.repository_id.clone(),
                repository_name: row.repository_name.clone(),
                local_path: row.local_path.clone(),
                target_branch: row.target_branch.clone(),
                target_sha: row.target_sha.clone(),
                requirements: Vec::new(),
                available: row.target_branch.is_some(),
                warning: if row.target_branch.is_none() {
                    Some("No hay una rama configurada para este ambiente.".into())
                } else {
                    None
                },
                common: false,
            });
        if !entry
            .requirements
            .iter()
            .any(|requirement| requirement.requirement_id == row.requirement_id)
        {
            entry.requirements.push(DeploymentRequirementRef {
                requirement_id: row.requirement_id,
                external_key: row.external_key,
                title: row.title,
                branch_name: row.branch_name,
                branch_status: row.branch_status,
            });
        }
    }

    let mut result: Vec<DeploymentRepoGroup> = groups.into_values().collect();
    for repo in &mut result {
        repo.common = repo.requirements.len() > 1;
    }
    result
}

async fn load_selected_requirements(
    pool: &SqlitePool,
    requirement_ids: &[String],
) -> Result<Vec<SquashRequirementRef>, AppError> {
    if requirement_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut query = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT id, external_key, title FROM requirements WHERE is_active = 1 AND id IN (",
    );
    let mut separated = query.separated(", ");
    for id in requirement_ids {
        separated.push_bind(id);
    }
    drop(separated);
    query.push(") ORDER BY external_key");
    Ok(query
        .build_query_as::<SquashRequirementRef>()
        .fetch_all(pool)
        .await?)
}

#[tauri::command]
pub async fn squash_list(
    state: State<'_, AppState>) -> Result<Vec<SquashSession>, ApiError> {
    let pool = state.pool()?;
    let rows = sqlx::query_as::<_, SessionRow>(
        "SELECT s.id, s.batch_id, s.repository_id, r.name AS repository_name,
                r.github_owner, r.github_repo,
                s.environment, s.target_branch, s.target_base_sha,
                s.deploy_branch, s.deploy_sha, s.pushed_sha, s.pushed_at, s.phase,
                s.base_branch,
                s.base_ref, s.base_sha, s.internal_branch, s.worktree_path,
                s.strategy, s.status, s.message, s.selected_requirements_json,
                s.selected_commits_json, s.plan_json, s.conflicts_json,
                s.squash_sha, s.files_changed, s.additions, s.deletions,
                s.deploy_files_changed, s.deploy_additions, s.deploy_deletions,
                s.error_message, s.created_at, s.updated_at
         FROM squash_sessions s
         JOIN repositories r ON r.id = s.repository_id
         ORDER BY s.created_at DESC LIMIT 50",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(session_from_row).collect())
}

#[tauri::command]
pub async fn squash_get(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SquashSession, ApiError> {
    let pool = state.pool()?;
    Ok(load_session(pool, &session_id).await?.into_dto())
}

#[tauri::command]
pub async fn squash_refresh_conflicts(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SquashSession, ApiError> {
    let pool = state.pool()?;
    let session = load_session(pool, &session_id).await?;
    let conflicts = squash_ops::unmerged_files(Path::new(&session.worktree_path))?;
    sqlx::query("UPDATE squash_sessions SET conflicts_json = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(serde_json::to_string(&conflicts).unwrap_or_else(|_| "[]".into()))
        .bind(now())
        .bind(&session.id)
        .execute(pool)
        .await?;
    Ok(load_session(pool, &session_id).await?.into_dto())
}

#[tauri::command]
pub async fn squash_stage_file(
    state: State<'_, AppState>,
    input: SquashStageInput,
) -> Result<SquashSession, ApiError> {
    let pool = state.pool()?;
    let session = load_session(pool, &input.session_id).await?;
    let worktree = Path::new(&session.worktree_path);
    squash_ops::validate_inside(worktree, &input.file_path)?;
    let run = squash_ops::stage_file(worktree, &input.file_path)?;
    if !run.success {
        return Err(git_cli::invalidate_run(&run, "No se pudo agregar el archivo").into());
    }
    refresh_conflicts_for(pool, &session).await
}

#[tauri::command]
pub async fn squash_stage_all(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SquashSession, ApiError> {
    let pool = state.pool()?;
    let session = load_session(pool, &session_id).await?;
    let run = squash_ops::stage_all(Path::new(&session.worktree_path))?;
    if !run.success {
        return Err(git_cli::invalidate_run(&run, "No se pudieron agregar los archivos").into());
    }
    refresh_conflicts_for(pool, &session).await
}

/// Resuelve un archivo en conflicto tomando una de las dos versiones y lo
/// agrega al índice. Evita que al borrar los marcadores a mano queden líneas
/// vacías o se pierdan cambios sin avisar.
#[tauri::command]
pub async fn squash_resolve_conflict(
    state: State<'_, AppState>,
    input: SquashResolveInput,
) -> Result<SquashSession, ApiError> {
    if input.side != "ours" && input.side != "theirs" {
        return Err(AppError::Validation(
            "La versión debe ser 'ours' (ambiente) o 'theirs' (requerimiento).".into(),
        )
        .into());
    }
    let pool = state.pool()?;
    let session = load_session(pool, &input.session_id).await?;
    let worktree = Path::new(&session.worktree_path);
    squash_ops::validate_inside(worktree, &input.file_path)?;
    let run = squash_ops::checkout_conflict_side(worktree, &input.file_path, &input.side)?;
    if !run.success {
        return Err(
            git_cli::invalidate_run(&run, "No se pudo tomar esa versión del archivo").into(),
        );
    }
    let run = squash_ops::stage_file(worktree, &input.file_path)?;
    if !run.success {
        return Err(git_cli::invalidate_run(&run, "No se pudo agregar el archivo").into());
    }
    refresh_conflicts_for(pool, &session).await
}

#[tauri::command]
pub async fn squash_continue(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SquashSession, ApiError> {
    let pool = state.pool()?;
    continue_squash(pool, &session_id).await
}

async fn continue_squash(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<SquashSession, ApiError> {
    let session = load_session(pool, session_id).await?;
    if session.status != "conflict" {
        return Err(AppError::Validation("La sesión no está en conflicto.".into()).into());
    }
    let worktree = Path::new(&session.worktree_path);
    let conflicts = squash_ops::unmerged_files(worktree)?;
    if !conflicts.is_empty() {
        return Err(AppError::Validation(format!(
            "Faltan {} archivo(s) por resolver.",
            conflicts.len()
        ))
        .into());
    }
    let markers = squash_ops::conflict_marker_files(worktree)?;
    if !markers.is_empty() {
        return Err(AppError::Validation(format!(
            "Quedan marcadores de conflicto en {} archivo(s): {}. Elimínalos o usa una de las versiones antes de continuar.",
            markers.len(),
            markers.join(", ")
        ))
        .into());
    }

    if session.phase == "deploy" {
        let Some(deploy_branch) = session.deploy_branch.clone() else {
            return Err(AppError::Validation(
                "La sesión no tiene rama de despliegue.".into(),
            )
            .into());
        };
        let Some(target_base_sha) = session.target_base_sha.clone() else {
            return Err(AppError::Validation(
                "La sesión no tiene la base del ambiente.".into(),
            )
            .into());
        };
        let local_ref = squash_ops::rev_parse(
            worktree,
            &format!("refs/heads/{deploy_branch}"),
        )?;
        if local_ref.as_deref() != Some(target_base_sha.as_str()) {
            return Err(AppError::PushRejected(format!(
                "La rama local '{deploy_branch}' cambió mientras se resolvía el conflicto. No se sobrescribe; revisa la rama y vuelve a preparar el despliegue."
            ))
            .into());
        }
        let was_detached = squash_ops::head_is_detached(worktree)?;
        if !squash_ops::has_staged_changes(worktree)?
            || !squash_ops::has_meaningful_staged_changes(worktree)?
        {
            let head = squash_ops::head_sha(worktree)?;
            let _ = squash_ops::cherry_pick_quit(worktree);
            if !was_detached {
                let _ = git_cli::checkout_detached(worktree, &head);
            }
            sqlx::query(
                "UPDATE squash_sessions SET status = 'no_changes', deploy_sha = ?1,
                    conflicts_json = '[]', error_message = NULL,
                    deploy_files_changed = 0, deploy_additions = 0,
                    deploy_deletions = 0, updated_at = ?2
                 WHERE id = ?3",
            )
            .bind(&head)
            .bind(now())
            .bind(&session.id)
            .execute(pool)
            .await?;
            return Ok(load_session(pool, &session.id).await?.into_dto());
        }
        let run = squash_ops::commit_final(worktree, &session.message)?;
        if !run.success {
            return fail_deployment_session(
                pool,
                &session.id,
                git_cli::invalidate_run(&run, "No se pudo crear el commit de despliegue")
                    .to_string(),
            )
            .await;
        }
        let deploy_sha = squash_ops::head_sha(worktree)?;
        let (deploy_files, deploy_additions, deploy_deletions) =
            squash_ops::diff_stat(worktree, &target_base_sha)?;
        let _ = squash_ops::cherry_pick_quit(worktree);
        if was_detached {
            let run = git_cli::update_branch_ref(
                worktree,
                &deploy_branch,
                &deploy_sha,
                &target_base_sha,
            )?;
            if !run.success {
                return fail_deployment_session(
                    pool,
                    &session.id,
                    format!(
                        "No se pudo actualizar la rama '{deploy_branch}' tras resolver el conflicto. ¿Otra herramienta la modificó?"
                    ),
                )
                .await;
            }
        } else {
            // Sesiones creadas antes del cambio a HEAD detached: el commit ya
            // movió la rama. Se libera el worktree para que otra herramienta
            // pueda abrirla.
            let local = squash_ops::rev_parse(
                worktree,
                &format!("refs/heads/{deploy_branch}"),
            )?;
            if local.as_deref() != Some(deploy_sha.as_str()) {
                return fail_deployment_session(
                    pool,
                    &session.id,
                    format!(
                        "La rama '{deploy_branch}' no quedó en el commit esperado tras el conflicto."
                    ),
                )
                .await;
            }
            let _ = git_cli::checkout_detached(worktree, &deploy_sha);
        }
        sqlx::query(
            "UPDATE squash_sessions SET status = 'ready', deploy_sha = ?1,
                deploy_files_changed = ?2, deploy_additions = ?3,
                deploy_deletions = ?4, conflicts_json = '[]',
                error_message = NULL, updated_at = ?5
             WHERE id = ?6",
        )
        .bind(&deploy_sha)
        .bind(deploy_files as i64)
        .bind(deploy_additions as i64)
        .bind(deploy_deletions as i64)
        .bind(now())
        .bind(&session.id)
        .execute(pool)
        .await?;
        return Ok(load_session(pool, &session.id).await?.into_dto());
    }

    let mut plan = parse_plan(&session.plan_json);
    let Some(current) = plan.current.clone() else {
        return Err(
            AppError::Validation("No hay una acción pendiente para continuar.".into()).into(),
        );
    };
    if squash_ops::has_staged_changes(worktree)? {
        let run = squash_ops::commit_wip(worktree, &current.label)?;
        if !run.success {
            return Err(git_cli::invalidate_run(&run, "No se pudo cerrar el conflicto").into());
        }
    }
    if current.kind == "cherry" {
        squash_ops::cherry_pick_quit(worktree)?;
    }
    plan.next_index += 1;
    plan.current = None;
    save_plan(pool, &session.id, &plan).await?;
    sqlx::query(
        "UPDATE squash_sessions SET status = 'preparing', conflicts_json = '[]', updated_at = ?1 WHERE id = ?2",
    )
    .bind(now())
    .bind(&session.id)
    .execute(pool)
    .await?;

    let repo = load_repo(pool, &session.repository_id).await?;
    run_plan(
        pool,
        &session.id,
        &repo,
        &PathBuf::from(&session.worktree_path),
        &session.base_sha,
        &session.internal_branch,
        &mut plan,
    )
    .await
}

#[tauri::command]
pub async fn squash_abort(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SquashSession, ApiError> {
    let pool = state.pool()?;
    let session = load_session(pool, &session_id).await?;
    let repo = load_repo(pool, &session.repository_id).await?;
    let worktree = Path::new(&session.worktree_path);
    if worktree.exists() {
        let reset_sha = if session.phase == "deploy" {
            session
                .target_base_sha
                .as_deref()
                .unwrap_or(&session.base_sha)
        } else {
            &session.base_sha
        };
        squash_ops::hard_reset_clean(worktree, reset_sha)?;
        squash_ops::remove_worktree(
            Path::new(&repo.local_path),
            worktree,
            &session.internal_branch,
        )?;
    }
    if let Some(deploy_branch) = session.deploy_branch.as_deref() {
        let _ = git_cli::delete_local_branch(Path::new(&repo.local_path), deploy_branch);
    }
    let mut plan = parse_plan(&session.plan_json);
    plan.current = None;
    save_plan(pool, &session.id, &plan).await?;
    sqlx::query(
        "UPDATE squash_sessions SET status = 'aborted', conflicts_json = '[]', updated_at = ?1 WHERE id = ?2",
    )
    .bind(now())
    .bind(&session.id)
    .execute(pool)
    .await?;
    Ok(load_session(pool, &session.id).await?.into_dto())
}

#[tauri::command]
pub async fn squash_open_editor(
    state: State<'_, AppState>,
    input: SquashOpenInput,
) -> Result<(), ApiError> {
    let pool = state.pool()?;
    let session = load_session(pool, &input.session_id).await?;
    let worktree = Path::new(&session.worktree_path);
    if !worktree.exists() {
        return Err(AppError::Validation("El worktree de esta sesión ya no existe.".into()).into());
    }

    let mut command = if cfg!(windows) {
        Command::new("code.cmd")
    } else {
        Command::new("code")
    };

    if let Some(file) = input.file_path.as_deref().filter(|value| !value.is_empty()) {
        if Path::new(file).is_absolute() {
            return Err(AppError::Validation(
                "La ruta del archivo debe ser relativa al worktree.".into(),
            )
            .into());
        }
        squash_ops::validate_inside(worktree, file)?;
        let absolute = worktree.join(file);
        command
            .arg("--goto")
            .arg(format!("{}:1", absolute.display()));
    } else {
        command.arg(worktree);
    }

    command.spawn().map_err(|_| {
        AppError::Validation(
            "No se pudo abrir VS Code. Verifica que el comando 'code' esté en el PATH.".into(),
        )
    })?;
    Ok(())
}

fn tarugit_executable() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os("TARUGIT_PATH") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }

    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let path = PathBuf::from(local_app_data)
            .join("tarugit")
            .join("tarugit.exe");
        if path.is_file() {
            return Some(path);
        }
    }

    None
}

#[tauri::command]
pub async fn squash_open_tarugit(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), ApiError> {
    let pool = state.pool()?;
    let session = load_session(pool, &session_id).await?;
    let worktree = Path::new(&session.worktree_path);
    if !worktree.exists() {
        return Err(AppError::Validation("El worktree de esta sesión ya no existe.".into()).into());
    }

    let executable = tarugit_executable().ok_or_else(|| {
        AppError::Validation(
            "No se encontró TaruGit. Instálalo en %LOCALAPPDATA%\\tarugit\\tarugit.exe o define la variable TARUGIT_PATH.".into(),
        )
    })?;

    Command::new(&executable)
        .arg("--open")
        .arg(worktree)
        .arg("--temporary")
        .spawn()
        .map_err(|error| {
            AppError::Validation(format!(
                "No se pudo abrir TaruGit ({}): {error}",
                executable.display()
            ))
        })?;

    Ok(())
}

#[tauri::command]
pub async fn squash_open_folder(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), ApiError> {
    let pool = state.pool()?;
    let session = load_session(pool, &session_id).await?;
    let worktree = Path::new(&session.worktree_path);
    if !worktree.exists() {
        return Err(AppError::Validation("El worktree de esta sesión ya no existe.".into()).into());
    }
    open_in_file_manager(worktree)?;
    Ok(())
}

async fn run_plan(
    pool: &SqlitePool,
    session_id: &str,
    repo: &RepoRow,
    worktree_path: &Path,
    base_sha: &str,
    internal_branch: &str,
    plan: &mut SquashPlan,
) -> Result<SquashSession, ApiError> {
    loop {
        if plan.next_index >= plan.actions.len() {
            let run = squash_ops::soft_reset(worktree_path, base_sha)?;
            if !run.success {
                return fail_session(pool, session_id, run.stderr).await;
            }
            if !squash_ops::has_staged_changes(worktree_path)? {
                cleanup_worktree(repo, worktree_path, internal_branch)?;
                set_status(pool, session_id, "no_changes", None, None, (0, 0, 0)).await?;
                return Ok(load_session(pool, session_id).await?.into_dto());
            }
            let session = load_session(pool, session_id).await?;
            let run = squash_ops::commit_final(worktree_path, &session.message)?;
            if !run.success {
                return fail_session(pool, session_id, run.stderr).await;
            }
            let sha = squash_ops::head_sha(worktree_path)?;
            let (files, additions, deletions) = squash_ops::diff_stat(worktree_path, base_sha)?;
            set_status(
                pool,
                session_id,
                "ready",
                None,
                Some(&sha),
                (files as i64, additions as i64, deletions as i64),
            )
            .await?;
            save_plan(pool, session_id, plan).await?;
            return Ok(load_session(pool, session_id).await?.into_dto());
        }

        let action = if let Some(current) = plan.current.clone() {
            current
        } else {
            let action = plan.actions[plan.next_index].clone();
            plan.current = Some(action.clone());
            save_plan(pool, session_id, plan).await?;
            action
        };

        let result = match action.kind.as_str() {
            "merge" => squash_ops::merge_squash(
                worktree_path,
                action.branch.as_deref().unwrap_or_default(),
            )?,
            "cherry" => squash_ops::cherry_pick_no_commit(
                worktree_path,
                action.sha.as_deref().unwrap_or_default(),
            )?,
            _ => {
                return fail_session(
                    pool,
                    session_id,
                    format!("Acción de squash desconocida: {}", action.kind),
                )
                .await
            }
        };

        if result.success {
            if squash_ops::has_staged_changes(worktree_path)? {
                let commit = squash_ops::commit_wip(worktree_path, &action.label)?;
                if !commit.success {
                    return fail_session(pool, session_id, commit.stderr).await;
                }
            }
            plan.next_index += 1;
            plan.current = None;
            save_plan(pool, session_id, plan).await?;
            continue;
        }

        let conflicts = squash_ops::unmerged_files(worktree_path)?;
        if !conflicts.is_empty() {
            sqlx::query(
                "UPDATE squash_sessions
                 SET status = 'conflict', conflicts_json = ?1, plan_json = ?2, updated_at = ?3,
                     error_message = NULL
                 WHERE id = ?4",
            )
            .bind(serde_json::to_string(&conflicts).unwrap_or_else(|_| "[]".into()))
            .bind(serde_json::to_string(plan).unwrap_or_else(|_| "{}".into()))
            .bind(now())
            .bind(session_id)
            .execute(pool)
            .await?;
            return Ok(load_session(pool, session_id).await?.into_dto());
        }

        let detail = if !result.stderr.is_empty() {
            result.stderr
        } else {
            result.stdout
        };
        if action.kind == "cherry" && detail.to_lowercase().contains("empty") {
            plan.next_index += 1;
            plan.current = None;
            save_plan(pool, session_id, plan).await?;
            continue;
        }
        return fail_session(pool, session_id, detail).await;
    }
}

fn cleanup_worktree(
    repo: &RepoRow,
    worktree_path: &Path,
    internal_branch: &str,
) -> Result<(), AppError> {
    squash_ops::remove_worktree(Path::new(&repo.local_path), worktree_path, internal_branch)
}

async fn refresh_conflicts_for(
    pool: &SqlitePool,
    session: &SessionRow,
) -> Result<SquashSession, ApiError> {
    let conflicts = squash_ops::unmerged_files(Path::new(&session.worktree_path))?;
    sqlx::query("UPDATE squash_sessions SET conflicts_json = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(serde_json::to_string(&conflicts).unwrap_or_else(|_| "[]".into()))
        .bind(now())
        .bind(&session.id)
        .execute(pool)
        .await?;
    Ok(load_session(pool, &session.id).await?.into_dto())
}

async fn load_repo(pool: &SqlitePool, repository_id: &str) -> Result<RepoRow, AppError> {
    sqlx::query_as::<_, RepoRow>(
        "SELECT id, local_path, base_branch, remote_name, remote_url
         FROM repositories WHERE id = ?1 AND is_active = 1",
    )
    .bind(repository_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("el repositorio".into()))
}

async fn load_candidate_rows(
    pool: &SqlitePool,
    repository_id: &str,
) -> Result<Vec<CandidateRow>, AppError> {
    sqlx::query_as::<_, CandidateRow>(
        "SELECT req.id AS requirement_id, req.external_key, req.title,
                req.type AS requirement_type, rr.branch_name, rr.branch_status,
                CASE WHEN trim(rr.base_branch) = '' THEN r.base_branch ELSE rr.base_branch END AS base_branch
         FROM requirement_repositories rr
         JOIN requirements req ON req.id = rr.requirement_id
         JOIN repositories r ON r.id = rr.repository_id
         WHERE rr.repository_id = ?1 AND req.is_active = 1
         ORDER BY req.external_key",
    )
    .bind(repository_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

async fn load_candidate_rows_for_ids(
    pool: &SqlitePool,
    repository_id: &str,
    requirement_ids: &[String],
) -> Result<Vec<CandidateRow>, AppError> {
    let mut query = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT req.id AS requirement_id, req.external_key, req.title,
                req.type AS requirement_type, rr.branch_name, rr.branch_status,
                CASE WHEN trim(rr.base_branch) = '' THEN r.base_branch ELSE rr.base_branch END AS base_branch
         FROM requirement_repositories rr
         JOIN requirements req ON req.id = rr.requirement_id
         JOIN repositories r ON r.id = rr.repository_id
         WHERE rr.repository_id = ",
    );
    query.push_bind(repository_id);
    query.push(" AND req.id IN (");
    let mut separated = query.separated(", ");
    for id in requirement_ids {
        separated.push_bind(id);
    }
    query.push(") ORDER BY req.external_key");
    Ok(query
        .build_query_as::<CandidateRow>()
        .fetch_all(pool)
        .await?)
}

async fn load_session(pool: &SqlitePool, session_id: &str) -> Result<SessionRow, AppError> {
    sqlx::query_as::<_, SessionRow>(
        "SELECT s.id, s.batch_id, s.repository_id, r.name AS repository_name,
                r.github_owner, r.github_repo,
                s.environment, s.target_branch, s.target_base_sha,
                s.deploy_branch, s.deploy_sha, s.pushed_sha, s.pushed_at, s.phase,
                s.base_branch,
                s.base_ref, s.base_sha, s.internal_branch, s.worktree_path,
                s.strategy, s.status, s.message, s.selected_requirements_json,
                s.selected_commits_json, s.plan_json, s.conflicts_json,
                s.squash_sha, s.files_changed, s.additions, s.deletions,
                s.deploy_files_changed, s.deploy_additions, s.deploy_deletions,
                s.error_message, s.created_at, s.updated_at
         FROM squash_sessions s JOIN repositories r ON r.id = s.repository_id
         WHERE s.id = ?1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("la sesión de squash".into()))
}

impl SessionRow {
    fn into_dto(self) -> SquashSession {
        let plan = parse_plan(&self.plan_json);
        SquashSession {
            id: self.id,
            batch_id: self.batch_id,
            repository_id: self.repository_id,
            repository_name: self.repository_name,
            github_owner: self.github_owner,
            github_repo: self.github_repo,
            environment: self.environment,
            target_branch: self.target_branch,
            target_base_sha: self.target_base_sha,
            deploy_branch: self.deploy_branch,
            deploy_sha: self.deploy_sha,
            pushed_sha: self.pushed_sha,
            pushed_at: self.pushed_at,
            phase: self.phase,
            base_branch: self.base_branch,
            base_ref: self.base_ref,
            base_sha: self.base_sha,
            internal_branch: self.internal_branch,
            worktree_path: self.worktree_path,
            strategy: self.strategy,
            status: self.status,
            message: self.message,
            selected_requirements: serde_json::from_str(&self.selected_requirements_json)
                .unwrap_or_default(),
            selected_commits: serde_json::from_str(&self.selected_commits_json).unwrap_or_default(),
            conflicts: serde_json::from_str(&self.conflicts_json).unwrap_or_default(),
            current_action: plan.current.as_ref().map(|action| action.label.clone()),
            squash_sha: self.squash_sha,
            files_changed: self.files_changed,
            additions: self.additions,
            deletions: self.deletions,
            deploy_files_changed: self.deploy_files_changed,
            deploy_additions: self.deploy_additions,
            deploy_deletions: self.deploy_deletions,
            error_message: self.error_message,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

fn session_from_row(row: SessionRow) -> SquashSession {
    row.into_dto()
}

fn parse_plan(json: &str) -> SquashPlan {
    let mut plan: SquashPlan = serde_json::from_str(json).unwrap_or_default();
    if plan.actions.is_empty() {
        plan.next_index = 0;
    }
    plan
}

fn default_squash_message(mappings: &[CandidateRow]) -> String {
    if mappings.len() == 1 {
        format!("{}: {}", mappings[0].external_key, mappings[0].title)
    } else {
        let keys = mappings
            .iter()
            .map(|mapping| mapping.external_key.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let titles = mappings
            .iter()
            .map(|mapping| mapping.title.as_str())
            .collect::<Vec<_>>()
            .join(" | ");
        format!("{keys}: {titles}\n\nRequirements: {keys}")
    }
}

async fn set_status(
    pool: &SqlitePool,
    session_id: &str,
    status: &str,
    error: Option<&str>,
    squash_sha: Option<&str>,
    stats: (i64, i64, i64),
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE squash_sessions
         SET status = ?1, error_message = ?2, squash_sha = ?3,
             files_changed = ?4, additions = ?5, deletions = ?6,
             conflicts_json = CASE WHEN ?1 = 'ready' THEN '[]' ELSE conflicts_json END,
             updated_at = ?7
         WHERE id = ?8",
    )
    .bind(status)
    .bind(error)
    .bind(squash_sha)
    .bind(stats.0)
    .bind(stats.1)
    .bind(stats.2)
    .bind(now())
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn set_failed(pool: &SqlitePool, session_id: &str, detail: String) -> Result<(), AppError> {
    set_status(pool, session_id, "failed", Some(&detail), None, (0, 0, 0)).await
}

async fn fail_session<T>(
    pool: &SqlitePool,
    session_id: &str,
    detail: String,
) -> Result<T, ApiError> {
    set_failed(pool, session_id, detail.clone()).await?;
    Err(AppError::GitFailed(detail).into())
}

async fn save_plan(pool: &SqlitePool, session_id: &str, plan: &SquashPlan) -> Result<(), AppError> {
    sqlx::query("UPDATE squash_sessions SET plan_json = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(serde_json::to_string(plan).unwrap_or_else(|_| "{}".into()))
        .bind(now())
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Oid, Repository, Signature};
    use tempfile::TempDir;

    fn signature() -> Signature<'static> {
        Signature::now("FlowManager Test", "test@flowmanager.local").expect("signature")
    }

    fn tree_with_content(
        repo: &Repository,
        parent: Option<Oid>,
        file: &str,
        content: &str,
    ) -> Oid {
        let parent_tree = parent.map(|oid| repo.find_commit(oid).unwrap().tree().unwrap());
        let mut builder = repo
            .treebuilder(parent_tree.as_ref())
            .expect("tree builder");
        let blob = repo.blob(content.as_bytes()).expect("blob");
        builder.insert(file, blob, 0o100644).expect("insert");
        builder.write().expect("write tree")
    }

    fn commit_content(
        repo: &Repository,
        branch: &str,
        parent: Option<Oid>,
        file: &str,
        content: &str,
        message: &str,
    ) -> Oid {
        let tree_id = tree_with_content(repo, parent, file, content);
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

    fn tree_with_files(
        repo: &Repository,
        parent: Option<Oid>,
        files: &[(&str, &str)],
    ) -> Oid {
        let parent_tree = parent.map(|oid| repo.find_commit(oid).unwrap().tree().unwrap());
        let mut builder = repo
            .treebuilder(parent_tree.as_ref())
            .expect("tree builder");
        for (file, content) in files {
            let blob = repo.blob(content.as_bytes()).expect("blob");
            builder.insert(*file, blob, 0o100644).expect("insert");
        }
        builder.write().expect("write tree")
    }

    fn commit_files(
        repo: &Repository,
        branch: &str,
        parent: Option<Oid>,
        files: &[(&str, &str)],
        message: &str,
    ) -> Oid {
        let tree_id = tree_with_files(repo, parent, files);
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

    fn commit_on(
        repo: &Repository,
        branch: &str,
        parent: Option<Oid>,
        file: &str,
        message: &str,
    ) -> Oid {
        commit_content(
            repo,
            branch,
            parent,
            file,
            &format!("{file}\n"),
            message,
        )
    }

    fn seed_repo(path: &Path) -> (Oid, Oid) {
        let repo = Repository::init(path).expect("init");
        let main = commit_on(&repo, "main", None, "README.md", "init");
        let dev = commit_on(&repo, "dev", Some(main), "dev.txt", "dev base");
        commit_on(&repo, "feature/BPIM-1", Some(main), "feature.txt", "feature work");
        repo.set_head("refs/heads/main").expect("head");
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .expect("checkout");
        (main, dev)
    }

    fn seed_partial_env_repo(path: &Path) -> (Oid, Oid) {
        let repo = Repository::init(path).expect("init");
        let main = commit_files(
            &repo,
            "main",
            None,
            &[("README.md", "# base\n"), ("shared.txt", "old\n")],
            "init",
        );
        let dev = commit_files(
            &repo,
            "dev",
            Some(main),
            &[("README.md", "# dev\n"), ("shared.txt", "same\n")],
            "dev change",
        );
        commit_files(
            &repo,
            "feature/BPIM-1",
            Some(main),
            &[
                ("README.md", "# feature\n"),
                ("shared.txt", "same\n"),
                ("feature.txt", "feature\n"),
            ],
            "feature change",
        );
        repo.set_head("refs/heads/main").expect("head");
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .expect("checkout");
        (main, dev)
    }

    fn seed_conflict_repo(path: &Path) -> (Oid, Oid) {
        let repo = Repository::init(path).expect("init");
        let main = commit_content(
            &repo,
            "main",
            None,
            "README.md",
            "# base\n",
            "init",
        );
        let dev = commit_content(
            &repo,
            "dev",
            Some(main),
            "README.md",
            "# dev\n",
            "dev change",
        );
        commit_content(
            &repo,
            "feature/BPIM-1",
            Some(main),
            "README.md",
            "# feature\n",
            "feature change",
        );
        repo.set_head("refs/heads/main").expect("head");
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .expect("checkout");
        (main, dev)
    }

    async fn setup_deployment(with_remote: bool) -> (TempDir, SqlitePool, PathBuf) {
        setup_deployment_internal(with_remote, seed_repo).await
    }

    async fn setup_conflict_deployment() -> (TempDir, SqlitePool, PathBuf) {
        setup_deployment_internal(false, seed_conflict_repo).await
    }

    async fn setup_deployment_internal(
        with_remote: bool,
        seed: fn(&Path) -> (Oid, Oid),
    ) -> (TempDir, SqlitePool, PathBuf) {
        let dir = tempfile::tempdir().expect("temp dir");
        let repo_path = dir.path().join("demo-repo");
        std::fs::create_dir_all(&repo_path).expect("repo dir");
        let (_main, dev) = seed(&repo_path);
        let dev_sha = dev.to_string();

        let remote_url = if with_remote {
            let bare_path = dir.path().join("remote.git");
            Repository::init_bare(&bare_path).expect("bare repo");
            let repo = Repository::open(&repo_path).expect("open");
            repo.remote("origin", bare_path.to_str().unwrap())
                .expect("remote");
            let status = Command::new("git")
                .args(["-C", repo_path.to_str().unwrap(), "push", "origin"])
                .args(["main", "dev", "feature/BPIM-1"])
                .status()
                .expect("push seed");
            assert!(status.success(), "seed push failed");
            Some(bare_path.to_string_lossy().to_string())
        } else {
            None
        };

        let pool = crate::db::connect(
            &dir.path().join("flowmanager.db"),
            &dir.path().join("backups"),
        )
        .await
        .expect("database");
        let timestamp = now();
        sqlx::query(
            "INSERT INTO repositories
               (id, name, local_path, remote_name, remote_url, provider,
                base_branch, is_active, created_at, updated_at)
             VALUES ('repo-1', 'Demo', ?1, 'origin', ?2, 'generic', 'main', 1, ?3, ?3)",
        )
        .bind(repo_path.to_string_lossy().to_string())
        .bind(&remote_url)
        .bind(&timestamp)
        .execute(&pool)
        .await
        .expect("repo row");
        sqlx::query(
            "INSERT INTO repo_environments
               (id, repository_id, environment, branch_name, resolution_mode,
                resolved_sha, resolved_at, resolution_note, updated_at)
             VALUES ('env-1', 'repo-1', 'dev', 'dev', 'manual', ?1, ?2, 'test', ?2)",
        )
        .bind(&dev_sha)
        .bind(&timestamp)
        .execute(&pool)
        .await
        .expect("env row");
        sqlx::query(
            "INSERT INTO requirements
               (id, external_key, title, source, first_seen_at, last_seen_at,
                created_at, updated_at)
             VALUES ('req-1', 'BPIM-1', 'Demo requirement', 'manual', ?1, ?1, ?1, ?1)",
        )
        .bind(&timestamp)
        .execute(&pool)
        .await
        .expect("requirement row");
        sqlx::query(
            "INSERT INTO requirement_repositories
               (id, requirement_id, repository_id, branch_name, base_branch,
                branch_status, mapping_source, created_at, updated_at)
             VALUES ('map-1', 'req-1', 'repo-1', 'feature/BPIM-1', 'main',
                     'created', 'manual', ?1, ?1)",
        )
        .bind(&timestamp)
        .execute(&pool)
        .await
        .expect("mapping row");

        (dir, pool, repo_path)
    }

    fn deployment_input() -> SquashPrepareInput {
        SquashPrepareInput {
            repository_id: "repo-1".into(),
            requirement_ids: vec!["req-1".into()],
            strategy: "all_commits".into(),
            commit_shas: None,
            message: None,
        }
    }

    #[tokio::test]
    async fn deployment_applies_to_environment_and_pushes_only_child_branch() {
        let (dir, pool, repo_path) = setup_deployment(true).await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            None,
        )
        .await
        .expect("prepare");
        assert_eq!(prepared.phase, "squash");
        assert_eq!(prepared.status, "ready");

        let applied = apply_deployment(&pool, &prepared.id).await.expect("apply");
        assert_eq!(applied.phase, "deploy");
        assert_eq!(applied.status, "ready");
        assert_eq!(applied.deploy_branch.as_deref(), Some("BPIM-1-dev"));
        let parent = squash_ops::rev_parse(Path::new(&applied.worktree_path), "HEAD^")
            .expect("parent")
            .expect("parent sha");
        assert_eq!(Some(parent), applied.target_base_sha.clone());
        assert!(Path::new(&applied.worktree_path).join("feature.txt").exists());

        // El worktree queda detached y la rama hija libre para otra herramienta.
        let worktree_repo = Repository::open(&applied.worktree_path).expect("worktree repo");
        assert!(worktree_repo.head_detached().expect("detached"));
        let checkout = Command::new("git")
            .args(["-C", repo_path.to_str().unwrap(), "checkout", "BPIM-1-dev"])
            .status()
            .expect("external checkout");
        assert!(
            checkout.success(),
            "la rama hija debe estar libre para el clon principal"
        );

        let pushed = push_deployment(&pool, &applied.id).await.expect("push");
        assert_eq!(pushed.pushed_sha.as_deref(), pushed.deploy_sha.as_deref());
        assert!(pushed.pushed_at.is_some());

        let bare = Repository::open(dir.path().join("remote.git")).expect("bare");
        let reference = bare
            .find_reference("refs/heads/BPIM-1-dev")
            .expect("remote deploy branch");
        assert_eq!(
            reference.target().unwrap().to_string(),
            pushed.deploy_sha.clone().unwrap()
        );
        // Las ramas de ambiente no se movieron.
        let dev_reference = bare.find_reference("refs/heads/dev").expect("dev");
        assert_ne!(
            dev_reference.target().unwrap().to_string(),
            pushed.deploy_sha.as_deref().unwrap()
        );

        cleanup_session(&pool, &pushed).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn deployment_push_includes_commits_added_to_child_branch() {
        let (dir, pool, repo_path) = setup_deployment(true).await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            None,
        )
        .await
        .expect("prepare");
        let applied = apply_deployment(&pool, &prepared.id).await.expect("apply");
        let deploy_sha = applied.deploy_sha.clone().expect("deploy sha");

        // El usuario agrega un commit sobre la rama hija antes de empujar.
        let repo = Repository::open(&repo_path).expect("repo");
        let extra = commit_on(
            &repo,
            "BPIM-1-dev",
            Some(deploy_sha.parse::<Oid>().expect("oid")),
            "extra.txt",
            "extra commit",
        );

        let pushed = push_deployment(&pool, &applied.id).await.expect("push");
        assert_eq!(pushed.deploy_sha.as_deref(), Some(extra.to_string().as_str()));
        assert_eq!(pushed.pushed_sha.as_deref(), Some(extra.to_string().as_str()));
        assert_eq!(pushed.deploy_files_changed, 2);

        let bare = Repository::open(dir.path().join("remote.git")).expect("bare");
        let reference = bare
            .find_reference("refs/heads/BPIM-1-dev")
            .expect("remote deploy branch");
        assert_eq!(reference.target().unwrap().to_string(), extra.to_string());

        cleanup_session(&pool, &pushed).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn deployment_can_replace_existing_local_branch() {
        let (dir, pool, repo_path) = setup_deployment(false).await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            None,
        )
        .await
        .expect("prepare");

        // Simula una rama local que quedó de un intento anterior.
        let repo = Repository::open(&repo_path).expect("repo");
        let main = repo
            .find_reference("refs/heads/main")
            .expect("main")
            .target()
            .expect("main sha");
        commit_on(&repo, "BPIM-1-dev", Some(main), "leftover.txt", "leftover");

        let error = apply_deployment(&pool, &prepared.id)
            .await
            .expect_err("la rama existente debe avisar");
        assert_eq!(error.code, "BRANCH_EXISTS_LOCAL");

        let applied = apply_deployment_with(&pool, &prepared.id, true)
            .await
            .expect("reemplazar rama");
        assert_eq!(applied.status, "ready");
        assert_eq!(applied.deploy_branch.as_deref(), Some("BPIM-1-dev"));

        let applied_sha = applied.deploy_sha.clone().expect("deploy sha");
        let commit = repo
            .find_commit(applied_sha.parse::<Oid>().expect("oid"))
            .expect("commit");
        assert!(
            commit
                .tree()
                .expect("tree")
                .get_path(Path::new("leftover.txt"))
                .is_err(),
            "el contenido viejo no debe sobrevivir"
        );

        cleanup_session(&pool, &applied).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn deployment_refuses_when_environment_branch_moved() {
        let (dir, pool, repo_path) = setup_deployment(false).await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            None,
        )
        .await
        .expect("prepare");

        let repo = Repository::open(&repo_path).expect("open");
        let dev = repo
            .find_reference("refs/heads/dev")
            .expect("dev")
            .target()
            .expect("dev sha");
        let new_dev = commit_on(&repo, "dev", Some(dev), "moved.txt", "dev moved");
        assert_ne!(new_dev.to_string(), prepared.target_base_sha.clone().unwrap());

        let error = apply_deployment(&pool, &prepared.id)
            .await
            .expect_err("drift must fail");
        assert_eq!(error.code, "BASE_DRIFT");
        cleanup_session(&pool, &prepared).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn deployment_refuses_when_requirement_branch_gained_commits() {
        let (dir, pool, repo_path) = setup_deployment(false).await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            None,
        )
        .await
        .expect("prepare");

        let repo = Repository::open(&repo_path).expect("open");
        let feature = repo
            .find_reference("refs/heads/feature/BPIM-1")
            .expect("feature")
            .target()
            .expect("feature sha");
        commit_on(
            &repo,
            "feature/BPIM-1",
            Some(feature),
            "late.txt",
            "late commit",
        );

        let error = apply_deployment(&pool, &prepared.id)
            .await
            .expect_err("la rama que avanzó debe bloquear el despliegue");
        assert_eq!(error.code, "VALIDATION");
        assert!(error.message.contains("commits nuevos"));

        cleanup_session(&pool, &prepared).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn deployment_conflict_keeps_branch_free_and_continue_updates_it() {
        let (dir, pool, repo_path) = setup_conflict_deployment().await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            None,
        )
        .await
        .expect("prepare");
        let applied = apply_deployment(&pool, &prepared.id)
            .await
            .expect("apply conflict");
        assert_eq!(applied.status, "conflict");
        assert_eq!(applied.deploy_branch.as_deref(), Some("BPIM-1-dev"));

        let worktree = Path::new(&applied.worktree_path);
        assert!(Repository::open(worktree)
            .expect("worktree repo")
            .head_detached()
            .expect("detached"));
        let checkout = Command::new("git")
            .args(["-C", repo_path.to_str().unwrap(), "checkout", "BPIM-1-dev"])
            .status()
            .expect("external checkout");
        assert!(
            checkout.success(),
            "la rama debe estar libre incluso durante el conflicto"
        );

        std::fs::write(worktree.join("README.md"), "# resolved\n").expect("resolve file");
        let staged = squash_ops::stage_file(worktree, "README.md").expect("stage");
        assert!(staged.success, "no se pudo agregar el archivo resuelto");

        let continued = continue_squash(&pool, &applied.id)
            .await
            .expect("continue");
        assert_eq!(continued.status, "ready");
        let deploy_sha = continued.deploy_sha.clone().expect("deploy sha");
        let local = squash_ops::rev_parse(
            Path::new(&repo_path),
            "refs/heads/BPIM-1-dev",
        )
        .expect("local ref")
        .expect("local branch");
        assert_eq!(local, deploy_sha);
        assert!(Repository::open(worktree)
            .expect("worktree repo")
            .head_detached()
            .expect("detached after continue"));

        cleanup_session(&pool, &continued).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn deployment_blank_only_resolution_ends_without_net_changes() {
        let (dir, pool, repo_path) = setup_conflict_deployment().await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            None,
        )
        .await
        .expect("prepare");
        let applied = apply_deployment(&pool, &prepared.id)
            .await
            .expect("apply conflict");
        assert_eq!(applied.status, "conflict");

        let worktree = Path::new(&applied.worktree_path);
        // La resolución solo agrega una línea completamente vacía: no hay
        // contenido nuevo, así que no se crea un commit vacío.
        std::fs::write(worktree.join("README.md"), "# dev\n\n").expect("resolve file");
        let staged = squash_ops::stage_file(worktree, "README.md").expect("stage");
        assert!(staged.success);

        let continued = continue_squash(&pool, &applied.id)
            .await
            .expect("continue");
        assert_eq!(continued.status, "no_changes");
        assert_eq!(continued.deploy_files_changed, 0);
        assert_eq!(continued.deploy_additions, 0);
        assert_eq!(continued.deploy_deletions, 0);

        let local = squash_ops::rev_parse(
            Path::new(&repo_path),
            "refs/heads/BPIM-1-dev",
        )
        .expect("local ref")
        .expect("local branch");
        assert_eq!(Some(local), continued.target_base_sha);

        cleanup_session(&pool, &continued).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn deployment_trailing_space_resolution_creates_branch() {
        let (dir, pool, repo_path) = setup_conflict_deployment().await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            None,
        )
        .await
        .expect("prepare");
        let applied = apply_deployment(&pool, &prepared.id)
            .await
            .expect("apply conflict");
        assert_eq!(applied.status, "conflict");

        let worktree = Path::new(&applied.worktree_path);
        // Un espacio al final puede cambiar el comportamiento (por ejemplo
        // dentro de un string): no debe tratarse como "sin cambios".
        std::fs::write(worktree.join("README.md"), "# dev \n").expect("resolve file");
        let staged = squash_ops::stage_file(worktree, "README.md").expect("stage");
        assert!(staged.success);

        let continued = continue_squash(&pool, &applied.id)
            .await
            .expect("continue");
        assert_eq!(continued.status, "ready");
        assert_eq!(continued.deploy_files_changed, 1);
        assert_eq!(continued.deploy_additions, 1);

        let local = squash_ops::rev_parse(
            Path::new(&repo_path),
            "refs/heads/BPIM-1-dev",
        )
        .expect("local ref")
        .expect("local branch");
        assert_ne!(Some(local), continued.target_base_sha);

        cleanup_session(&pool, &continued).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn deployment_continue_blocks_when_conflict_markers_remain() {
        let (dir, pool, _repo_path) = setup_conflict_deployment().await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            None,
        )
        .await
        .expect("prepare");
        let applied = apply_deployment(&pool, &prepared.id)
            .await
            .expect("apply conflict");

        let worktree = Path::new(&applied.worktree_path);
        std::fs::write(
            worktree.join("README.md"),
            "<<<<<<< HEAD\n# dev\n=======\n# feature\n>>>>>>> feature\n",
        )
        .expect("write markers");
        let staged = squash_ops::stage_file(worktree, "README.md").expect("stage");
        assert!(staged.success);

        let error = continue_squash(&pool, &applied.id)
            .await
            .expect_err("markers must block");
        assert_eq!(error.code, "VALIDATION");
        assert!(error.message.contains("marcadores"));

        cleanup_session(&pool, &applied).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn deployment_report_marks_files_already_present_in_environment() {
        let (dir, pool, _repo_path) =
            setup_deployment_internal(false, seed_partial_env_repo).await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            None,
        )
        .await
        .expect("prepare");
        let applied = apply_deployment(&pool, &prepared.id)
            .await
            .expect("apply conflict");
        assert_eq!(applied.status, "conflict");

        let session = load_session(&pool, &applied.id).await.expect("load");
        let repo = load_repo(&pool, &session.repository_id)
            .await
            .expect("repo");
        let report = build_deployment_report(&repo, &session).expect("report");
        assert_eq!(report.squash_files.len(), 3);
        assert_eq!(
            report.already_in_environment,
            vec!["shared.txt".to_string()]
        );
        assert!(report.deploy_files.is_empty());

        let worktree = Path::new(&applied.worktree_path);
        std::fs::write(worktree.join("README.md"), "# feature\n# dev\n")
            .expect("resolve file");
        let staged = squash_ops::stage_file(worktree, "README.md").expect("stage");
        assert!(staged.success);
        let continued = continue_squash(&pool, &applied.id)
            .await
            .expect("continue");
        assert_eq!(continued.status, "ready");
        assert_eq!(continued.deploy_files_changed, 2);

        let session = load_session(&pool, &continued.id).await.expect("load");
        let repo = load_repo(&pool, &session.repository_id)
            .await
            .expect("repo");
        let report = build_deployment_report(&repo, &session).expect("report");
        assert_eq!(report.deploy_files.len(), 2);
        assert_eq!(
            report.already_in_environment,
            vec!["shared.txt".to_string()]
        );

        cleanup_session(&pool, &continued).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn deployment_batches_group_sessions() {
        let (dir, pool, _repo_path) = setup_deployment(false).await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            Some("batch-1".into()),
        )
        .await
        .expect("prepare");
        assert_eq!(prepared.batch_id.as_deref(), Some("batch-1"));

        let batches = list_deployment_batches(&pool).await.expect("batches");
        assert_eq!(batches.len(), 1);
        let batch = &batches[0];
        assert_eq!(batch.batch_id, "batch-1");
        assert_eq!(batch.environment.as_deref(), Some("dev"));
        assert_eq!(batch.environment_label, "DEV");
        assert_eq!(batch.repository_count, 1);
        assert_eq!(batch.requirement_count, 1);
        assert_eq!(batch.repositories, vec!["Demo"]);
        assert_eq!(batch.status, "ready_create");
        assert_eq!(batch.pending_count, 1);
        assert!(batch.created_at.starts_with("20"));

        cleanup_session(&pool, &prepared).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn deployment_never_pushes_to_environment_branch() {
        let (dir, pool, _repo_path) = setup_deployment(false).await;
        let worktrees = dir.path().join("worktrees");
        let prepared = prepare_squash(
            &pool,
            &worktrees,
            deployment_input(),
            Some("dev".into()),
            Some("dev".into()),
            None,
        )
        .await
        .expect("prepare");
        let applied = apply_deployment(&pool, &prepared.id).await.expect("apply");

        sqlx::query("UPDATE repositories SET remote_url = 'https://example.invalid/demo.git' WHERE id = 'repo-1'")
            .execute(&pool)
            .await
            .expect("remote url");
        sqlx::query("UPDATE squash_sessions SET deploy_branch = 'dev' WHERE id = ?1")
            .bind(&applied.id)
            .execute(&pool)
            .await
            .expect("rename deploy branch");

        let error = push_deployment(&pool, &applied.id)
            .await
            .expect_err("must refuse");
        assert_eq!(error.code, "REFUSING_ENV_PUSH");
        cleanup_session(&pool, &applied).await;
        pool.close().await;
    }
}

