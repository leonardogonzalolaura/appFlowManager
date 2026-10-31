use crate::error::{ApiError, AppError};
use crate::infra::branch_ops::{self, BranchAnalysis, BranchCheck};
use crate::infra::git_cli;
use crate::state::AppState;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::Path;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchTargetInput {
    pub requirement_id: String,
    pub repository_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCreateInput {
    pub requirement_id: String,
    pub repository_id: String,
    pub strategy: String,
    pub push: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchAnalyzeInput {
    pub requirement_id: String,
    pub repository_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchOperationResult {
    pub branch_name: String,
    pub base_branch: String,
    pub base_sha: Option<String>,
    pub local_existed: bool,
    pub remote_existed: bool,
    pub created: bool,
    pub preserved: bool,
    pub recreated: bool,
    pub pushed: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryBranchAnalysis {
    pub repository_id: String,
    pub repository_name: String,
    #[serde(flatten)]
    pub analysis: BranchAnalysis,
}

#[derive(Debug, sqlx::FromRow)]
struct BranchTargetRow {
    external_key: String,
    repository_id: String,
    branch_name: String,
    base_branch: String,
    local_path: String,
    remote_name: String,
    remote_url: Option<String>,
    repository_name: String,
    created_by_app: i64,
}

#[tauri::command]
pub async fn branches_check(
    state: State<'_, AppState>,
    input: BranchTargetInput,
) -> Result<BranchCheck, ApiError> {
    let pool = state.pool()?;
    let target = load_target(pool, &input.requirement_id, &input.repository_id).await?;

    let (fetched, fetch_error) = if target.remote_url.is_some() {
        match git_cli::fetch_base(
            Path::new(&target.local_path),
            &target.remote_name,
            &target.base_branch,
        ) {
            Ok(run) if run.success => (true, None),
            Ok(run) => (
                false,
                Some(
                    git_cli::invalidate_run(&run, "No se pudo actualizar la base desde el remoto")
                        .to_string(),
                ),
            ),
            Err(error) => (false, Some(error.to_string())),
        }
    } else {
        (false, None)
    };

    let mut check = branch_ops::check(
        Path::new(&target.local_path),
        &target.remote_name,
        &target.branch_name,
        &target.base_branch,
        &target.external_key,
    )?;
    check.fetched = fetched;
    check.fetch_error = fetch_error;
    Ok(check)
}

#[tauri::command]
pub async fn branches_create(
    state: State<'_, AppState>,
    input: BranchCreateInput,
) -> Result<BranchOperationResult, ApiError> {
    let pool = state.pool()?;
    let target = load_target(pool, &input.requirement_id, &input.repository_id).await?;
    let repo_path = Path::new(&target.local_path);
    git_cli::validate_branch_name(&target.branch_name)?;

    // Garantizar que la base se tome del último estado del remoto.
    if target.remote_url.is_some() {
        let run = git_cli::fetch_base(repo_path, &target.remote_name, &target.base_branch)?;
        if !run.success {
            return Err(git_cli::invalidate_run(
                &run,
                "No se pudo actualizar la base desde origin; la rama no se creó",
            )
            .into());
        }
    }

    let check = branch_ops::check(
        repo_path,
        &target.remote_name,
        &target.branch_name,
        &target.base_branch,
        &target.external_key,
    )?;

    let recreate = match input.strategy.as_str() {
        "preserve" => false,
        "recreate" => true,
        other => {
            return Err(
                AppError::Validation(format!("Estrategia de rama desconocida: {other}")).into(),
            )
        }
    };

    if target.branch_name.trim() == target.base_branch.trim() {
        return Err(AppError::Validation(
            "La rama del requerimiento no puede ser la misma que la rama base.".into(),
        )
        .into());
    }

    if recreate && check.remote_exists {
        return Err(AppError::BranchExistsRemote(format!(
            "La rama '{}' ya existe en {}. No se puede recrear sin sobrescribir el remoto. Conserva la existente o elimínala manualmente.",
            target.branch_name, target.remote_name
        ))
        .into());
    }

    let mut created = false;
    let mut preserved = false;
    let mut recreated = false;
    let mut tracking_remote = false;

    if check.local_exists {
        if recreate {
            let run = git_cli::delete_local_branch(repo_path, &target.branch_name)?;
            if !run.success {
                return Err(git_cli::invalidate_run(
                    &run,
                    "No se pudo eliminar la rama local para recrearla",
                )
                .into());
            }
            let run = git_cli::create_branch(repo_path, &target.branch_name, &check.base_ref)?;
            if !run.success {
                return Err(git_cli::invalidate_run(&run, "No se pudo crear la rama").into());
            }
            created = true;
            recreated = true;
        } else {
            preserved = true;
        }
    } else if check.remote_exists {
        let remote_ref = format!("{}/{}", target.remote_name, target.branch_name);
        let run = git_cli::create_tracking_branch(repo_path, &target.branch_name, &remote_ref)?;
        if !run.success {
            return Err(git_cli::invalidate_run(
                &run,
                "No se pudo crear la rama local desde el remoto",
            )
            .into());
        }
        created = true;
        preserved = true;
        tracking_remote = true;
    } else {
        let run = git_cli::create_branch(repo_path, &target.branch_name, &check.base_ref)?;
        if !run.success {
            return Err(git_cli::invalidate_run(&run, "No se pudo crear la rama").into());
        }
        created = true;
    }

    let now = now();
    let branch_status = if created && !tracking_remote {
        "created"
    } else {
        "existing"
    };
    let created_by_app = if created && !tracking_remote {
        1
    } else {
        target.created_by_app
    };

    sqlx::query(
        "UPDATE requirement_repositories
         SET branch_status = ?1,
             base_sha = ?2,
             branch_created_at = COALESCE(branch_created_at, ?3),
             created_by_app = ?4,
             updated_at = ?3
         WHERE requirement_id = ?5 AND repository_id = ?6",
    )
    .bind(branch_status)
    .bind(&check.base_sha)
    .bind(&now)
    .bind(created_by_app)
    .bind(&input.requirement_id)
    .bind(&input.repository_id)
    .execute(pool)
    .await?;

    let push_requested = input.push.unwrap_or(false);
    let pushed = if push_requested && !check.remote_exists {
        if target.remote_url.is_none() {
            return Err(AppError::Validation(
                "El repositorio no tiene remoto configurado para empujar la rama.".into(),
            )
            .into());
        }
        let run = git_cli::push_branch(repo_path, &target.remote_name, &target.branch_name)?;
        if !run.success {
            return Err(git_cli::invalidate_run(&run, "No se pudo empujar la rama").into());
        }
        true
    } else {
        false
    };

    let message = if recreated {
        format!(
            "Rama '{}' recreada desde {}.",
            target.branch_name, target.base_branch
        )
    } else if tracking_remote {
        format!(
            "Rama local '{}' creada siguiendo {}/{}.",
            target.branch_name, target.remote_name, target.branch_name
        )
    } else if preserved {
        format!("Se conservó la rama local '{}'.", target.branch_name)
    } else {
        format!(
            "Rama '{}' creada desde {}.",
            target.branch_name, target.base_branch
        )
    };

    Ok(BranchOperationResult {
        branch_name: target.branch_name,
        base_branch: target.base_branch,
        base_sha: check.base_sha,
        local_existed: check.local_exists,
        remote_existed: check.remote_exists,
        created,
        preserved,
        recreated,
        pushed,
        message,
    })
}

#[tauri::command]
pub async fn branches_analyze(
    state: State<'_, AppState>,
    input: BranchAnalyzeInput,
) -> Result<Vec<RepositoryBranchAnalysis>, ApiError> {
    let pool = state.pool()?;
    let key: String = sqlx::query_scalar("SELECT external_key FROM requirements WHERE id = ?1")
        .bind(&input.requirement_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("el requerimiento".into()))?;

    let targets = load_targets(pool, &input.requirement_id, input.repository_id.as_deref()).await?;
    if targets.is_empty() {
        return Ok(Vec::new());
    }

    let mut result = Vec::new();
    for target in targets {
        let analysis = branch_ops::analyze(
            Path::new(&target.local_path),
            &target.remote_name,
            &target.branch_name,
            &target.base_branch,
            &key,
        )?;
        let analyzed_at = now();
        let json = serde_json::to_string(&analysis).map_err(|error| {
            AppError::Internal(format!("No se pudo guardar el análisis: {error}"))
        })?;

        sqlx::query(
            "UPDATE requirement_repositories
             SET last_analyzed_at = ?1,
                 last_analysis_json = ?2,
                 branch_status = CASE
                   WHEN ?3 = 'branch_missing' THEN 'missing'
                   WHEN branch_status = 'created' THEN 'created'
                   ELSE 'existing'
                 END,
                 updated_at = ?1
             WHERE requirement_id = ?4 AND repository_id = ?5",
        )
        .bind(&analyzed_at)
        .bind(json)
        .bind(&analysis.status)
        .bind(&input.requirement_id)
        .bind(&target.repository_id)
        .execute(pool)
        .await?;

        result.push(RepositoryBranchAnalysis {
            repository_id: target.repository_id,
            repository_name: target.repository_name,
            analysis,
        });
    }

    Ok(result)
}

async fn load_target(
    pool: &SqlitePool,
    requirement_id: &str,
    repository_id: &str,
) -> Result<BranchTargetRow, AppError> {
    sqlx::query_as::<_, BranchTargetRow>(
        "SELECT req.external_key,
                rr.repository_id,
                rr.branch_name,
                CASE WHEN trim(rr.base_branch) = '' THEN r.base_branch ELSE rr.base_branch END AS base_branch,
                r.local_path,
                r.remote_name,
                r.remote_url,
                r.name AS repository_name,
                rr.created_by_app
         FROM requirement_repositories rr
         JOIN requirements req ON req.id = rr.requirement_id
         JOIN repositories r ON r.id = rr.repository_id
         WHERE rr.requirement_id = ?1 AND rr.repository_id = ?2
           AND r.is_active = 1",
    )
    .bind(requirement_id)
    .bind(repository_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("el mapeo requerimiento ↔ repositorio".into()))
}

async fn load_targets(
    pool: &SqlitePool,
    requirement_id: &str,
    repository_id: Option<&str>,
) -> Result<Vec<BranchTargetRow>, AppError> {
    let mut query = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT req.external_key,
                rr.repository_id,
                rr.branch_name,
                CASE WHEN trim(rr.base_branch) = '' THEN r.base_branch ELSE rr.base_branch END AS base_branch,
                r.local_path,
                r.remote_name,
                r.remote_url,
                r.name AS repository_name,
                rr.created_by_app
         FROM requirement_repositories rr
         JOIN requirements req ON req.id = rr.requirement_id
         JOIN repositories r ON r.id = rr.repository_id
         WHERE rr.requirement_id = ",
    );
    query.push_bind(requirement_id);
    query.push(" AND r.is_active = 1");
    if let Some(repository_id) = repository_id {
        query
            .push(" AND rr.repository_id = ")
            .push_bind(repository_id);
    }
    query.push(" ORDER BY r.name COLLATE NOCASE");

    Ok(query
        .build_query_as::<BranchTargetRow>()
        .fetch_all(pool)
        .await?)
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
