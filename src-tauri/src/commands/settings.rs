use crate::error::{ApiError, AppError};
use crate::infra::git_cli;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Rama base sugerida cuando el repositorio no expone una por defecto.
    pub base_branch: String,
    /// Prefijo de las claves de requerimientos manuales (MAN → MAN-0001).
    pub manual_key_prefix: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdateInput {
    pub base_branch: Option<String>,
    pub manual_key_prefix: Option<String>,
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<AppSettings, ApiError> {
    let pool = state.pool()?;
    Ok(read_settings(pool).await?)
}

#[tauri::command]
pub async fn settings_update(
    state: State<'_, AppState>,
    input: SettingsUpdateInput,
) -> Result<AppSettings, ApiError> {
    let pool = state.pool()?;
    let current = read_settings(pool).await?;

    let base_branch = match input.base_branch {
        Some(value) => {
            let value = value.trim().to_string();
            if value.is_empty() {
                return Err(AppError::Validation("La rama base no puede estar vacía.".into()).into());
            }
            git_cli::validate_branch_name(&value)?;
            value
        }
        None => current.base_branch,
    };

    let manual_key_prefix = match input.manual_key_prefix {
        Some(value) => normalize_prefix(&value)?,
        None => current.manual_key_prefix,
    };

    upsert(pool, "base_branch", &base_branch).await?;
    upsert(pool, "manual_key_prefix", &manual_key_prefix).await?;

    Ok(AppSettings {
        base_branch,
        manual_key_prefix,
    })
}

/// Prefijo en mayúsculas: letra inicial y hasta 10 caracteres alfanuméricos.
fn normalize_prefix(value: &str) -> Result<String, AppError> {
    let prefix = value.trim().to_uppercase();
    let valid = (2..=10).contains(&prefix.len())
        && prefix.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && prefix.chars().all(|c| c.is_ascii_alphanumeric());
    if !valid {
        return Err(AppError::Validation(
            "El prefijo debe empezar con una letra y tener entre 2 y 10 caracteres (A-Z, 0-9).".into(),
        ));
    }
    Ok(prefix)
}

async fn upsert(pool: &SqlitePool, key: &str, value: &str) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn read_settings(pool: &SqlitePool) -> Result<AppSettings, AppError> {
    let base_branch = setting(pool, "base_branch", "master").await?;
    let manual_key_prefix = setting(pool, "manual_key_prefix", "MAN").await?;
    Ok(AppSettings {
        base_branch,
        manual_key_prefix,
    })
}

async fn setting(pool: &SqlitePool, key: &str, fallback: &str) -> Result<String, AppError> {
    let value: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(pool)
            .await?;
    Ok(value.unwrap_or_else(|| fallback.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_requires_letter_and_length() {
        assert_eq!(normalize_prefix("man").expect("lowercase"), "MAN");
        assert_eq!(normalize_prefix("bpm2").expect("digits"), "BPM2");
        assert!(normalize_prefix("m").is_err());
        assert!(normalize_prefix("2MAN").is_err());
        assert!(normalize_prefix("MAN-2").is_err());
        assert!(normalize_prefix("PREFIJOLARGO").is_err());
    }
}
