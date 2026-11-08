use crate::error::AppError;
use chrono::Utc;
use sha2::{Digest, Sha384};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

/// Abre (o crea) la base local, aplica PRAGMAs y corre migraciones.
pub async fn connect(db_path: &Path, backups_dir: &Path) -> Result<SqlitePool, AppError> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    backup_if_needed(db_path, backups_dir)?;

    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await?;

    let migrator = sqlx::migrate!("./migrations");
    repair_eol_checksum_mismatches(&pool, &migrator).await?;
    migrator.run(&pool).await?;
    tracing::info!(path = %db_path.display(), "Base de datos lista");
    Ok(pool)
}

/// SQLx guarda el checksum SHA-384 del archivo de migración. Si la misma
/// migración se compiló con CRLF en Windows y con LF en otro entorno, la base
/// existente falla con `VersionMismatch` aunque el esquema sea idéntico.
///
/// Reparamos únicamente ese caso: si el checksum guardado coincide con la
/// variante LF o CRLF del SQL embebido, es una diferencia de fin de línea y
/// actualizamos el checksum al actual. Cualquier otra diferencia se deja
/// fallar como migración modificada de verdad.
async fn repair_eol_checksum_mismatches(
    pool: &SqlitePool,
    migrator: &sqlx::migrate::Migrator,
) -> Result<(), AppError> {
    let table: Option<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_optional(pool)
    .await?;
    if table.is_none() {
        return Ok(());
    }

    let rows: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations WHERE success = 1")
            .fetch_all(pool)
            .await?;
    let applied: HashMap<i64, Vec<u8>> = rows.into_iter().collect();

    for migration in migrator.iter() {
        let Some(stored) = applied.get(&migration.version) else {
            continue;
        };
        if stored.as_slice() == migration.checksum.as_ref() {
            continue;
        }

        let lf = migration.sql.replace("\r\n", "\n");
        let crlf = lf.replace('\n', "\r\n");
        let lf_checksum = Sha384::digest(lf.as_bytes());
        let crlf_checksum = Sha384::digest(crlf.as_bytes());
        let eol_only = stored.as_slice() == lf_checksum.as_slice()
            || stored.as_slice() == crlf_checksum.as_slice();
        if !eol_only {
            return Err(AppError::Migration(
                sqlx::migrate::MigrateError::VersionMismatch(migration.version),
            ));
        }

        sqlx::query("UPDATE _sqlx_migrations SET checksum = ?1 WHERE version = ?2")
            .bind(migration.checksum.to_vec())
            .bind(migration.version)
            .execute(pool)
            .await?;
        tracing::warn!(
            version = migration.version,
            "Se reparó el checksum de la migración por diferencia de fin de línea"
        );
    }

    Ok(())
}

/// Copia la BD antes de migrar. Conserva las 5 copias más recientes.
fn backup_if_needed(db_path: &Path, backups_dir: &Path) -> Result<(), AppError> {
    let Ok(metadata) = std::fs::metadata(db_path) else {
        return Ok(());
    };
    if metadata.len() == 0 {
        return Ok(());
    }

    std::fs::create_dir_all(backups_dir)?;
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let file_name = db_path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "flowmanager".to_string());
    let target = backups_dir.join(format!("{file_name}-{stamp}.db"));
    std::fs::copy(db_path, &target)?;
    tracing::info!(backup = %target.display(), "Respaldo de base de datos creado");
    prune_backups(backups_dir, 5)?;
    Ok(())
}

fn prune_backups(backups_dir: &Path, keep: usize) -> Result<(), AppError> {
    let mut files: Vec<_> = std::fs::read_dir(backups_dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "db"))
        .collect();

    files.sort_by_key(|entry| entry.metadata().and_then(|meta| meta.modified()).ok());
    let excess = files.len().saturating_sub(keep);
    for entry in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(entry.path());
    }
    Ok(())
}

pub async fn schema_version(pool: &SqlitePool) -> Result<i64, AppError> {
    let version: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations WHERE success = 1",
    )
    .fetch_one(pool)
    .await?;
    Ok(version)
}

