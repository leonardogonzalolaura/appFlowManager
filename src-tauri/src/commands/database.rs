use crate::error::{ApiError, AppError};
use crate::infra::secrets;
use crate::state::AppState;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;
use uuid::Uuid;

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

// ── Conexiones ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionSummary {
    pub id: String,
    pub repository_id: Option<String>,
    pub repository_name: Option<String>,
    pub environment: String,
    pub environment_label: String,
    pub engine: String,
    pub host: String,
    pub port: i64,
    pub database_name: String,
    pub username: String,
    pub ssl_mode: Option<String>,
    pub is_active: bool,
    pub has_password: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionInput {
    pub id: Option<String>,
    pub repository_id: Option<String>,
    pub environment: String,
    pub engine: String,
    pub host: String,
    pub port: i64,
    pub database_name: String,
    pub username: String,
    pub password: Option<String>,
    pub ssl_mode: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, sqlx::FromRow)]
struct ConnectionSummaryRow {
    id: String,
    repository_id: Option<String>,
    repository_name: Option<String>,
    environment: String,
    environment_label: String,
    engine: String,
    host: String,
    port: i64,
    database_name: String,
    username: String,
    ssl_mode: Option<String>,
    is_active: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, sqlx::FromRow)]
struct ConnectionSecretRow {
    id: String,
    environment: String,
    engine: String,
    host: String,
    port: i64,
    database_name: String,
    username: String,
    ssl_mode: Option<String>,
    is_active: i64,
    ciphertext: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionTestResult {
    pub ok: bool,
    pub latency_ms: i64,
    pub message: String,
}

#[tauri::command]
pub async fn db_connections_list(
    state: State<'_, AppState>,
) -> Result<Vec<DbConnectionSummary>, ApiError> {
    let pool = state.pool()?;
    let rows = sqlx::query_as::<_, ConnectionSummaryRow>(
        "SELECT c.id, c.repository_id, r.name AS repository_name, c.environment,
                e.label AS environment_label, c.engine, c.host, c.port,
                c.database_name, c.username, c.ssl_mode, c.is_active,
                c.created_at, c.updated_at
         FROM db_connections c
         JOIN environments e ON e.key = c.environment
         LEFT JOIN repositories r ON r.id = c.repository_id
         ORDER BY e.position_no, c.engine, r.name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(summary_from_row).collect())
}

#[tauri::command]
pub async fn db_connections_upsert(
    state: State<'_, AppState>,
    input: DbConnectionInput,
) -> Result<DbConnectionSummary, ApiError> {
    let pool = state.pool()?;
    upsert_connection(pool, input).await
}

async fn upsert_connection(
    pool: &SqlitePool,
    input: DbConnectionInput,
) -> Result<DbConnectionSummary, ApiError> {
    let environment = input.environment.trim().to_lowercase();
    let engine = input.engine.trim().to_lowercase();
    if engine != "sqlserver" && engine != "postgres" {
        return Err(AppError::Validation(
            "El motor debe ser sqlserver o postgres.".into(),
        )
        .into());
    }
    let host = input.host.trim().to_string();
    let database_name = input.database_name.trim().to_string();
    let username = input.username.trim().to_string();
    if host.is_empty() || database_name.is_empty() || username.is_empty() {
        return Err(AppError::Validation(
            "Host, base de datos y usuario son obligatorios.".into(),
        )
        .into());
    }
    if input.port <= 0 || input.port > 65535 {
        return Err(AppError::Validation("El puerto no es válido.".into()).into());
    }
    let environment_exists: Option<String> =
        sqlx::query_scalar("SELECT key FROM environments WHERE key = ?1 AND is_active = 1")
            .bind(&environment)
            .fetch_optional(pool)
            .await?;
    if environment_exists.is_none() {
        return Err(AppError::EnvironmentNotFound(environment).into());
    }
    let repository_id = input
        .repository_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(repository_id) = repository_id.as_deref() {
        let exists: Option<String> =
            sqlx::query_scalar("SELECT id FROM repositories WHERE id = ?1 AND is_active = 1")
                .bind(repository_id)
                .fetch_optional(pool)
                .await?;
        if exists.is_none() {
            return Err(AppError::NotFound("el repositorio".into()).into());
        }
    }

    let password = input
        .password
        .filter(|value| !value.is_empty());
    let is_active = input.is_active.unwrap_or(true);
    let timestamp = now();
    let mut transaction = pool.begin().await?;

    let id = if let Some(id) = input.id.clone() {
        let existing: Option<String> =
            sqlx::query_scalar("SELECT secret_id FROM db_connections WHERE id = ?1")
                .bind(&id)
                .fetch_optional(&mut *transaction)
                .await?;
        let Some(secret_id) = existing else {
            return Err(AppError::NotFound("la conexión de base de datos".into()).into());
        };
        if let Some(password) = password.as_deref() {
            let ciphertext = secrets::protect(password)?;
            sqlx::query(
                "UPDATE secrets SET ciphertext = ?1, updated_at = ?2 WHERE id = ?3",
            )
            .bind(&ciphertext)
            .bind(&timestamp)
            .bind(&secret_id)
            .execute(&mut *transaction)
            .await?;
        }
        sqlx::query(
            "UPDATE db_connections
             SET repository_id = ?1, environment = ?2, engine = ?3, host = ?4,
                 port = ?5, database_name = ?6, username = ?7, ssl_mode = ?8,
                 is_active = ?9, updated_at = ?10
             WHERE id = ?11",
        )
        .bind(&repository_id)
        .bind(&environment)
        .bind(&engine)
        .bind(&host)
        .bind(input.port)
        .bind(&database_name)
        .bind(&username)
        .bind(clean_optional(input.ssl_mode.clone()))
        .bind(if is_active { 1 } else { 0 })
        .bind(&timestamp)
        .bind(&id)
        .execute(&mut *transaction)
        .await
        .map_err(map_unique_connection)?;
        id
    } else {
        let Some(password) = password.as_deref() else {
            return Err(AppError::Validation(
                "La contraseña es obligatoria para crear la conexión.".into(),
            )
            .into());
        };
        let id = Uuid::now_v7().to_string();
        let secret_id = Uuid::now_v7().to_string();
        let ciphertext = secrets::protect(password)?;
        sqlx::query(
            "INSERT INTO secrets (id, scope, key, ciphertext, created_at, updated_at)
             VALUES (?1, 'db_connection', ?2, ?3, ?4, ?4)",
        )
        .bind(&secret_id)
        .bind(&id)
        .bind(&ciphertext)
        .bind(&timestamp)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO db_connections
               (id, repository_id, environment, engine, host, port, database_name,
                username, secret_id, ssl_mode, options_json, is_active,
                created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12, ?12)",
        )
        .bind(&id)
        .bind(&repository_id)
        .bind(&environment)
        .bind(&engine)
        .bind(&host)
        .bind(input.port)
        .bind(&database_name)
        .bind(&username)
        .bind(&secret_id)
        .bind(clean_optional(input.ssl_mode.clone()))
        .bind(if is_active { 1 } else { 0 })
        .bind(&timestamp)
        .execute(&mut *transaction)
        .await
        .map_err(map_unique_connection)?;
        id
    };

