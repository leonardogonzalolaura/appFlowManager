use serde::Serialize;

/// Error de dominio/aplicación. Se traduce a `ApiError` en el borde Tauri.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("No se pudo preparar la base de datos: {0}")]
    DbNotReady(String),

    #[error("Datos inválidos: {0}")]
    Validation(String),

    #[error("No se encontró {0}")]
    NotFound(String),

    #[error("Error de base de datos: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Error de migración: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    #[error("Error de archivos: {0}")]
    Io(#[from] std::io::Error),

    #[error("Error interno: {0}")]
    Internal(String),

    #[error("La ruta no es un repositorio Git: {0}")]
    NotARepository(String),

    #[error("{0}")]
    RepoExists(String),

    #[error("Git no está disponible: {0}")]
    GitUnavailable(String),

    #[error("Git necesita credenciales: {0}")]
    GitAuth(String),

    #[error("Git superó el tiempo de espera: {0}")]
    GitTimeout(String),

    #[error("Git falló: {0}")]
    GitFailed(String),

    #[error("{0}")]
    EnvBranchNotFound(String),

    #[error("{0}")]
    BranchNotFound(String),

    #[error("{0}")]
    BranchExistsRemote(String),

    #[error("{0}")]
    BranchExistsLocal(String),

    #[error("Hay una operación activa sobre el repositorio: {0}")]
    RepoBusy(String),

    #[error("{0}")]
    EnvironmentExists(String),

    #[error("{0}")]
    EnvironmentNotFound(String),

    #[error("{0}")]
    ProtectedEnvironment(String),

    #[error("{0}")]
    ImportInvalid(String),

    #[error("{0}")]
    StalePreview(String),

    #[error("{0}")]
    DuplicateKey(String),

    #[error("{0}")]
    RequirementArchived(String),

    #[error("{0}")]
    RequirementNotEditable(String),

    #[error("{0}")]
    BaseDrift(String),

    #[error("{0}")]
    RefusingToPushEnvironmentBranch(String),

    #[error("{0}")]
    PushRejected(String),

    #[error("{0}")]
    NoCommits(String),

    #[error("{0}")]
    DbConnectionMissing(String),

    #[error("{0}")]
    Secret(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::DbNotReady(_) => "DB_NOT_READY",
            AppError::Validation(_) => "VALIDATION",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Database(_) => "DB_ERROR",
            AppError::Migration(_) => "DB_MIGRATION",
            AppError::Io(_) => "IO_ERROR",
            AppError::Internal(_) => "INTERNAL",
            AppError::NotARepository(_) => "REPO_NOT_FOUND",
            AppError::RepoExists(_) => "REPO_EXISTS",
            AppError::GitUnavailable(_) => "GIT_MISSING",
            AppError::GitAuth(_) => "GIT_AUTH",
            AppError::GitTimeout(_) => "GIT_TIMEOUT",
            AppError::GitFailed(_) => "GIT_ERROR",
            AppError::EnvBranchNotFound(_) => "ENV_BRANCH_NOT_FOUND",
            AppError::BranchNotFound(_) => "BRANCH_NOT_FOUND",
            AppError::BranchExistsRemote(_) => "BRANCH_EXISTS_REMOTE",
            AppError::BranchExistsLocal(_) => "BRANCH_EXISTS_LOCAL",
            AppError::RepoBusy(_) => "REPO_BUSY",
            AppError::EnvironmentExists(_) => "ENV_EXISTS",
            AppError::EnvironmentNotFound(_) => "ENV_NOT_FOUND",
            AppError::ProtectedEnvironment(_) => "ENV_PROTECTED",
            AppError::ImportInvalid(_) => "IMPORT_INVALID",
            AppError::StalePreview(_) => "STALE_IMPORT",
            AppError::DuplicateKey(_) => "DUPLICATE_KEY",
            AppError::RequirementArchived(_) => "REQUIREMENT_ARCHIVED",
            AppError::RequirementNotEditable(_) => "REQUIREMENT_NOT_EDITABLE",
            AppError::BaseDrift(_) => "BASE_DRIFT",
            AppError::RefusingToPushEnvironmentBranch(_) => "REFUSING_ENV_PUSH",
            AppError::PushRejected(_) => "PUSH_REJECTED",
            AppError::NoCommits(_) => "NO_COMMITS",
            AppError::DbConnectionMissing(_) => "DB_CONNECTION_MISSING",
            AppError::Secret(_) => "SECRET_ERROR",
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(
            self,
            AppError::Database(_)
                | AppError::Io(_)
                | AppError::Internal(_)
                | AppError::GitTimeout(_)
                | AppError::GitFailed(_)
        )
    }

    pub fn details(&self) -> Option<String> {
        match self {
            AppError::Database(err) => Some(err.to_string()),
            AppError::Migration(err) => Some(err.to_string()),
            AppError::Io(err) => Some(err.to_string()),
            AppError::Internal(detail) => Some(detail.clone()),
            AppError::NotARepository(detail) => Some(detail.clone()),
            AppError::RepoExists(detail) => Some(detail.clone()),
            AppError::GitUnavailable(detail) => Some(detail.clone()),
            AppError::GitAuth(detail) => Some(detail.clone()),
            AppError::GitTimeout(detail) => Some(detail.clone()),
            AppError::GitFailed(detail) => Some(detail.clone()),
            AppError::EnvBranchNotFound(detail) => Some(detail.clone()),
            AppError::BranchNotFound(detail) => Some(detail.clone()),
            AppError::BranchExistsRemote(detail) => Some(detail.clone()),
            AppError::BranchExistsLocal(detail) => Some(detail.clone()),
            AppError::RepoBusy(detail) => Some(detail.clone()),
            AppError::EnvironmentExists(detail) => Some(detail.clone()),
            AppError::EnvironmentNotFound(detail) => Some(detail.clone()),
            AppError::ProtectedEnvironment(detail) => Some(detail.clone()),
            AppError::ImportInvalid(detail) => Some(detail.clone()),
            AppError::StalePreview(detail) => Some(detail.clone()),
            AppError::DuplicateKey(detail) => Some(detail.clone()),
            AppError::RequirementArchived(detail) => Some(detail.clone()),
            AppError::RequirementNotEditable(detail) => Some(detail.clone()),
            AppError::BaseDrift(detail) => Some(detail.clone()),
            AppError::RefusingToPushEnvironmentBranch(detail) => Some(detail.clone()),
            AppError::PushRejected(detail) => Some(detail.clone()),
            AppError::DbConnectionMissing(detail) => Some(detail.clone()),
            AppError::Secret(detail) => Some(detail.clone()),
            _ => None,
        }
    }
}

/// Contrato estable hacia el frontend. Nunca se lanza un string suelto.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
    pub retryable: bool,
    pub context: Option<serde_json::Value>,
}

impl From<AppError> for ApiError {
    fn from(err: AppError) -> Self {
        let code = err.code().to_string();
        let message = err.to_string();
        let details = err.details();
        let retryable = err.retryable();
        if retryable {
            tracing::error!(code = %code, message = %message, details = ?details, "Error de aplicación");
        } else {
            tracing::warn!(code = %code, message = %message, "Error controlado");
        }
        Self {
            code,
            message,
            details,
            retryable,
            context: None,
        }
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        AppError::Internal(format!("Tauri: {err}"))
    }
}

impl From<git2::Error> for AppError {
    fn from(err: git2::Error) -> Self {
        AppError::GitFailed(err.message().to_string())
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        AppError::Database(err).into()
    }
}

impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err).into()
    }
}