/// Conteo de filas para un nombre de tabla interno (lista blanca).
pub async fn count(pool: &SqlitePool, table: Table) -> Result<i64, AppError> {
    let sql = format!("SELECT COUNT(*) FROM {}", table.as_str());
    let total: i64 = sqlx::query_scalar(&sql).fetch_one(pool).await?;
    Ok(total)
}

#[derive(Debug, Clone, Copy)]
pub enum Table {
    Repositories,
    Requirements,
    DbConnections,
}

impl Table {
    fn as_str(self) -> &'static str {
        match self {
            Table::Repositories => "repositories",
            Table::Requirements => "requirements",
            Table::DbConnections => "db_connections",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn creates_schema_and_is_idempotent() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("flowmanager.db");
        let backups = dir.path().join("backups");

        let pool = connect(&db_path, &backups).await.expect("first connect");
        assert_eq!(schema_version(&pool).await.expect("schema"), 11);
        assert_eq!(count(&pool, Table::Repositories).await.expect("count"), 0);
        pool.close().await;

        let pool = connect(&db_path, &backups).await.expect("second connect");
        assert_eq!(schema_version(&pool).await.expect("schema"), 11);
        pool.close().await;
    }

    #[tokio::test]
    async fn repairs_line_ending_checksum_mismatch() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("flowmanager.db");
        let backups = dir.path().join("backups");

        let pool = connect(&db_path, &backups).await.expect("first connect");
        let migrator = sqlx::migrate!("./migrations");
        let migration = migrator
            .iter()
            .find(|migration| migration.version == 1)
            .expect("migration 1");
        let current: &[u8] = migration.checksum.as_ref();
        let lf = migration.sql.replace("\r\n", "\n");
        let crlf = lf.replace('\n', "\r\n");
        let lf_checksum = Sha384::digest(lf.as_bytes());
        let crlf_checksum = Sha384::digest(crlf.as_bytes());
        let alternate = if lf_checksum.as_slice() == current {
            crlf_checksum
        } else {
            lf_checksum
        };
        if alternate.as_slice() == current {
            pool.close().await;
            return;
        }

        sqlx::query("UPDATE _sqlx_migrations SET checksum = ?1 WHERE version = 1")
            .bind(alternate.to_vec())
            .execute(&pool)
            .await
            .expect("alter checksum");
        pool.close().await;

        let pool = connect(&db_path, &backups)
            .await
            .expect("connect repairs the EOL checksum");
        let checksum: Vec<u8> =
            sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = 1")
                .fetch_one(&pool)
                .await
                .expect("checksum");
        assert_eq!(checksum.as_slice(), current);