    transaction.commit().await?;
    load_connection_summary(pool, &id).await
}

#[tauri::command]
pub async fn db_connections_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), ApiError> {
    let pool = state.pool()?;
    let mut transaction = pool.begin().await?;
    let secret_id: Option<String> =
        sqlx::query_scalar("SELECT secret_id FROM db_connections WHERE id = ?1")
            .bind(&id)
            .fetch_optional(&mut *transaction)
            .await?;
    let Some(secret_id) = secret_id else {
        return Err(AppError::NotFound("la conexión de base de datos".into()).into());
    };
    sqlx::query("DELETE FROM db_connections WHERE id = ?1")
        .bind(&id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM secrets WHERE id = ?1")
        .bind(&secret_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn db_connections_test(
    state: State<'_, AppState>,
    id: String,
) -> Result<DbConnectionTestResult, ApiError> {
    let pool = state.pool()?;
    let connection = load_connection_secret(pool, &id).await?;
    let password = secrets::unprotect(&connection.ciphertext)?;
    let started = Instant::now();
    let result = tokio::time::timeout(
        Duration::from_secs(12),
        execute_sql(&connection, &password, "SELECT 1"),
    )
    .await;
    match result {
        Ok(Ok(_)) => Ok(DbConnectionTestResult {
            ok: true,
            latency_ms: started.elapsed().as_millis() as i64,
            message: "Conexión y consulta de prueba correctas.".into(),
        }),
        Ok(Err(message)) => Ok(DbConnectionTestResult {
            ok: false,
            latency_ms: started.elapsed().as_millis() as i64,
            message,
        }),
        Err(_) => Ok(DbConnectionTestResult {
            ok: false,
            latency_ms: started.elapsed().as_millis() as i64,
            message: "La conexión superó el tiempo de espera (12 s).".into(),
        }),
    }
}

// ── Scripts ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbScriptSummary {
    pub id: String,
    pub requirement_id: String,
    pub requirement_key: String,
    pub repository_id: String,
    pub repository_name: String,
    pub name: String,
    pub engine: String,
    pub sequence_no: i64,
    pub environment_scope: String,
    pub source_type: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub checksum: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbScriptInput {
    pub id: Option<String>,
    pub requirement_id: String,
    pub repository_id: String,
    pub name: String,
    pub engine: String,
    pub sequence_no: Option<i64>,
    pub environment_scope: Option<String>,
    pub source_type: Option<String>,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, sqlx::FromRow)]
struct ScriptRow {
    id: String,
    requirement_id: String,
    requirement_key: String,
    repository_id: String,
    repository_name: String,
    name: String,
    engine: String,
    sequence_no: i64,
    environment_scope: String,
    source_type: String,
    content: Option<String>,
    file_path: Option<String>,
    checksum: String,
    is_active: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbScriptValidation {
    pub valid: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbScriptsListInput {
    pub requirement_id: Option<String>,
    pub repository_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbScriptsReorderInput {
    pub requirement_id: String,
    pub repository_id: String,
    pub ordered_ids: Vec<String>,
}

#[tauri::command]
pub async fn db_scripts_list(
    state: State<'_, AppState>,
    input: DbScriptsListInput,
) -> Result<Vec<DbScriptSummary>, ApiError> {
    let pool = state.pool()?;
    let rows = sqlx::query_as::<_, ScriptRow>(
        "SELECT s.id, s.requirement_id, req.external_key AS requirement_key,
                s.repository_id, r.name AS repository_name, s.name, s.engine,
                s.sequence_no, s.environment_scope, s.source_type, s.content,
                s.file_path, s.checksum, s.is_active, s.created_at, s.updated_at
         FROM db_scripts s
         JOIN requirements req ON req.id = s.requirement_id
         JOIN repositories r ON r.id = s.repository_id
         WHERE (?1 IS NULL OR s.requirement_id = ?1)
           AND (?2 IS NULL OR s.repository_id = ?2)
         ORDER BY req.external_key, r.name COLLATE NOCASE, s.sequence_no",
    )
    .bind(clean_optional(input.requirement_id))
    .bind(clean_optional(input.repository_id))
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(script_from_row).collect())
}

#[tauri::command]
pub async fn db_scripts_upsert(
    state: State<'_, AppState>,
    input: DbScriptInput,
) -> Result<DbScriptSummary, ApiError> {
    let pool = state.pool()?;
    upsert_script(pool, input).await
}

async fn upsert_script(
    pool: &SqlitePool,
    input: DbScriptInput,
) -> Result<DbScriptSummary, ApiError> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("El nombre del script es obligatorio.".into()).into());
    }
    let engine = input.engine.trim().to_lowercase();
    if engine != "sqlserver" && engine != "postgres" {
        return Err(AppError::Validation(
            "El motor debe ser sqlserver o postgres.".into(),
        )
        .into());
    }
    let requirement_exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM requirements WHERE id = ?1")
            .bind(&input.requirement_id)
            .fetch_optional(pool)
            .await?;
    if requirement_exists.is_none() {
        return Err(AppError::NotFound("el requerimiento".into()).into());
    }
    let repository_exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM repositories WHERE id = ?1 AND is_active = 1")
            .bind(&input.repository_id)
            .fetch_optional(pool)
            .await?;
    if repository_exists.is_none() {
        return Err(AppError::NotFound("el repositorio".into()).into());
    }
    let environment_scope = input
        .environment_scope
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "all".into());
    if environment_scope != "all" {
        let exists: Option<String> =
            sqlx::query_scalar("SELECT key FROM environments WHERE key = ?1")
                .bind(&environment_scope)
                .fetch_optional(pool)
                .await?;
        if exists.is_none() {
            return Err(AppError::EnvironmentNotFound(environment_scope).into());
        }
    }
    let source_type = input
        .source_type
        .map(|value| value.trim().to_lowercase())
        .filter(|value| value == "inline" || value == "file")
        .unwrap_or_else(|| "inline".into());
    let file_path = clean_optional(input.file_path.clone());
    let content = if source_type == "file" {
        let Some(path) = file_path.as_deref() else {
            return Err(AppError::Validation(
                "Selecciona un archivo para el script.".into(),
            )
            .into());
        };
        Some(std::fs::read_to_string(path)?)
    } else {
        let content = input.content.clone().unwrap_or_default();
        if content.trim().is_empty() {
            return Err(AppError::Validation(
                "El contenido del script está vacío.".into(),
            )
            .into());
        }
        Some(content)
    };
    let checksum = sha256_hex(content.as_deref().unwrap_or_default());
    let timestamp = now();
    let id = if let Some(id) = input.id.clone() {
        let exists: Option<String> = sqlx::query_scalar("SELECT id FROM db_scripts WHERE id = ?1")
            .bind(&id)
            .fetch_optional(pool)
            .await?;
        if exists.is_none() {
            return Err(AppError::NotFound("el script".into()).into());
        }
        sqlx::query(
            "UPDATE db_scripts
             SET requirement_id = ?1, repository_id = ?2, name = ?3, engine = ?4,
                 environment_scope = ?5, source_type = ?6, content = ?7,
                 file_path = ?8, checksum = ?9, is_active = ?10, updated_at = ?11
             WHERE id = ?12",
        )
        .bind(&input.requirement_id)
        .bind(&input.repository_id)
        .bind(&name)
        .bind(&engine)
        .bind(&environment_scope)
        .bind(&source_type)
        .bind(&content)
        .bind(&file_path)
        .bind(&checksum)
        .bind(if input.is_active.unwrap_or(true) { 1 } else { 0 })
        .bind(&timestamp)
        .bind(&id)
        .execute(pool)
        .await
        .map_err(map_unique_script)?;
        id
    } else {
        let sequence = match input.sequence_no {
            Some(value) if value > 0 => value,
            _ => {
                sqlx::query_scalar::<_, i64>(
                    "SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM db_scripts
                     WHERE requirement_id = ?1 AND repository_id = ?2",
                )
                .bind(&input.requirement_id)
                .bind(&input.repository_id)
                .fetch_one(pool)
                .await?
            }
        };
        let id = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT INTO db_scripts
               (id, requirement_id, repository_id, name, engine, sequence_no,
                environment_scope, source_type, content, file_path, checksum,
                is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
        )
        .bind(&id)
        .bind(&input.requirement_id)
        .bind(&input.repository_id)
        .bind(&name)
        .bind(&engine)
        .bind(sequence)
        .bind(&environment_scope)
        .bind(&source_type)
        .bind(&content)
        .bind(&file_path)
        .bind(&checksum)
        .bind(if input.is_active.unwrap_or(true) { 1 } else { 0 })
        .bind(&timestamp)
        .execute(pool)
        .await
        .map_err(map_unique_script)?;
        id
    };
    load_script(pool, &id).await
}

