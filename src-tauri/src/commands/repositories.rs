use crate::commands::system::open_in_file_manager;
use crate::domain::branch_resolver::{self, BranchRef, Candidate, ResolveError};
use crate::domain::environment::{EnvironmentSpec, ResolutionMode};
use crate::error::{ApiError, AppError};
use crate::infra::{canonicalize_path, git_cli, git_reader};
use crate::state::AppState;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::path::{Path, PathBuf};
use tauri::State;
use uuid::Uuid;

// ─── DTOs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySummary {
    pub id: String,
    pub name: String,
    pub local_path: String,
    pub remote_name: String,
    pub remote_url: Option<String>,
    pub provider: String,
    pub github_owner: Option<String>,
    pub github_repo: Option<String>,
    pub base_branch: String,
    pub last_fetched_at: Option<String>,
    pub environments: Vec<EnvironmentState>,
    pub configured_count: usize,
    pub path_warning: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDetail {
    #[serde(flatten)]
    pub summary: RepositorySummary,
    pub branches: Vec<BranchInfo>,
    pub head_branch: Option<String>,
    pub default_branch: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentState {
    pub environment: String,
    pub label: String,
    pub color: String,
    pub position: i64,
    pub branch_name: Option<String>,
    pub mode: String,
    pub sha: Option<String>,
    pub resolved_at: Option<String>,
    pub note: String,
    pub ambiguous: bool,
    pub available: bool,
    pub uses_base_branch: bool,
    pub warning: Option<String>,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentDefinition {
    pub key: String,
    pub label: String,
    pub color: String,
    pub position: i64,
    pub aliases: Vec<String>,
    pub pattern: Option<String>,
    pub is_system: bool,
    pub resolved_count: i64,
    pub repository_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub sha: String,
    pub committed_at: String,
    pub author: Option<String>,
    pub message: Option<String>,
    pub is_remote: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub repository: RepositoryDetail,
    pub message: String,
    pub branch_count: usize,
    pub duration_ms: u128,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRepositoryInput {
    pub path: String,
    pub name: Option<String>,
    pub base_branch: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneRepositoryInput {
    pub url: String,
    pub parent_dir: String,
    pub folder_name: Option<String>,
    pub name: Option<String>,
    pub base_branch: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRepositoryInput {
    pub repository_id: String,
    pub name: Option<String>,
    pub base_branch: Option<String>,
    pub github_owner: Option<String>,
    pub github_repo: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetEnvironmentInput {
    pub repository_id: String,
    pub environment: String,
    pub mode: String,
    pub branch_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEnvironmentInput {
    pub key: String,
    pub label: Option<String>,
    pub color: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub pattern: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEnvironmentInput {
    pub key: String,
    pub label: Option<String>,
    pub color: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub pattern: Option<String>,
}

// ─── Filas ──────────────────────────────────────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
struct RepositoryRow {
    id: String,
    name: String,
    local_path: String,
    remote_name: String,
    remote_url: Option<String>,
    provider: String,
    github_owner: Option<String>,
    github_repo: Option<String>,
    base_branch: String,
    last_fetched_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, sqlx::FromRow)]
struct EnvironmentDefRow {
    key: String,
    label: String,
    color: String,
    position_no: i64,
    aliases_json: String,
    pattern: Option<String>,
    is_system: i64,
    resolved_count: i64,
    repository_count: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct EnvRow {
    environment: String,
    label: String,
    color: String,
    position_no: i64,
    aliases_json: String,
    pattern: Option<String>,
    branch_name: Option<String>,
    resolution_mode: Option<String>,
    resolved_sha: Option<String>,
    resolved_at: Option<String>,
    resolution_note: Option<String>,
}

impl EnvRow {
    fn spec(&self) -> EnvironmentSpec {
        let parsed: Vec<String> = serde_json::from_str(&self.aliases_json).unwrap_or_default();
        let aliases = if parsed.is_empty() {
            vec![self.environment.clone()]
        } else {
            parsed
        };
        EnvironmentSpec {
            key: self.environment.clone(),
            label: self.label.clone(),
            color: self.color.clone(),
            aliases,
            pattern: self.pattern.clone(),
        }
    }

    fn mode(&self) -> ResolutionMode {
        self.resolution_mode
            .as_deref()
            .and_then(ResolutionMode::from_key)
            .unwrap_or(ResolutionMode::Auto)
    }
}

// ─── Comandos ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn repositories_list(
    state: State<'_, AppState>,
) -> Result<Vec<RepositorySummary>, ApiError> {
    let pool = state.pool()?;
    let rows = sqlx::query_as::<_, RepositoryRow>(
        "SELECT id, name, local_path, remote_name, remote_url, provider, github_owner,
                github_repo, base_branch, last_fetched_at, created_at, updated_at
         FROM repositories
         WHERE is_active = 1
         ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let mut envs = load_envs(pool, &row.id).await?;
        if envs.iter().any(is_pending_environment) {
            if let Ok(snapshot) = git_reader::read_snapshot(Path::new(&row.local_path)) {
                detect_pending(pool, &row, &snapshot).await?;
                envs = load_envs(pool, &row.id).await?;
            }
        }
        result.push(summary_from_row(&row, &envs, None));
    }
    Ok(result)
}

#[tauri::command]
pub async fn repositories_get(
    state: State<'_, AppState>,
    repository_id: String,
) -> Result<RepositoryDetail, ApiError> {
    let pool = state.pool()?;
    let row = load_repository(pool, &repository_id).await?;
    ensure_environment_rows(pool, &row.id).await?;
    if let Ok(snapshot) = git_reader::read_snapshot(Path::new(&row.local_path)) {
        detect_pending(pool, &row, &snapshot).await?;
    }
    let envs = load_envs(pool, &row.id).await?;
    detail_from_row(&row, &envs).await
}

#[tauri::command]
pub async fn repositories_add(
    state: State<'_, AppState>,
    input: AddRepositoryInput,
) -> Result<RepositoryDetail, ApiError> {
    let pool = state.pool()?;
    let path = canonicalize_path(Path::new(input.path.trim()))?;
    add_from_path(
        pool,
        &path,
        input.name.as_deref(),
        input.base_branch.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn repositories_clone(
    state: State<'_, AppState>,
    input: CloneRepositoryInput,
) -> Result<RepositoryDetail, ApiError> {
    let pool = state.pool()?;
    let parent = PathBuf::from(input.parent_dir.trim());
    if !parent.exists() {
        std::fs::create_dir_all(&parent)?;
    }
    if !parent.is_dir() {
        return Err(AppError::Validation("La carpeta destino no es válida.".into()).into());
    }

    let folder = match input.folder_name.as_deref() {
        Some(value) if !value.trim().is_empty() => git_cli::sanitize_folder_name(value)?,
        _ => {
            let derived = input
                .url
                .trim_end_matches('/')
                .trim_end_matches(".git")
                .rsplit(['/', ':'])
                .next()
                .unwrap_or("repositorio");
            git_cli::sanitize_folder_name(derived)?
        }
    };

    let target = parent.join(&folder);
    if target.exists() {
        let empty = std::fs::read_dir(&target)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);
        if !empty {
            return Err(AppError::Validation(format!(
                "La carpeta destino ya existe y no está vacía: {}",
                target.display()
            ))
            .into());
        }
    }

    let run = git_cli::clone(input.url.trim(), &target)?;
    if !run.success {
        return Err(git_cli::invalidate_run(&run, "No se pudo clonar").into());
    }

    add_from_path(
        pool,
        &target,
        input.name.as_deref(),
        input.base_branch.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn repositories_update(
    state: State<'_, AppState>,
    input: UpdateRepositoryInput,
) -> Result<RepositoryDetail, ApiError> {
    let pool = state.pool()?;
    let row = load_repository(pool, &input.repository_id).await?;

    let name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&row.name)
        .to_string();

    let base_branch = input
        .base_branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&row.base_branch)
        .to_string();

    let snapshot = git_reader::read_snapshot(Path::new(&row.local_path)).ok();
    if let Some(snapshot) = snapshot.as_ref() {
        if !snapshot.branches.is_empty()
            && !snapshot
                .branches
                .iter()
                .any(|branch| branch.name.eq_ignore_ascii_case(&base_branch))
        {
            return Err(AppError::BranchNotFound(format!(
                "'{base_branch}' no existe en el repositorio."
            ))
            .into());
        }
    }

    let owner = input
        .github_owner
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| row.github_owner.clone());
    let repo = input
        .github_repo
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| row.github_repo.clone());

    sqlx::query(
        "UPDATE repositories
         SET name = ?1, base_branch = ?2, github_owner = ?3, github_repo = ?4, updated_at = ?5
         WHERE id = ?6",
    )
    .bind(&name)
    .bind(&base_branch)
    .bind(&owner)
    .bind(&repo)
    .bind(now())
    .bind(&row.id)
    .execute(pool)
    .await?;

    repositories_get(state, row.id).await
}

#[tauri::command]
pub async fn repositories_remove(
    state: State<'_, AppState>,
    repository_id: String,
    delete_local: Option<bool>,
) -> Result<(), ApiError> {
    let _ = delete_local.unwrap_or(false);
    let pool = state.pool()?;
    let row = load_repository(pool, &repository_id).await?;

    let active_runs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM deployment_runs
         WHERE repository_id = ?1
           AND state NOT IN ('done','failed','cancelled','blocked')",
    )
    .bind(&row.id)
    .fetch_one(pool)
    .await?;

    if active_runs > 0 {
        return Err(AppError::RepoBusy(
            "Hay un despliegue en curso asociado a este repositorio.".into(),
        )
        .into());
    }

    // Soft delete: nunca borramos la carpeta local ni el historial.
    sqlx::query("UPDATE repositories SET is_active = 0, updated_at = ?1 WHERE id = ?2")
        .bind(now())
        .bind(&row.id)
        .execute(pool)
        .await?;

    Ok(())
}

#[tauri::command]
pub async fn repositories_fetch(
    state: State<'_, AppState>,
    repository_id: String,
) -> Result<FetchResult, ApiError> {
    let pool = state.pool()?;
    let row = load_repository(pool, &repository_id).await?;
    let remote = row.remote_name.trim();
    if remote.is_empty() || row.remote_url.is_none() {
        return Err(
            AppError::Validation("El repositorio no tiene un remoto configurado.".into()).into(),
        );
    }

    let run = git_cli::fetch(Path::new(&row.local_path), remote)?;
    if !run.success {
        return Err(git_cli::invalidate_run(&run, "Falló git fetch").into());
    }

    sqlx::query("UPDATE repositories SET last_fetched_at = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(now())
        .bind(now())
        .bind(&row.id)
        .execute(pool)
        .await?;

    let updated = load_repository(pool, &row.id).await?;
    let snapshot = git_reader::read_snapshot(Path::new(&updated.local_path))?;
    detect_and_save(pool, &updated, &snapshot).await?;

    let envs = load_envs(pool, &updated.id).await?;
    let detail = detail_from_row(&updated, &envs).await?;
    let configured = detail.summary.configured_count;

    Ok(FetchResult {
        repository: detail,
        message: format!(
            "Fetch completado: {} ramas disponibles, {configured} ambientes resueltos.",
            snapshot.branches.len()
        ),
        branch_count: snapshot.branches.len(),
        duration_ms: run.duration_ms,
    })
}

#[tauri::command]
pub async fn repositories_detect_environments(
    state: State<'_, AppState>,
    repository_id: String,
) -> Result<RepositoryDetail, ApiError> {
    let pool = state.pool()?;
    let row = load_repository(pool, &repository_id).await?;
    let snapshot = git_reader::read_snapshot(Path::new(&row.local_path))?;
    detect_and_save(pool, &row, &snapshot).await?;

    let envs = load_envs(pool, &row.id).await?;
    detail_from_row(&row, &envs).await
}

#[tauri::command]
pub async fn repositories_set_environment(
    state: State<'_, AppState>,
    input: SetEnvironmentInput,
) -> Result<RepositoryDetail, ApiError> {
    let pool = state.pool()?;
    let row = load_repository(pool, &input.repository_id).await?;
    ensure_environment_rows(pool, &row.id).await?;
    let mode = ResolutionMode::from_key(&input.mode)
        .ok_or_else(|| AppError::Validation(format!("Modo desconocido: {}", input.mode)))?;

    let snapshot = git_reader::read_snapshot(Path::new(&row.local_path))?;
    let stored = load_envs(pool, &row.id)
        .await?
        .into_iter()
        .find(|env| env.environment == input.environment)
        .ok_or_else(|| {
            AppError::EnvironmentNotFound(format!(
                "'{}' no está en el catálogo.",
                input.environment
            ))
        })?;
    let spec = stored.spec();

    let (branch_name, sha, note) = match mode {
        ResolutionMode::Manual => {
            let requested = input
                .branch_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AppError::Validation("Selecciona una rama para el modo manual.".into())
                })?;

            let found = snapshot
                .branches
                .iter()
                .find(|branch| branch.name == requested)
                .or_else(|| {
                    snapshot
                        .branches
                        .iter()
                        .find(|branch| branch.name.eq_ignore_ascii_case(requested))
                })
                .ok_or_else(|| {
                    let available = snapshot
                        .branches
                        .iter()
                        .take(12)
                        .map(|branch| branch.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ");
                    AppError::EnvBranchNotFound(format!(
                        "'{requested}' no existe. Ramas disponibles: {available}"
                    ))
                })?;

            (
                Some(found.name.clone()),
                Some(found.sha.clone()),
                "Selección manual del usuario".to_string(),
            )
        }
        ResolutionMode::Auto => {
            let resolution =
                branch_resolver::resolve(&spec, &snapshot.branches, ResolutionMode::Auto, None)
                    .map_err(|error| AppError::EnvBranchNotFound(resolve_error_text(error)))?;

            (resolution.branch_name, resolution.sha, resolution.note)
        }
    };

    save_environment(
        pool,
        &row.id,
        &spec.key,
        mode,
        branch_name.as_deref(),
        sha.as_deref(),
        &note,
    )
    .await?;

    let envs = load_envs(pool, &row.id).await?;
    detail_from_row(&row, &envs).await
}

#[tauri::command]
pub async fn repositories_list_branches(
    state: State<'_, AppState>,
    repository_id: String,
    include_remote: Option<bool>,
) -> Result<Vec<BranchInfo>, ApiError> {
    let _ = include_remote;
    let pool = state.pool()?;
    let row = load_repository(pool, &repository_id).await?;
    let snapshot = git_reader::read_snapshot(Path::new(&row.local_path))?;
    Ok(snapshot.branches.iter().map(branch_info).collect())
}

#[tauri::command]
pub async fn environments_list(
    state: State<'_, AppState>,
) -> Result<Vec<EnvironmentDefinition>, ApiError> {
    let pool = state.pool()?;
    Ok(load_environment_definitions(pool).await?)
}

#[tauri::command]
pub async fn environments_create(
    state: State<'_, AppState>,
    input: CreateEnvironmentInput,
) -> Result<Vec<EnvironmentDefinition>, ApiError> {
    let pool = state.pool()?;
    let key = normalize_environment_key(&input.key)?;

    let existing: Option<i64> =
        sqlx::query_scalar("SELECT is_active FROM environments WHERE key = ?1")
            .bind(&key)
            .fetch_optional(pool)
            .await?;
    if existing == Some(1) {
        return Err(AppError::EnvironmentExists(format!("El ambiente '{key}' ya existe.")).into());
    }

    let position: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(position_no), -1) + 1 FROM environments")
            .fetch_one(pool)
            .await?;
    let label = normalize_label(input.label.as_deref(), &key)?;
    let color = normalize_color(input.color.as_deref())
        .unwrap_or_else(|| ENV_PALETTE[position as usize % ENV_PALETTE.len()].to_string());
    let aliases = normalize_aliases(input.aliases, &key);
    let pattern = normalize_pattern(input.pattern.as_deref())?;
    let now = now();

    if existing == Some(0) {
        // Restaurar un ambiente archivado: conserva sus filas por repositorio
        // y vuelve a entrar en la matriz al final.
        sqlx::query(
            "UPDATE environments
             SET label = ?1, color = ?2, position_no = ?3, aliases_json = ?4,
                 pattern = ?5, is_active = 1, updated_at = ?6
             WHERE key = ?7",
        )
        .bind(&label)
        .bind(&color)
        .bind(position)
        .bind(serde_json::to_string(&aliases).unwrap_or_else(|_| "[]".into()))
        .bind(&pattern)
        .bind(&now)
        .bind(&key)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO environments
               (key, label, color, position_no, aliases_json, pattern,
                is_system, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1, ?7, ?7)",
        )
        .bind(&key)
        .bind(&label)
        .bind(&color)
        .bind(position)
        .bind(serde_json::to_string(&aliases).unwrap_or_else(|_| "[]".into()))
        .bind(&pattern)
        .bind(&now)
        .execute(pool)
        .await?;
    }

    ensure_environment_rows_all(pool).await?;
    redetect_environment_all(pool, &key).await?;
    Ok(load_environment_definitions(pool).await?)
}

#[tauri::command]
pub async fn environments_update(
    state: State<'_, AppState>,
    input: UpdateEnvironmentInput,
) -> Result<Vec<EnvironmentDefinition>, ApiError> {
    let pool = state.pool()?;
    let existing = load_environment_definition(pool, &input.key).await?;
    let label = input
        .label
        .as_deref()
        .map(|value| normalize_label(Some(value), &existing.key))
        .transpose()?
        .unwrap_or(existing.label);
    let color = input
        .color
        .as_deref()
        .and_then(|value| normalize_color(Some(value)))
        .unwrap_or(existing.color);
    let aliases = match input.aliases {
        Some(values) => normalize_aliases(Some(values), &existing.key),
        None => existing.aliases,
    };
    let pattern = match input.pattern.as_deref() {
        Some(value) => normalize_pattern(Some(value))?,
        None => existing.pattern,
    };

    sqlx::query(
        "UPDATE environments
         SET label = ?1, color = ?2, aliases_json = ?3, pattern = ?4, updated_at = ?5
         WHERE key = ?6",
    )
    .bind(&label)
    .bind(&color)
    .bind(serde_json::to_string(&aliases).unwrap_or_else(|_| "[]".into()))
    .bind(&pattern)
    .bind(now())
    .bind(&existing.key)
    .execute(pool)
    .await?;

    redetect_environment_all(pool, &existing.key).await?;
    Ok(load_environment_definitions(pool).await?)
}

#[tauri::command]
pub async fn environments_archive(
    state: State<'_, AppState>,
    key: String,
) -> Result<Vec<EnvironmentDefinition>, ApiError> {
    let pool = state.pool()?;
    let existing = load_environment_definition(pool, &key).await?;
    if existing.is_system {
        return Err(AppError::ProtectedEnvironment(format!(
            "El ambiente '{}' es parte del sistema.",
            existing.label
        ))
        .into());
    }

    sqlx::query("UPDATE environments SET is_active = 0, updated_at = ?1 WHERE key = ?2")
        .bind(now())
        .bind(&existing.key)
        .execute(pool)
        .await?;

    Ok(load_environment_definitions(pool).await?)
}

#[tauri::command]
pub async fn environments_reorder(
    state: State<'_, AppState>,
    keys: Vec<String>,
) -> Result<Vec<EnvironmentDefinition>, ApiError> {
    let pool = state.pool()?;
    for (index, key) in keys.iter().enumerate() {
        sqlx::query(
            "UPDATE environments SET position_no = ?1, updated_at = ?2
             WHERE key = ?3 AND is_active = 1",
        )
        .bind(index as i64)
        .bind(now())
        .bind(key)
        .execute(pool)
        .await?;
    }
    Ok(load_environment_definitions(pool).await?)
}

async fn load_environment_definitions(
    pool: &SqlitePool,
) -> Result<Vec<EnvironmentDefinition>, AppError> {
    let rows = sqlx::query_as::<_, EnvironmentDefRow>(
        "SELECT e.key, e.label, e.color, e.position_no, e.aliases_json, e.pattern, e.is_system,
                (SELECT COUNT(*) FROM repositories r WHERE r.is_active = 1) AS repository_count,
                (SELECT COUNT(*) FROM repo_environments re
                   JOIN repositories r ON r.id = re.repository_id
                  WHERE re.environment = e.key
                    AND r.is_active = 1
                    AND re.branch_name IS NOT NULL) AS resolved_count
         FROM environments e
         WHERE e.is_active = 1
         ORDER BY e.position_no, e.label",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let aliases: Vec<String> =
                serde_json::from_str(&row.aliases_json).unwrap_or_else(|_| vec![row.key.clone()]);
            EnvironmentDefinition {
                key: row.key,
                label: row.label,
                color: row.color,
                position: row.position_no,
                aliases,
                pattern: row.pattern,
                is_system: row.is_system == 1,
                resolved_count: row.resolved_count,
                repository_count: row.repository_count,
            }
        })
        .collect())
}

async fn load_environment_definition(
    pool: &SqlitePool,
    key: &str,
) -> Result<EnvironmentDefinition, AppError> {
    load_environment_definitions(pool)
        .await?
        .into_iter()
        .find(|environment| environment.key == key)
        .ok_or_else(|| AppError::EnvironmentNotFound(key.to_string()))
}

async fn ensure_environment_rows_all(pool: &SqlitePool) -> Result<(), AppError> {
    let repository_ids: Vec<String> =
        sqlx::query_scalar("SELECT id FROM repositories WHERE is_active = 1")
            .fetch_all(pool)
            .await?;
    for repository_id in repository_ids {
        ensure_environment_rows(pool, &repository_id).await?;
    }
    Ok(())
}

async fn redetect_environment_all(pool: &SqlitePool, key: &str) -> Result<(), AppError> {
    let definition = match load_environment_definition(pool, key).await {
        Ok(definition) => definition,
        Err(_) => return Ok(()),
    };
    let spec = EnvironmentSpec {
        key: definition.key.clone(),
        label: definition.label.clone(),
        color: definition.color.clone(),
        aliases: definition.aliases.clone(),
        pattern: definition.pattern.clone(),
    };

    let repositories: Vec<(String, String)> =
        sqlx::query_as("SELECT id, local_path FROM repositories WHERE is_active = 1")
            .fetch_all(pool)
            .await?;

    for (repository_id, local_path) in repositories {
        ensure_environment_rows(pool, &repository_id).await?;
        let mode: Option<String> = sqlx::query_scalar::<_, Option<String>>(
            "SELECT resolution_mode FROM repo_environments
             WHERE repository_id = ?1 AND environment = ?2",
        )
        .bind(&repository_id)
        .bind(key)
        .fetch_optional(pool)
        .await?
        .flatten();
        if mode.as_deref() == Some("manual") {
            continue;
        }

        let Ok(snapshot) = git_reader::read_snapshot(Path::new(&local_path)) else {
            continue;
        };
        let resolution =
            branch_resolver::resolve(&spec, &snapshot.branches, ResolutionMode::Auto, None)
                .map_err(|error| AppError::EnvBranchNotFound(resolve_error_text(error)))?;
        save_environment(
            pool,
            &repository_id,
            &spec.key,
            ResolutionMode::Auto,
            resolution.branch_name.as_deref(),
            resolution.sha.as_deref(),
            &resolution.note,
        )
        .await?;
    }
    Ok(())
}

const ENV_PALETTE: [&str; 8] = [
    "#6aa8ff", "#f5b84b", "#b08cff", "#3dd68c", "#ff8fab", "#4dd0e1", "#f48fb1", "#a3e635",
];

fn normalize_environment_key(raw: &str) -> Result<String, AppError> {
    let key = raw.trim().to_lowercase();
    let valid = key.len() >= 2
        && key.len() <= 24
        && key
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
        && key.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        });
    if !valid {
        return Err(AppError::Validation(
            "La clave debe tener 2-24 caracteres: letras minúsculas, números o guiones, y empezar con letra.".into(),
        ));
    }
    Ok(key)
}

