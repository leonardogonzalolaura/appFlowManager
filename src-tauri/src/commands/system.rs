use crate::db::{self, Table};
use crate::error::{ApiError, AppError};
use crate::state::{display_path, AppState};
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub data_dir: String,
    pub db_path: String,
    pub db_ready: bool,
    pub db_error: Option<String>,
    pub db_size_bytes: u64,
    pub schema_version: Option<i64>,
    pub logs_dir: String,
    pub backups_dir: String,
    pub worktrees_dir: String,
    pub git: crate::git::GitStatus,
    pub counts: Counts,
    pub setup: SetupStatus,
    pub started_at: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub repositories: i64,
    pub requirements: i64,
    pub database_connections: i64,
    pub active_runs: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub git_ok: bool,
    pub database_ok: bool,
    pub repositories_ok: bool,
    pub requirements_ok: bool,
    pub database_configured: bool,
    pub completed_steps: u8,
    pub total_steps: u8,
}

const TOTAL_STEPS: u8 = 4;

#[tauri::command]
pub async fn system_get_info(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SystemInfo, ApiError> {
    let mut db_error = state.db_error.clone();
    let mut db_ready = state.db.is_some();
    let mut schema_version = None;
    let mut counts = Counts::default();

    if let Some(pool) = state.db.as_ref() {
        match db::schema_version(pool).await {
            Ok(version) => schema_version = Some(version),
            Err(err) => {
                db_ready = false;
                db_error = Some(err.to_string());
            }
        }

        if db_ready {
            match load_counts(pool).await {
                Ok(loaded) => counts = loaded,
                Err(err) => {
                    db_ready = false;
                    db_error = Some(err.to_string());
                }
            }
        }
    }

    let db_size_bytes = std::fs::metadata(&state.paths.db_path)
        .map(|meta| meta.len())
        .unwrap_or(0);

    let database_configured = counts.database_connections > 0;
    let repositories_ok = counts.repositories > 0;
    let requirements_ok = counts.requirements > 0;
    let git_ok = state.git.available;
    let database_ok = db_ready;

    let completed_steps = [git_ok, database_ok, repositories_ok, requirements_ok]
        .into_iter()
        .filter(|done| *done)
        .count() as u8;

    Ok(SystemInfo {
        app_version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        data_dir: display_path(&state.paths.data_dir),
        db_path: display_path(&state.paths.db_path),
        db_ready,
        db_error,
        db_size_bytes,
        schema_version,
        logs_dir: display_path(&state.paths.logs_dir),
        backups_dir: display_path(&state.paths.backups_dir),
        worktrees_dir: display_path(&state.paths.worktrees_dir),
        git: state.git.clone(),
        counts,
        setup: SetupStatus {
            git_ok,
            database_ok,
            repositories_ok,
            requirements_ok,
            database_configured,
            completed_steps,
            total_steps: TOTAL_STEPS,
        },
        started_at: state.started_at.to_rfc3339(),
    })
}

async fn load_counts(pool: &sqlx::SqlitePool) -> Result<Counts, AppError> {
    let repositories = db::count(pool, Table::Repositories).await?;
    let requirements = db::count(pool, Table::Requirements).await?;
    let database_connections = db::count(pool, Table::DbConnections).await?;
    let active_runs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM deployment_runs
         WHERE state NOT IN ('done','failed','cancelled','blocked')",
    )
    .fetch_one(pool)
    .await?;

    Ok(Counts {
        repositories,
        requirements,
        database_connections,
        active_runs,
    })
}

/// Abre una carpeta conocida de la app. Nunca acepta rutas arbitrarias.
#[tauri::command]
pub fn system_open_dir(state: State<'_, AppState>, kind: String) -> Result<String, ApiError> {
    let path = match kind.as_str() {
        "data" => state.paths.data_dir.clone(),
        "logs" => state.paths.logs_dir.clone(),
        "backups" => state.paths.backups_dir.clone(),
        "worktrees" => state.paths.worktrees_dir.clone(),
        _ => {
            return Err(AppError::Validation(format!("Tipo de carpeta desconocido: {kind}")).into())
        }
    };

    open_in_file_manager(&path)?;
    Ok(display_path(&path))
}

pub(crate) fn open_in_file_manager(path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        return Err(AppError::NotFound(display_path(path)));
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(path);
        cmd
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = std::process::Command::new("open");
        cmd.arg(path);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(path);
        cmd
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    command
        .spawn()
        .map_err(|err| AppError::Internal(format!("No se pudo abrir la carpeta: {err}")))?;
    Ok(())
}
