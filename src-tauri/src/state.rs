use crate::error::AppError;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;

/// Rutas de la aplicación. La BD y los logs viven en AppData; los worktrees
/// en LocalAppData para no sincronizarse con OneDrive.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub logs_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub worktrees_dir: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &tauri::AppHandle) -> Result<Self, AppError> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|err| AppError::Internal(format!("No se pudo resolver AppData: {err}")))?;

        let local_data_dir = app.path().app_local_data_dir().map_err(|err| {
            AppError::Internal(format!("No se pudo resolver LocalAppData: {err}"))
        })?;

        Ok(Self {
            db_path: data_dir.join("flowmanager.db"),
            logs_dir: data_dir.join("logs"),
            backups_dir: data_dir.join("backups"),
            worktrees_dir: local_data_dir.join("worktrees"),
            data_dir,
        })
    }

    pub fn ensure_dirs(&self) -> Result<(), AppError> {
        for dir in [
            &self.data_dir,
            &self.logs_dir,
            &self.backups_dir,
            &self.worktrees_dir,
        ] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(())
    }
}

/// Estado compartido de la aplicación.
pub struct AppState {
    pub paths: AppPaths,
    pub db: Option<SqlitePool>,
    pub db_error: Option<String>,
    pub git: crate::git::GitStatus,
    pub started_at: DateTime<Utc>,
    _log_guard: Option<WorkerGuard>,
}

impl AppState {
    pub fn new(
        paths: AppPaths,
        db: Option<SqlitePool>,
        db_error: Option<String>,
        git: crate::git::GitStatus,
        log_guard: Option<WorkerGuard>,
    ) -> Self {
        Self {
            paths,
            db,
            db_error,
            git,
            started_at: Utc::now(),
            _log_guard: log_guard,
        }
    }

    #[allow(dead_code)]
    pub fn pool(&self) -> Result<&SqlitePool, AppError> {
        self.db.as_ref().ok_or_else(|| {
            AppError::DbNotReady(
                self.db_error
                    .clone()
                    .unwrap_or_else(|| "La base de datos no está disponible.".into()),
            )
        })
    }
}

pub fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