fn normalize_label(raw: Option<&str>, key: &str) -> Result<String, AppError> {
    let label = raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| key.to_uppercase());
    if label.chars().count() > 40 {
        return Err(AppError::Validation(
            "La etiqueta del ambiente no puede superar 40 caracteres.".into(),
        ));
    }
    Ok(label)
}

fn normalize_color(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    let valid = value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit());
    valid.then(|| value.to_string())
}

fn normalize_aliases(raw: Option<Vec<String>>, key: &str) -> Vec<String> {
    let mut aliases: Vec<String> = Vec::new();
    for alias in raw.unwrap_or_default() {
        let alias = alias.trim().to_string();
        if alias.is_empty() {
            continue;
        }
        if aliases
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&alias))
        {
            continue;
        }
        aliases.push(alias);
    }
    if aliases.is_empty() {
        aliases.push(key.to_string());
    }
    aliases
}

fn normalize_pattern(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let valid = value.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '*' | '/' | '-' | '_' | '.')
    });
    if !valid {
        return Err(AppError::Validation(
            "El patrón solo puede usar letras, números, *, /, -, _ y .".into(),
        ));
    }
    Ok(Some(value.to_string()))
}

#[tauri::command]
pub async fn repositories_open_folder(
    state: State<'_, AppState>,
    repository_id: String,
) -> Result<String, ApiError> {
    let pool = state.pool()?;
    let row = load_repository(pool, &repository_id).await?;
    let path = Path::new(&row.local_path);
    open_in_file_manager(path)?;
    Ok(row.local_path)
}

