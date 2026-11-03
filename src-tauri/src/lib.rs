mod commands;
mod db;
mod domain;
mod error;
mod git;
mod infra;
mod state;

use state::{AppPaths, AppState};
use std::path::Path;
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::prelude::*;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let paths = AppPaths::resolve(app.handle())?;
            paths.ensure_dirs()?;

            let log_guard = init_logging(&paths.logs_dir);
            tracing::info!(
                version = env!("CARGO_PKG_VERSION"),
                data_dir = %paths.data_dir.display(),
                "Iniciando FlowManager"
            );

            let (pool, db_error) = match tauri::async_runtime::block_on(db::connect(
                &paths.db_path,
                &paths.backups_dir,
            )) {
                Ok(pool) => (Some(pool), None),
                Err(err) => {
                    tracing::error!(error = %err, "No se pudo abrir la base de datos");
                    (None, Some(err.to_string()))
                }
            };

            let git = git::detect();
            if !git.available {
                tracing::warn!(
                    message = ?git.message,
                    "Git no está disponible en el PATH"
                );
            }

            app.manage(AppState::new(paths, pool, db_error, git, log_guard));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::system_get_info,
            commands::system::system_open_dir,
            commands::repositories::repositories_list,
            commands::repositories::repositories_get,
            commands::repositories::repositories_add,
            commands::repositories::repositories_clone,
            commands::repositories::repositories_update,
            commands::repositories::repositories_remove,
            commands::repositories::repositories_fetch,
            commands::repositories::repositories_detect_environments,
            commands::repositories::repositories_set_environment,
            commands::repositories::repositories_list_branches,
            commands::repositories::repositories_open_folder,
            commands::repositories::environments_list,
            commands::repositories::environments_create,
            commands::repositories::environments_update,
            commands::repositories::environments_archive,
            commands::repositories::environments_reorder,
            commands::requirements::requirements_list,
            commands::requirements::requirements_facets,
            commands::requirements::requirements_get,
            commands::requirements::requirements_import_preview,
            commands::requirements::requirements_import_commit,
            commands::requirements::requirements_create_manual,
            commands::requirements::requirements_update_manual,
            commands::requirements::requirements_archive_manual,
            commands::requirements::requirements_assign_repository,
            commands::requirements::requirements_unassign_repository,
            commands::branches::branches_check,
            commands::branches::branches_create,
            commands::branches::branches_analyze,
            commands::squash::squash_candidates,
            commands::squash::squash_prepare,
            commands::squash::squash_list,
            commands::squash::squash_get,
            commands::squash::squash_refresh_conflicts,
            commands::squash::squash_stage_file,
            commands::squash::squash_stage_all,
            commands::squash::squash_resolve_conflict,
            commands::squash::squash_continue,
            commands::squash::squash_abort,
            commands::squash::squash_open_editor,
            commands::squash::squash_open_tarugit,
            commands::squash::squash_open_folder,
            commands::squash::deployment_preview,
            commands::squash::deployment_prepare,
            commands::squash::deployment_load_commits,
            commands::squash::deployment_apply,
            commands::squash::deployment_report,
            commands::squash::deployment_push,
            commands::squash::deployment_cleanup,
            commands::squash::deployment_batches_list,
            commands::squash::deployment_batch_sessions,
            commands::squash::deployment_batch_retry,
            commands::presence::environment_status,
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::database::db_connections_list,
            commands::database::db_connections_upsert,
            commands::database::db_connections_delete,
            commands::database::db_connections_test,
            commands::database::db_scripts_list,
            commands::database::db_scripts_upsert,
            commands::database::db_scripts_delete,
            commands::database::db_scripts_reorder,
            commands::database::db_scripts_validate,
            commands::database::db_scripts_execute,
            commands::database::db_executions_list,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar FlowManager");
}

fn init_logging(logs_dir: &Path) -> Option<WorkerGuard> {
    let file_appender = tracing_appender::rolling::daily(logs_dir, "flowmanager.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,flowmanager_lib=debug"));

    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true);

    let console_layer = tracing_subscriber::fmt::layer()
        .with_ansi(true)
        .with_target(false);

    let initialized = tracing_subscriber::registry()
        .with(filter)
        .with(console_layer)
        .with(file_layer)
        .try_init()
        .is_ok();

    if initialized {
        Some(guard)
    } else {
        None
    }
}