#[tauri::command]
pub async fn db_scripts_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), ApiError> {
    let pool = state.pool()?;
    let result = sqlx::query("DELETE FROM db_scripts WHERE id = ?1")
        .bind(&id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("el script".into()).into());
    }
    Ok(())
}

#[tauri::command]
pub async fn db_scripts_reorder(
    state: State<'_, AppState>,
    input: DbScriptsReorderInput,
) -> Result<(), ApiError> {
    let pool = state.pool()?;
    let mut transaction = pool.begin().await?;
    for (index, id) in input.ordered_ids.iter().enumerate() {
        sqlx::query(
            "UPDATE db_scripts SET sequence_no = ?1
             WHERE id = ?2 AND requirement_id = ?3 AND repository_id = ?4",
        )
        .bind(-((index as i64) + 1))
        .bind(id)
        .bind(&input.requirement_id)
        .bind(&input.repository_id)
        .execute(&mut *transaction)
        .await?;
    }
    for (index, id) in input.ordered_ids.iter().enumerate() {
        sqlx::query(
            "UPDATE db_scripts SET sequence_no = ?1
             WHERE id = ?2 AND requirement_id = ?3 AND repository_id = ?4",
        )
        .bind((index as i64) + 1)
        .bind(id)
        .bind(&input.requirement_id)
        .bind(&input.repository_id)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn db_scripts_validate(
    content: String,
    engine: String,
) -> Result<DbScriptValidation, ApiError> {
    let mut warnings = Vec::new();
    if content.trim().is_empty() {
        return Ok(DbScriptValidation {
            valid: false,
            warnings: vec!["El contenido está vacío.".into()],
        });
    }
    let lower = content.to_ascii_lowercase();
    if lower.contains("drop table") || lower.contains("drop database") {
        warnings.push("El script contiene DROP. Verifica el ambiente antes de ejecutar.".into());
    }
    if lower.contains("truncate") {
        warnings.push("El script contiene TRUNCATE.".into());
    }
    if lower.contains("delete from") && !lower.contains(" where ") {
        warnings.push("Hay un DELETE sin WHERE visible.".into());
    }
    if engine.eq_ignore_ascii_case("sqlserver") && content.lines().any(|line| line.trim().eq_ignore_ascii_case("go")) {
        warnings.push("SQL Server separará las instrucciones por lotes GO.".into());
    }
    Ok(DbScriptValidation {
        valid: true,
        warnings,
    })
}

// ── Ejecución ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbScriptExecuteInput {
    pub script_ids: Vec<String>,
    pub environment: String,
    pub connection_id: Option<String>,
    pub stop_on_error: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DbScriptExecutionResult {
    pub script_id: String,
    pub script_name: String,
    pub engine: String,
    pub environment: String,
    pub status: String,
    pub output: Option<String>,
    pub error: Option<String>,
    pub duration_ms: i64,
    pub executed_at: String,
}

#[derive(Debug, sqlx::FromRow)]
struct ExecutionRow {
    id: String,
    script_id: Option<String>,
    requirement_id: Option<String>,
    repository_id: Option<String>,
    script_name: String,
    engine: String,
    environment: String,
    status: String,
    output: Option<String>,
    error: Option<String>,
    duration_ms: i64,
    executed_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbExecutionSummary {
    pub id: String,
    pub script_id: Option<String>,
    pub requirement_id: Option<String>,
    pub repository_id: Option<String>,
    pub script_name: String,
    pub engine: String,
    pub environment: String,
    pub status: String,
    pub output: Option<String>,
    pub error: Option<String>,
    pub duration_ms: i64,
    pub executed_at: String,
}

#[tauri::command]
pub async fn db_scripts_execute(
    state: State<'_, AppState>,
    app: AppHandle,
    input: DbScriptExecuteInput,
) -> Result<Vec<DbScriptExecutionResult>, ApiError> {
    let pool = state.pool()?;
    let environment = input.environment.trim().to_lowercase();
    let exists: Option<String> =
        sqlx::query_scalar("SELECT key FROM environments WHERE key = ?1 AND is_active = 1")
            .bind(&environment)
            .fetch_optional(pool)
            .await?;
    if exists.is_none() {
        return Err(AppError::EnvironmentNotFound(environment).into());
    }
    if input.script_ids.is_empty() {
        return Err(AppError::Validation("Selecciona al menos un script.".into()).into());
    }

    let mut results = Vec::new();
    for script_id in &input.script_ids {
        let script = load_script(pool, script_id).await?;
        let started = Instant::now();
        let executed_at = now();

        if !script.is_active {
            let error = "El script está inactivo.".to_string();
            persist_execution(
                pool,
                &script,
                &environment,
                None,
                "skipped",
                None,
                Some(&error),
                0,
                &executed_at,
            )
            .await?;
            emit_result(
                &app,
                &mut results,
                DbScriptExecutionResult {
                    script_id: script.id,
                    script_name: script.name,
                    engine: script.engine,
                    environment: environment.clone(),
                    status: "skipped".into(),
                    output: None,
                    error: Some(error),
                    duration_ms: 0,
                    executed_at,
                },
            );
            continue;
        }
        if script.environment_scope != "all" && script.environment_scope != environment {
            let error = format!("El script aplica solo a '{}'.", script.environment_scope);
            persist_execution(
                pool,
                &script,
                &environment,
                None,
                "skipped",
                None,
                Some(&error),
                0,
                &executed_at,
            )
            .await?;
            emit_result(
                &app,
                &mut results,
                DbScriptExecutionResult {
                    script_id: script.id,
                    script_name: script.name,
                    engine: script.engine,
                    environment: environment.clone(),
                    status: "skipped".into(),
                    output: None,
                    error: Some(error),
                    duration_ms: 0,
                    executed_at,
                },
            );
            continue;
        }

        let content = match script.source_type.as_str() {
            "file" => {
                let Some(path) = script.file_path.as_deref() else {
                    results.push(record_failed_script(
                        &script, &environment, "El script no tiene archivo.", &executed_at,
                    ));
                    continue;
                };
                match std::fs::read_to_string(path) {
                    Ok(content) => content,
                    Err(error) => {
                        let message = format!("No se pudo leer el archivo: {error}");
                        persist_execution(
                            pool,
                            &script,
                            &environment,
                            None,
                            "failed",
                            None,
                            Some(&message),
                            0,
                            &executed_at,
                        )
                        .await?;
                        emit_result(
                            &app,
                            &mut results,
                            record_failed_script(
                                &script,
                                &environment,
                                &message,
                                &executed_at,
                            ),
                        );
                        continue;
                    }
                }
            }
            _ => script.content.clone().unwrap_or_default(),
        };

        let connection = match resolve_connection(
            pool,
            &script.repository_id,
            &environment,
            &script.engine,
            input.connection_id.as_deref(),
        )
        .await
        {
            Ok(connection) => connection,
            Err(error) => {
                let message = error.to_string();
                persist_execution(
                    pool,
                    &script,
                    &environment,
                    None,
                    "failed",
                    None,
                    Some(&message),
                    0,
                    &executed_at,
                )
                .await?;
                emit_result(
                    &app,
                    &mut results,
                    record_failed_script(
                        &script,
                        &environment,
                        &message,
                        &executed_at,
                    ),
                );
                if input.stop_on_error.unwrap_or(true) {
                    break;
                }
                continue;
            }
        };

        let result = tokio::time::timeout(
            Duration::from_secs(120),
            execute_with_connection(&connection, &content),
        )
        .await;
        let duration_ms = started.elapsed().as_millis() as i64;
        let (status, output, error) = match result {
            Ok(Ok(value)) => ("success", Some(value), None),
            Ok(Err(message)) => ("failed", None, Some(message)),
            Err(_) => (
                "failed",
                None,
                Some("La ejecución superó el tiempo de espera (120 s).".into()),
            ),
        };
        let error_message = error.clone();
        persist_execution(
            pool,
            &script,
            &environment,
            Some(&connection.id),
            status,
            output.as_deref(),
            error_message.as_deref(),
            duration_ms,
            &executed_at,
        )
        .await?;

        emit_result(
            &app,
            &mut results,
            DbScriptExecutionResult {
                script_id: script.id,
                script_name: script.name,
                engine: script.engine,
                environment: environment.clone(),
                status: status.into(),
                output,
                error,
                duration_ms,
                executed_at,
            },
        );
        if status == "failed" && input.stop_on_error.unwrap_or(true) {
            break;
        }
    }
    Ok(results)
}

#[tauri::command]
pub async fn db_executions_list(
    state: State<'_, AppState>,
    requirement_id: Option<String>,
    script_id: Option<String>,
) -> Result<Vec<DbExecutionSummary>, ApiError> {
    let pool = state.pool()?;
    let rows = sqlx::query_as::<_, ExecutionRow>(
        "SELECT id, script_id, requirement_id, repository_id, script_name,
                engine, environment, status, output, error, duration_ms, executed_at
         FROM db_script_executions
         WHERE (?1 IS NULL OR requirement_id = ?1)
           AND (?2 IS NULL OR script_id = ?2)
         ORDER BY executed_at DESC LIMIT 100",
    )
    .bind(clean_optional(requirement_id))
    .bind(clean_optional(script_id))
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| DbExecutionSummary {
            id: row.id,
            script_id: row.script_id,
            requirement_id: row.requirement_id,
            repository_id: row.repository_id,
            script_name: row.script_name,
            engine: row.engine,
            environment: row.environment,
            status: row.status,
            output: row.output,
            error: row.error,
            duration_ms: row.duration_ms,
            executed_at: row.executed_at,
        })
        .collect())
}

async fn persist_execution(
    pool: &SqlitePool,
    script: &DbScriptSummary,
    environment: &str,
    connection_id: Option<&str>,
    status: &str,
    output: Option<&str>,
    error: Option<&str>,
    duration_ms: i64,
    executed_at: &str,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO db_script_executions
           (id, script_id, connection_id, requirement_id, repository_id,
            script_name, engine, environment, status, output, error,
            duration_ms, executed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(&script.id)
    .bind(connection_id)
    .bind(&script.requirement_id)
    .bind(&script.repository_id)
    .bind(&script.name)
    .bind(&script.engine)
    .bind(environment)
    .bind(status)
    .bind(output)
    .bind(error)
    .bind(duration_ms)
    .bind(executed_at)
    .execute(pool)
    .await?;
    Ok(())
}

fn emit_result(
    app: &AppHandle,
    results: &mut Vec<DbScriptExecutionResult>,
    result: DbScriptExecutionResult,
) {
    let _ = app.emit("db-script-executed", &result);
    results.push(result);
}

fn record_failed_script(
    script: &DbScriptSummary,
    environment: &str,
    message: &str,
    executed_at: &str,
) -> DbScriptExecutionResult {    DbScriptExecutionResult {
        script_id: script.id.clone(),
        script_name: script.name.clone(),
        engine: script.engine.clone(),
        environment: environment.to_string(),
        status: "failed".into(),
        output: None,
        error: Some(message.to_string()),
        duration_ms: 0,
        executed_at: executed_at.to_string(),
    }
}

async fn execute_with_connection(
    connection: &ConnectionSecretRow,
    sql: &str,
) -> Result<String, String> {
    let password = secrets::unprotect(&connection.ciphertext).map_err(|error| error.to_string())?;
    execute_sql(connection, &password, sql).await
}

async fn resolve_connection(
    pool: &SqlitePool,
    repository_id: &str,
    environment: &str,
    engine: &str,
    explicit_id: Option<&str>,
) -> Result<ConnectionSecretRow, AppError> {
    if let Some(id) = explicit_id.filter(|value| !value.is_empty()) {
        let connection = load_connection_secret(pool, id).await?;
        if connection.environment != environment {
            return Err(AppError::Validation(format!(
                "La conexión seleccionada pertenece al ambiente '{}', no a '{}'.",
                connection.environment, environment
            )));
        }
        if connection.engine != engine {
            return Err(AppError::Validation(format!(
                "La conexión seleccionada es para '{}', pero el script es '{}'.",
                connection.engine, engine
            )));
        }
        if connection.is_active == 0 {
            return Err(AppError::Validation(
                "La conexión seleccionada está inactiva.".into(),
            ));
        }
        return Ok(connection);
    }
    let id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM db_connections
         WHERE environment = ?1 AND engine = ?2 AND is_active = 1
           AND (repository_id = ?3 OR repository_id IS NULL)
         ORDER BY CASE WHEN repository_id = ?3 THEN 0 ELSE 1 END
         LIMIT 1",
    )
    .bind(environment)
    .bind(engine)
    .bind(repository_id)
    .fetch_optional(pool)
    .await?;
    let Some(id) = id else {
        return Err(AppError::DbConnectionMissing(format!(
            "No hay conexión {engine} configurada para el ambiente '{environment}' en este repositorio."
        )));
    };
    load_connection_secret(pool, &id).await
}

async fn execute_sql(
    connection: &ConnectionSecretRow,
    password: &str,
    sql: &str,
) -> Result<String, String> {
    match connection.engine.as_str() {
        "postgres" => execute_postgres(connection, password, sql).await,
        "sqlserver" => execute_sqlserver(connection, password, sql).await,
        other => Err(format!("Motor no soportado: {other}")),
    }
}

async fn execute_postgres(
    connection: &ConnectionSecretRow,
    password: &str,
    sql: &str,
) -> Result<String, String> {
    use tokio_postgres::NoTls;

    let mut config = tokio_postgres::Config::new();
    config
        .host(&connection.host)
        .port(connection.port as u16)
        .user(&connection.username)
        .password(password)
        .dbname(&connection.database_name);

    let ssl_mode = connection.ssl_mode.as_deref().unwrap_or("require");
    let client = if ssl_mode == "disable" {
        let (client, connection) = config
            .connect(NoTls)
            .await
            .map_err(|error| format_pg_error(&error))?;
        tokio::spawn(async move {
            let _ = connection.await;
        });
        client
    } else {
        let mut builder = native_tls::TlsConnector::builder();
        if ssl_mode == "trust" {
            builder.danger_accept_invalid_certs(true);
            builder.danger_accept_invalid_hostnames(true);
        }
        let connector = builder
            .build()
            .map_err(|error| format!("No se pudo preparar TLS: {error}"))?;
        let (client, connection) = config
            .connect(postgres_native_tls::MakeTlsConnector::new(connector))
            .await
            .map_err(|error| format_pg_error(&error))?;
        tokio::spawn(async move {
            let _ = connection.await;
        });
        client
    };

    client
        .batch_execute(sql)
        .await
        .map_err(|error| format_pg_error(&error))?;
    Ok("OK".into())
}

fn format_pg_error(error: &tokio_postgres::Error) -> String {
    use std::error::Error as _;

    if let Some(db_error) = error.as_db_error() {
        let mut text = format!(
            "PostgreSQL [{}]: {}",
            db_error.code().code(),
            db_error.message()
        );
        if let Some(detail) = db_error.detail() {
            text.push_str(&format!(" · Detalle: {detail}"));
        }
        if let Some(hint) = db_error.hint() {
            text.push_str(&format!(" · Sugerencia: {hint}"));
        }
        if let Some(position) = db_error.position() {
            text.push_str(&format!(" · Posición: {position:?}"));
        }
        return text;
    }

    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let message = cause.to_string();
        if !message.is_empty() && !text.contains(&message) {
            text.push_str(": ");
            text.push_str(&message);
        }
        source = cause.source();
    }
    if text.is_empty() || text == "db error" {
        text = format!("PostgreSQL: {error:?}");
    }
    text
}