// ─── Lógica de alta ─────────────────────────────────────────────────────────

async fn add_from_path(
    pool: &SqlitePool,
    path: &Path,
    name: Option<&str>,
    base_branch: Option<&str>,
) -> Result<RepositoryDetail, ApiError> {
    let snapshot = git_reader::read_snapshot(path)?;
    let canonical = canonicalize_path(path)?;
    let local_path = canonical.to_string_lossy().to_string();

    let existing = sqlx::query("SELECT id, is_active FROM repositories WHERE local_path = ?1")
        .bind(&local_path)
        .fetch_optional(pool)
        .await?;

    if let Some(ref existing) = existing {
        let is_active: i64 = existing.try_get("is_active")?;
        if is_active == 1 {
            return Err(
                AppError::RepoExists(format!("La ruta ya está registrada: {local_path}")).into(),
            );
        }
    }

    let existing_id: Option<String> = existing
        .as_ref()
        .and_then(|row| row.try_get::<String, _>("id").ok());
    let id = existing_id.unwrap_or_else(|| Uuid::now_v7().to_string());

    let fallback_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "repositorio".to_string());
    let name = name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&fallback_name)
        .to_string();

    let base_branch = base_branch
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&snapshot.default_branch)
        .to_string();

    if !snapshot.branches.is_empty()
        && !snapshot
            .branches
            .iter()
            .any(|branch| branch.name.eq_ignore_ascii_case(&base_branch))
    {
        return Err(AppError::BranchNotFound(format!(
            "La rama base '{base_branch}' no existe en el repositorio."
        ))
        .into());
    }

    let (github_owner, github_repo) = snapshot
        .remote_url
        .as_deref()
        .and_then(git_reader::github_slug)
        .map(|(owner, repo)| (Some(owner), Some(repo)))
        .unwrap_or((None, None));
    let provider = if github_owner.is_some() {
        "github"
    } else {
        "generic"
    };
    let remote_name = snapshot
        .remote_name
        .clone()
        .unwrap_or_else(|| "origin".to_string());
    let now = now();

    sqlx::query(
        "INSERT INTO repositories
           (id, name, local_path, remote_name, remote_url, provider, github_owner,
            github_repo, base_branch, is_active, last_fetched_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, NULL, ?10, ?10)
         ON CONFLICT(local_path) DO UPDATE SET
           name = excluded.name,
           remote_name = excluded.remote_name,
           remote_url = excluded.remote_url,
           provider = excluded.provider,
           github_owner = excluded.github_owner,
           github_repo = excluded.github_repo,
           base_branch = excluded.base_branch,
           is_active = 1,
           updated_at = excluded.updated_at",
    )
    .bind(&id)
    .bind(&name)
    .bind(&local_path)
    .bind(&remote_name)
    .bind(&snapshot.remote_url)
    .bind(provider)
    .bind(&github_owner)
    .bind(&github_repo)
    .bind(&base_branch)
    .bind(&now)
    .execute(pool)
    .await?;

    ensure_environment_rows(pool, &id).await?;
    let row = load_repository(pool, &id).await?;
    detect_and_save(pool, &row, &snapshot).await?;

    let envs = load_envs(pool, &id).await?;
    detail_from_row(&row, &envs).await
}