        pool.close().await;
    }

    #[tokio::test]
    async fn environment_catalog_migration_preserves_data() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory db");

        sqlx::raw_sql(include_str!("../migrations/0001_initial.sql"))
            .execute(&pool)
            .await
            .expect("migration 1");

        sqlx::query(
            "INSERT INTO repositories (id, name, local_path, created_at, updated_at)
             VALUES ('repo-1', 'Demo', 'C:/demo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("repo");

        sqlx::query(
            "INSERT INTO repo_environments
               (id, repository_id, environment, branch_name, resolution_mode,
                aliases_json, pattern, resolved_sha, resolved_at, resolution_note, updated_at)
             VALUES ('env-1', 'repo-1', 'dev', 'develop', 'manual',
                     '[]', NULL, 'abc', '2026-01-01T00:00:00Z', 'manual', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("repo env");

        sqlx::raw_sql(include_str!("../migrations/0002_environment_catalog.sql"))
            .execute(&pool)
            .await
            .expect("migration 2");

        let environments: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM environments")
            .fetch_one(&pool)
            .await
            .expect("count envs");
        assert_eq!(environments, 4);

        sqlx::query(
            "INSERT INTO repo_environments
               (id, repository_id, environment, branch_name, resolution_mode,
                resolved_sha, resolved_at, resolution_note, updated_at)
             VALUES ('env-qas', 'repo-1', 'qas', 'stage', 'auto',
                     'abc', '2026-01-01T00:00:00Z', 'Coincidencia exacta', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("qas stage row");

        sqlx::raw_sql(include_str!("../migrations/0003_stage_environment.sql"))
            .execute(&pool)
            .await
            .expect("migration 3");

        let environments: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM environments")
            .fetch_one(&pool)
            .await
            .expect("count envs");
        assert_eq!(environments, 5);

        let qas_aliases: String =
            sqlx::query_scalar("SELECT aliases_json FROM environments WHERE key = 'qas'")
                .fetch_one(&pool)
                .await
                .expect("qas aliases");
        assert!(!qas_aliases.contains("stage"));

        let stage_branch: Option<String> = sqlx::query_scalar(
            "SELECT branch_name FROM repo_environments
             WHERE repository_id = 'repo-1' AND environment = 'stage'",
        )
        .fetch_one(&pool)
        .await
        .expect("stage row");
        assert!(stage_branch.is_none());

        let qas_branch: Option<String> = sqlx::query_scalar(
            "SELECT branch_name FROM repo_environments
             WHERE repository_id = 'repo-1' AND environment = 'qas'",
        )
        .fetch_one(&pool)
        .await
        .expect("qas row");
        assert!(qas_branch.is_none());

        let branch: String = sqlx::query_scalar(
            "SELECT branch_name FROM repo_environments
             WHERE repository_id = 'repo-1' AND environment = 'dev'",
        )
        .fetch_one(&pool)
        .await
        .expect("preserved branch");
        assert_eq!(branch, "develop");

        sqlx::query(
            "INSERT INTO environments
               (key, label, color, position_no, aliases_json, pattern,
                is_system, is_active, created_at, updated_at)
             VALUES ('preprod', 'PREPROD', '#ff8fab', 4, '[\"preprod\"]', NULL,
                     0, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("custom environment");

        sqlx::query(
            "INSERT INTO repo_environments
               (id, repository_id, environment, branch_name, resolution_mode,
                resolved_sha, resolved_at, resolution_note, updated_at)
             VALUES ('env-2', 'repo-1', 'preprod', NULL, 'auto',
                     NULL, NULL, 'Pendiente de detección', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("custom repo environment");

        pool.close().await;
    }

    #[tokio::test]
    async fn branch_naming_migration_renames_planned_branches() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("flowmanager.db");
        let backups = dir.path().join("backups");
        let pool = connect(&db_path, &backups).await.expect("connect");

        sqlx::query(
            "INSERT INTO repositories (id, name, local_path, created_at, updated_at)
             VALUES ('repo-1', 'Demo', 'C:/demo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("repo");

        for (key, type_) in [("BPIM-133", "User Story"), ("BPIM-900", "Bug")] {
            sqlx::query(
                "INSERT INTO requirements
                   (id, external_key, source, title, type, first_seen_at, last_seen_at,
                    is_active, manual_created, manual_locked, created_at, updated_at)
                 VALUES (?1, ?1, 'monday', 'Demo', ?2, '2026-01-01T00:00:00Z',
                         '2026-01-01T00:00:00Z', 1, 0, 0,
                         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            )
            .bind(key)
            .bind(type_)
            .execute(&pool)
            .await
            .expect("requirement");

            sqlx::query(
                "INSERT INTO requirement_repositories
                   (id, requirement_id, repository_id, branch_name, base_branch,
                    branch_status, mapping_source, created_at, updated_at)
                 VALUES (?1, ?1, 'repo-1', ?1, 'master', 'planned', 'manual',
                         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            )
            .bind(key)
            .execute(&pool)
            .await
            .expect("mapping");
        }

        sqlx::raw_sql(include_str!("../migrations/0005_branch_naming.sql"))
            .execute(&pool)
            .await
            .expect("migration 5");

        let feature: String = sqlx::query_scalar(
            "SELECT branch_name FROM requirement_repositories WHERE requirement_id = 'BPIM-133'",
        )
        .fetch_one(&pool)
        .await
        .expect("feature branch");
        assert_eq!(feature, "feature/BPIM-133");

        let bug: String = sqlx::query_scalar(
            "SELECT branch_name FROM requirement_repositories WHERE requirement_id = 'BPIM-900'",
        )
        .fetch_one(&pool)
        .await
        .expect("fix branch");
        assert_eq!(bug, "fix/BPIM-900");

        pool.close().await;
    }
}