async fn execute_sqlserver(
    connection: &ConnectionSecretRow,
    password: &str,
    sql: &str,
) -> Result<String, String> {
    use tiberius::{AuthMethod, EncryptionLevel};

    let mut config = tiberius::Config::new();
    config.host(&connection.host);
    config.port(connection.port as u16);
    config.database(&connection.database_name);
    config.authentication(AuthMethod::sql_server(&connection.username, password));
    match connection.ssl_mode.as_deref().unwrap_or("require") {
        "disable" => {
            config.encryption(EncryptionLevel::NotSupported);
        }
        "trust" => {
            config.encryption(EncryptionLevel::Required);
            config.trust_cert();
        }
        _ => {
            config.encryption(EncryptionLevel::Required);
        }
    }

    let tcp = TcpStream::connect((connection.host.as_str(), connection.port as u16))
        .await
        .map_err(|error| format!("No se pudo conectar a SQL Server: {error}"))?;
    let mut client = tiberius::Client::connect(config, tcp.compat_write())
        .await
        .map_err(|error| format!("No se pudo conectar a SQL Server: {error}"))?;

    let batches = split_sqlserver_batches(sql);
    let batch_count = batches.len();
    let mut rows_total = 0usize;
    for batch in batches {
        let rows = client
            .simple_query(batch)
            .await
            .map_err(|error| format!("SQL Server: {error}"))?
            .into_results()
            .await
            .map_err(|error| format!("SQL Server: {error}"))?;
        rows_total += rows.iter().map(Vec::len).sum::<usize>();
    }
    Ok(format!("OK ({batch_count} lote(s), {rows_total} fila(s))"))
}