// ─── Detección y persistencia ───────────────────────────────────────────────

fn is_pending_environment(environment: &EnvRow) -> bool {
    environment
        .resolution_note
        .as_deref()
        .map(|note| note == "Pendiente de detección")
        .unwrap_or(environment.branch_name.is_none())
}

/// Resuelve los ambientes que todavía no tienen una detección persistida.
/// Se usa al abrir el repositorio y después de una migración del catálogo.
async fn detect_pending(
    pool: &SqlitePool,
    row: &RepositoryRow,
    snapshot: &git_reader::RepoSnapshot,
) -> Result<(), AppError> {
    let envs = load_envs(pool, &row.id).await?;
    for env_row in envs {
        if !is_pending_environment(&env_row) || env_row.mode() == ResolutionMode::Manual {
            continue;
        }
        let spec = env_row.spec();
        match branch_resolver::resolve(&spec, &snapshot.branches, ResolutionMode::Auto, None) {
            Ok(resolution) => {
                save_environment(
                    pool,
                    &row.id,
                    &spec.key,
                    ResolutionMode::Auto,
                    resolution.branch_name.as_deref(),
                    resolution.sha.as_deref(),
                    &resolution.note,
                )
                .await?;
            }
            Err(ResolveError::ManualBranchNotFound(_)) => {}
        }
    }
    Ok(())
}

async fn detect_and_save(
    pool: &SqlitePool,
    row: &RepositoryRow,
    snapshot: &git_reader::RepoSnapshot,
) -> Result<(), AppError> {
    ensure_environment_rows(pool, &row.id).await?;
    let envs = load_envs(pool, &row.id).await?;

    for env_row in envs {
        let spec = env_row.spec();
        let mode = env_row.mode();
        let manual_branch = env_row.branch_name.as_deref();

        match branch_resolver::resolve(&spec, &snapshot.branches, mode, manual_branch) {
            Ok(resolution) => {
                save_environment(
                    pool,
                    &row.id,
                    &spec.key,
                    mode,
                    resolution.branch_name.as_deref(),
                    resolution.sha.as_deref(),
                    &resolution.note,
                )
                .await?;
            }
            Err(ResolveError::ManualBranchNotFound(branch)) => {
                let note = format!(
                    "La rama manual '{branch}' ya no existe en el repositorio. Elige otra rama."
                );
                save_environment(pool, &row.id, &spec.key, mode, None, None, &note).await?;
            }
        }
    }

    Ok(())
}

async fn ensure_environment_rows(pool: &SqlitePool, repository_id: &str) -> Result<(), AppError> {
    let keys: Vec<String> = sqlx::query_scalar(
        "SELECT key FROM environments WHERE is_active = 1 ORDER BY position_no, key",
    )
    .fetch_all(pool)
    .await?;

    for key in keys {
        sqlx::query(
            "INSERT INTO repo_environments
               (id, repository_id, environment, branch_name, resolution_mode,
                resolved_sha, resolved_at, resolution_note, updated_at)
             VALUES (?1, ?2, ?3, NULL, 'auto', NULL, NULL, 'Pendiente de detección', ?4)
             ON CONFLICT(repository_id, environment) DO NOTHING",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(repository_id)
        .bind(key)
        .bind(now())
        .execute(pool)
        .await?;
    }
    Ok(())
}

async fn save_environment(
    pool: &SqlitePool,
    repository_id: &str,
    environment: &str,
    mode: ResolutionMode,
    branch_name: Option<&str>,
    sha: Option<&str>,
    note: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE repo_environments
         SET branch_name = ?1,
             resolution_mode = ?2,
             resolved_sha = ?3,
             resolved_at = ?4,
             resolution_note = ?5,
             updated_at = ?6
         WHERE repository_id = ?7 AND environment = ?8",
    )
    .bind(branch_name)
    .bind(mode.as_str())
    .bind(sha)
    .bind(now())
    .bind(note)
    .bind(now())
    .bind(repository_id)
    .bind(environment)
    .execute(pool)
    .await?;
    Ok(())
}