fn split_sqlserver_batches(sql: &str) -> Vec<String> {
    let mut batches = Vec::new();
    let mut current = String::new();
    for line in sql.lines() {
        if line.trim().eq_ignore_ascii_case("go") {
            if !current.trim().is_empty() {
                batches.push(std::mem::take(&mut current));
            }
        } else {
            current.push_str(line);
            current.push('\n');
        }
    }
    if !current.trim().is_empty() {
        batches.push(current);
    }
    batches
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async fn load_connection_summary(
    pool: &SqlitePool,
    id: &str,
) -> Result<DbConnectionSummary, ApiError> {
    let row = sqlx::query_as::<_, ConnectionSummaryRow>(
        "SELECT c.id, c.repository_id, r.name AS repository_name, c.environment,
                e.label AS environment_label, c.engine, c.host, c.port,
                c.database_name, c.username, c.ssl_mode, c.is_active,
                c.created_at, c.updated_at
         FROM db_connections c
         JOIN environments e ON e.key = c.environment
         LEFT JOIN repositories r ON r.id = c.repository_id
         WHERE c.id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("la conexión de base de datos".into()))?;
    Ok(summary_from_row(row))
}

async fn load_connection_secret(
    pool: &SqlitePool,
    id: &str,
) -> Result<ConnectionSecretRow, AppError> {
    sqlx::query_as::<_, ConnectionSecretRow>(
        "SELECT c.id, c.environment, c.engine, c.host, c.port,
                c.database_name, c.username, c.ssl_mode, c.is_active, s.ciphertext
         FROM db_connections c
         JOIN secrets s ON s.id = c.secret_id
         WHERE c.id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("la conexión de base de datos activa".into()))
}

async fn load_script(pool: &SqlitePool, id: &str) -> Result<DbScriptSummary, ApiError> {
    let row = sqlx::query_as::<_, ScriptRow>(
        "SELECT s.id, s.requirement_id, req.external_key AS requirement_key,
                s.repository_id, r.name AS repository_name, s.name, s.engine,
                s.sequence_no, s.environment_scope, s.source_type, s.content,
                s.file_path, s.checksum, s.is_active, s.created_at, s.updated_at
         FROM db_scripts s
         JOIN requirements req ON req.id = s.requirement_id
         JOIN repositories r ON r.id = s.repository_id
         WHERE s.id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("el script".into()))?;
    Ok(script_from_row(row))
}

fn summary_from_row(row: ConnectionSummaryRow) -> DbConnectionSummary {
    DbConnectionSummary {
        id: row.id,
        repository_id: row.repository_id,
        repository_name: row.repository_name,
        environment: row.environment,
        environment_label: row.environment_label,
        engine: row.engine,
        host: row.host,
        port: row.port,
        database_name: row.database_name,
        username: row.username,
        ssl_mode: row.ssl_mode,
        is_active: row.is_active != 0,
        has_password: true,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn script_from_row(row: ScriptRow) -> DbScriptSummary {
    DbScriptSummary {
        id: row.id,
        requirement_id: row.requirement_id,
        requirement_key: row.requirement_key,
        repository_id: row.repository_id,
        repository_name: row.repository_name,
        name: row.name,
        engine: row.engine,
        sequence_no: row.sequence_no,
        environment_scope: row.environment_scope,
        source_type: row.source_type,
        content: row.content,
        file_path: row.file_path,
        checksum: row.checksum,
        is_active: row.is_active != 0,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn map_unique_connection(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        if database.message().contains("UNIQUE") {
            return AppError::Validation(
                "Ya existe una conexión para ese repositorio, ambiente y motor.".into(),
            );
        }
    }
    AppError::Database(error)
}

fn map_unique_script(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        if database.message().contains("UNIQUE") {
            return AppError::Validation(
                "Ya existe un script con ese orden para el requerimiento y repositorio.".into(),
            );
        }
    }
    AppError::Database(error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_sqlserver_batches_by_go() {
        let batches = split_sqlserver_batches(
            "CREATE TABLE A (id int);\nGO\nINSERT INTO A VALUES (1);\ngo\n",
        );
        assert_eq!(batches.len(), 2);
        assert!(batches[0].contains("CREATE TABLE"));
        assert!(batches[1].contains("INSERT INTO"));
    }

    #[test]
    fn keeps_single_batch_without_go() {
        let batches = split_sqlserver_batches("SELECT 1;");
        assert_eq!(batches, vec!["SELECT 1;\n"]);
    }

    #[test]
    fn checksum_is_stable() {
        assert_eq!(sha256_hex("select 1"), sha256_hex("select 1"));
        assert_ne!(sha256_hex("select 1"), sha256_hex("select 2"));
    }

    #[tokio::test]
    async fn connection_and_script_crud_persist_encrypted_secret() {
        let dir = tempfile::tempdir().expect("temp dir");
        let pool = crate::db::connect(
            &dir.path().join("flowmanager.db"),
            &dir.path().join("backups"),
        )
        .await
        .expect("database");

        let created = upsert_connection(
            &pool,
            DbConnectionInput {
                id: None,
                repository_id: None,
                environment: "dev".into(),
                engine: "postgres".into(),
                host: "localhost".into(),
                port: 5432,
                database_name: "demo".into(),
                username: "flow".into(),
                password: Some("super-secret".into()),
                ssl_mode: Some("disable".into()),
                is_active: Some(true),
            },
        )
        .await
        .expect("create connection");
        assert_eq!(created.environment_label, "DEV");
        assert!(created.has_password);

        let ciphertext: Vec<u8> = sqlx::query_scalar(
            "SELECT ciphertext FROM secrets WHERE scope = 'db_connection' AND key = ?1",
        )
        .bind(&created.id)
        .fetch_one(&pool)
        .await
        .expect("secret");
        assert_ne!(ciphertext, b"super-secret");
        assert_eq!(
            crate::infra::secrets::unprotect(&ciphertext).expect("unprotect"),
            "super-secret"
        );

        let updated = upsert_connection(
            &pool,
            DbConnectionInput {
                id: Some(created.id.clone()),
                repository_id: None,
                environment: "dev".into(),
                engine: "postgres".into(),
                host: "db.local".into(),
                port: 5432,
                database_name: "demo".into(),
                username: "flow".into(),
                password: None,
                ssl_mode: Some("disable".into()),
                is_active: Some(true),
            },
        )
        .await
        .expect("update connection");
        assert_eq!(updated.host, "db.local");
        let ciphertext_after: Vec<u8> = sqlx::query_scalar(
            "SELECT ciphertext FROM secrets WHERE scope = 'db_connection' AND key = ?1",
        )
        .bind(&created.id)
        .fetch_one(&pool)
        .await
        .expect("secret after update");
        assert_eq!(ciphertext, ciphertext_after);

        let timestamp = now();
        sqlx::query(
            "INSERT INTO repositories
               (id, name, local_path, remote_name, remote_url, provider,
                base_branch, is_active, created_at, updated_at)
             VALUES ('repo-db', 'DB Repo', 'C:/tmp/db-repo', 'origin', NULL,
                     'generic', 'main', 1, ?1, ?1)",
        )
        .bind(&timestamp)
        .execute(&pool)
        .await
        .expect("repo");
        sqlx::query(
            "INSERT INTO requirements
               (id, external_key, title, source, first_seen_at, last_seen_at,
                created_at, updated_at)
             VALUES ('req-db', 'DB-1', 'Script requirement', 'manual', ?1, ?1, ?1, ?1)",
        )
        .bind(&timestamp)
        .execute(&pool)
        .await
        .expect("requirement");

        let script = upsert_script(
            &pool,
            DbScriptInput {
                id: None,
                requirement_id: "req-db".into(),
                repository_id: "repo-db".into(),
                name: "crear tabla".into(),
                engine: "postgres".into(),
                sequence_no: None,
                environment_scope: Some("all".into()),
                source_type: Some("inline".into()),
                content: Some("CREATE TABLE demo (id int);".into()),
                file_path: None,
                is_active: Some(true),
            },
        )
        .await
        .expect("create script");
        assert_eq!(script.sequence_no, 1);
        assert_eq!(script.checksum.len(), 64);
        assert_eq!(script.engine, "postgres");

        pool.close().await;
    }
}