// ─── Lectura y DTOs ─────────────────────────────────────────────────────────

async fn load_repository(
    pool: &SqlitePool,
    repository_id: &str,
) -> Result<RepositoryRow, AppError> {
    sqlx::query_as::<_, RepositoryRow>(
        "SELECT id, name, local_path, remote_name, remote_url, provider, github_owner,
                github_repo, base_branch, last_fetched_at, created_at, updated_at
         FROM repositories
         WHERE id = ?1 AND is_active = 1",
    )
    .bind(repository_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("el repositorio".into()))
}

async fn load_envs(pool: &SqlitePool, repository_id: &str) -> Result<Vec<EnvRow>, AppError> {
    let rows = sqlx::query_as::<_, EnvRow>(
        "SELECT e.key AS environment,
                e.label,
                e.color,
                e.position_no,
                e.aliases_json,
                e.pattern,
                re.branch_name,
                re.resolution_mode,
                re.resolved_sha,
                re.resolved_at,
                re.resolution_note
         FROM environments e
         LEFT JOIN repo_environments re
           ON re.repository_id = ?1 AND re.environment = e.key
         WHERE e.is_active = 1
         ORDER BY e.position_no, e.label",
    )
    .bind(repository_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

async fn detail_from_row(
    row: &RepositoryRow,
    envs: &[EnvRow],
) -> Result<RepositoryDetail, ApiError> {
    let path = Path::new(&row.local_path);
    let (snapshot, snapshot_error) = match git_reader::read_snapshot(path) {
        Ok(snapshot) => (Some(snapshot), None),
        Err(error) => (None, Some(error.to_string())),
    };

    let branches: Vec<BranchInfo> = snapshot
        .as_ref()
        .map(|snapshot| snapshot.branches.iter().map(branch_info).collect())
        .unwrap_or_default();

    let summary = summary_from_row(row, envs, snapshot.as_ref());

    let mut detail = RepositoryDetail {
        summary,
        branches,
        head_branch: snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.head_branch.clone()),
        default_branch: snapshot
            .as_ref()
            .map(|snapshot| snapshot.default_branch.clone())
            .unwrap_or_else(|| row.base_branch.clone()),
        created_at: row.created_at.clone(),
        updated_at: row.updated_at.clone(),
    };

    if let Some(error) = snapshot_error {
        detail.summary.warnings.push(error);
    }

    Ok(detail)
}

fn summary_from_row(
    row: &RepositoryRow,
    envs: &[EnvRow],
    snapshot: Option<&git_reader::RepoSnapshot>,
) -> RepositorySummary {
    let base_branch = row.base_branch.clone();
    let mut environments = environment_states(envs, snapshot, &base_branch);
    let configured_count = environments
        .iter()
        .filter(|environment| environment.available)
        .count();

    let path_warning = snapshot
        .and_then(|snapshot| snapshot.path_warning.clone())
        .or_else(|| git_reader::path_warning(Path::new(&row.local_path)));

    let mut warnings = Vec::new();
    if let Some(warning) = path_warning.clone() {
        warnings.push(warning);
    }
    if row.remote_url.is_none() {
        warnings.push(
            "El repositorio no tiene remoto configurado; los ambientes solo pueden detectarse en local."
                .into(),
        );
    }
    let unresolved = environments
        .iter()
        .filter(|environment| !environment.available)
        .count();
    if unresolved > 0 {
        warnings.push(format!(
            "{unresolved} ambiente(s) sin rama detectada. Actualiza o configura una rama manualmente."
        ));
    }

    // Ramas compartidas entre ambientes.
    for left in 0..environments.len() {
        for right in (left + 1)..environments.len() {
            let left_branch = environments[left].branch_name.clone();
            let right_branch = environments[right].branch_name.clone();
            if let (Some(left_branch), Some(right_branch)) = (left_branch, right_branch) {
                if left_branch.eq_ignore_ascii_case(&right_branch) {
                    let message = format!(
                        "{} y {} apuntan a la misma rama: {left_branch}",
                        environments[left].label, environments[right].label
                    );
                    warnings.push(message.clone());
                    if environments[left].warning.is_none() {
                        environments[left].warning = Some(message.clone());
                    }
                    if environments[right].warning.is_none() {
                        environments[right].warning = Some(message);
                    }
                }
            }
        }
    }

    RepositorySummary {
        id: row.id.clone(),
        name: row.name.clone(),
        local_path: row.local_path.clone(),
        remote_name: row.remote_name.clone(),
        remote_url: row.remote_url.clone(),
        provider: row.provider.clone(),
        github_owner: row.github_owner.clone(),
        github_repo: row.github_repo.clone(),
        base_branch,
        last_fetched_at: row.last_fetched_at.clone(),
        environments,
        configured_count,
        path_warning,
        warnings,
    }
}

fn environment_states(
    envs: &[EnvRow],
    snapshot: Option<&git_reader::RepoSnapshot>,
    base_branch: &str,
) -> Vec<EnvironmentState> {
    let mut states = Vec::new();

    for env_row in envs {
        let spec = env_row.spec();
        let mode = env_row.mode();

        let mut ambiguous = false;
        let mut candidates = Vec::new();
        if let Some(snapshot) = snapshot {
            if let Ok(resolution) = branch_resolver::resolve(
                &spec,
                &snapshot.branches,
                mode,
                env_row.branch_name.as_deref(),
            ) {
                ambiguous = resolution.ambiguous;
                candidates = resolution.candidates;
            }
        }

        let branch_exists = env_row.branch_name.as_ref().map(|branch| {
            snapshot
                .map(|snapshot| {
                    snapshot
                        .branches
                        .iter()
                        .any(|candidate| candidate.name.eq_ignore_ascii_case(branch))
                })
                .unwrap_or(true)
        });

        let mut warning = None;
        if branch_exists == Some(false) {
            warning = Some(
                "La rama configurada ya no existe en el repositorio. Elige otra o vuelve a detectar."
                    .into(),
            );
        }

        let uses_base_branch = env_row
            .branch_name
            .as_deref()
            .map(|branch| branch.eq_ignore_ascii_case(base_branch))
            .unwrap_or(false);

        if warning.is_none() && uses_base_branch && spec.key == "prd" {
            warning = Some(
                "PRD apunta a la rama base. Verifica que sea intencional antes de desplegar."
                    .into(),
            );
        }

        states.push(EnvironmentState {
            environment: spec.key.clone(),
            label: spec.label.clone(),
            color: spec.color.clone(),
            position: env_row.position_no,
            branch_name: env_row.branch_name.clone(),
            mode: mode.as_str().to_string(),
            sha: env_row.resolved_sha.clone(),
            resolved_at: env_row.resolved_at.clone(),
            note: env_row
                .resolution_note
                .clone()
                .filter(|note| !note.trim().is_empty())
                .unwrap_or_else(|| "Pendiente de detección".into()),
            ambiguous,
            available: env_row.branch_name.is_some() && branch_exists != Some(false),
            uses_base_branch,
            warning,
            candidates,
        });
    }

    states
}

fn branch_info(branch: &BranchRef) -> BranchInfo {
    BranchInfo {
        name: branch.name.clone(),
        sha: branch.sha.clone(),
        committed_at: branch
            .committed_at
            .to_rfc3339_opts(SecondsFormat::Secs, true),
        author: branch.author.clone(),
        message: branch.message.clone(),
        is_remote: branch.is_remote,
    }
}

fn resolve_error_text(error: ResolveError) -> String {
    match error {
        ResolveError::ManualBranchNotFound(branch) => {
            format!("La rama '{branch}' no existe en el repositorio.")
        }
    }
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_repo(path: &Path) {
        let repo = git2::Repository::init(path).expect("init repo");
        std::fs::write(path.join("README.md"), "# demo\n").expect("write file");

        let mut index = repo.index().expect("index");
        index.add_path(Path::new("README.md")).expect("add");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let signature =
            git2::Signature::now("FlowManager Test", "test@flowmanager.local").expect("sig");
        let oid = repo
            .commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
            .expect("commit");
        let commit = repo.find_commit(oid).expect("find commit");

        for branch in ["main", "dev", "release/1.0.5", "release/1.0.9"] {
            repo.branch(branch, &commit, false).expect("branch");
        }
    }

    #[tokio::test]
    async fn adds_repository_and_detects_environments() {
        let dir = tempfile::tempdir().expect("temp dir");
        let repo_path = dir.path().join("demo-repo");
        std::fs::create_dir_all(&repo_path).expect("repo dir");
        create_repo(&repo_path);

        let db_path = dir.path().join("flowmanager.db");
        let backups = dir.path().join("backups");
        let pool = crate::db::connect(&db_path, &backups)
            .await
            .expect("database");

        let detail = add_from_path(&pool, &repo_path, Some("Demo"), Some("main"))
            .await
            .expect("add repo");

        assert_eq!(detail.summary.name, "Demo");
        assert_eq!(detail.summary.base_branch, "main");
        assert_eq!(detail.summary.environments.len(), 5);
        assert!(detail.summary.configured_count >= 3);

        let qas = detail
            .summary
            .environments
            .iter()
            .find(|environment| environment.environment == "qas")
            .expect("qas");
        assert_eq!(qas.branch_name.as_deref(), Some("release/1.0.9"));
        assert!(qas.note.contains("release/*"));

        let dev = detail
            .summary
            .environments
            .iter()
            .find(|environment| environment.environment == "dev")
            .expect("dev");
        assert_eq!(dev.branch_name.as_deref(), Some("dev"));

        let prd = detail
            .summary
            .environments
            .iter()
            .find(|environment| environment.environment == "prd")
            .expect("prd");
        assert_eq!(prd.branch_name.as_deref(), Some("main"));
        assert!(prd.uses_base_branch);

        let uat = detail
            .summary
            .environments
            .iter()
            .find(|environment| environment.environment == "uat")
            .expect("uat");
        assert!(uat.branch_name.is_none());

        let stage = detail
            .summary
            .environments
            .iter()
            .find(|environment| environment.environment == "stage")
            .expect("stage");
        assert!(stage.branch_name.is_none());
        assert_eq!(stage.color, "#4dd0e1");

        // El repositorio ya está registrado y no se duplica.
        let duplicate = add_from_path(&pool, &repo_path, Some("Demo"), Some("main")).await;
        assert!(duplicate.is_err());

        pool.close().await;
    }
}
