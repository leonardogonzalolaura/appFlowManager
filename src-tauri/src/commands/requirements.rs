use crate::domain::branch_naming::default_branch_name;
use crate::error::{ApiError, AppError};
use crate::infra::requirements_parser::{parse_file, InvalidRow, ParsedRequirement};
use crate::state::AppState;
use chrono::{SecondsFormat, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::LazyLock;
use tauri::State;
use uuid::Uuid;

static TASK_KEY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Z][A-Z0-9]*-\d+$").expect("regex válida"));

const MAX_IMPORT_BYTES: u64 = 25 * 1024 * 1024;

// ─── DTOs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementListItem {
    pub id: String,
    pub external_key: String,
    pub source: String,
    pub title: String,
    #[serde(rename = "type")]
    pub requirement_type: Option<String>,
    pub feature: Option<String>,
    pub developer: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub repo_count: i64,
    pub manual_created: bool,
    pub manual_locked: bool,
    pub updated_at: String,
    pub last_import_present: bool,
    pub archived_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementPage {
    pub items: Vec<RequirementListItem>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementDetail {
    pub id: String,
    pub external_key: String,
    pub source: String,
    pub title: String,
    #[serde(rename = "type")]
    pub requirement_type: Option<String>,
    pub feature: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub developer: Option<String>,
    pub qa: Option<String>,
    pub informed: Option<String>,
    pub subtasks_summary: Option<String>,
    pub timeline_start: Option<String>,
    pub timeline_end: Option<String>,
    pub monday_doc_url: Option<String>,
    pub source_created_at: Option<String>,
    pub source_updated_at: Option<String>,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub last_import_present: bool,
    pub manual_created: bool,
    pub manual_locked: bool,
    pub is_active: bool,
    pub archived_at: Option<String>,
    pub notes: Option<String>,
    pub note_level: String,
    pub created_at: String,
    pub updated_at: String,
    pub subtasks: Vec<SubtaskDto>,
    pub repositories: Vec<RequirementRepositoryDto>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskDto {
    pub id: String,
    pub name: String,
    pub owner: Option<String>,
    pub status: Option<String>,
    pub estimated_sp: Option<f64>,
    pub actual_sp: Option<f64>,
    pub position_no: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RequirementRepositoryDto {
    pub id: String,
    pub repository_id: String,
    pub name: String,
    pub local_path: String,
    pub branch_name: String,
    pub base_branch: String,
    pub branch_status: String,
    pub mapping_source: String,
    pub notes: Option<String>,
    pub base_sha: Option<String>,
    pub branch_created_at: Option<String>,
    pub last_analyzed_at: Option<String>,
    pub created_by_app: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementFacets {
    pub developers: Vec<String>,
    pub statuses: Vec<String>,
    pub priorities: Vec<String>,
    pub features: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub source: String,
    pub file_name: String,
    pub file_hash: String,
    pub total_rows: usize,
    pub new_count: usize,
    pub updated_count: usize,
    pub unchanged_count: usize,
    pub absent_count: usize,
    pub manual_conflict_count: usize,
    pub invalid_count: usize,
    pub duplicate_count: usize,
    pub new_items: Vec<PreviewItem>,
    pub updated_items: Vec<UpdatedPreview>,
    pub manual_conflicts: Vec<ManualConflict>,
    pub absent_items: Vec<AbsentItem>,
    pub invalid_rows: Vec<InvalidRow>,
    pub duplicate_keys: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewItem {
    pub external_key: String,
    pub title: String,
    pub developer: Option<String>,
    pub status: Option<String>,
    pub feature: Option<String>,
    #[serde(rename = "type")]
    pub requirement_type: Option<String>,
    pub subtask_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedPreview {
    pub external_key: String,
    pub title: String,
    pub changes: Vec<FieldChange>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldChange {
    pub field: String,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualConflict {
    pub external_key: String,
    pub title: String,
    pub developer: Option<String>,
    pub manual_locked: bool,
    pub archived: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbsentItem {
    pub external_key: String,
    pub title: String,
    pub developer: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub import_id: String,
    pub total: usize,
    pub created: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub absent: usize,
    pub skipped_manual: usize,
    pub adopted_manual: usize,
    pub locked_manual: usize,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequirementFilter {
    pub search: Option<String>,
    pub source: Option<String>,
    pub developers: Option<Vec<String>>,
    pub statuses: Option<Vec<String>>,
    pub priority: Option<String>,
    pub feature: Option<String>,
    pub include_archived: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitInput {
    pub file_path: String,
    pub file_hash: String,
    pub adopt_manual_keys: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualRequirementInput {
    pub external_key: Option<String>,
    pub title: String,
    pub feature: Option<String>,
    #[serde(rename = "type")]
    pub requirement_type: Option<String>,
    pub developer: Option<String>,
    pub qa: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub notes: Option<String>,
    pub manual_locked: Option<bool>,
    pub repository_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualRequirementPatch {
    pub title: Option<String>,
    pub feature: Option<String>,
    #[serde(rename = "type")]
    pub requirement_type: Option<String>,
    pub developer: Option<String>,
    pub qa: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub notes: Option<String>,
    pub note_level: Option<String>,
    pub manual_locked: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignRepositoryInput {
    pub requirement_id: String,
    pub repository_id: String,
    pub branch_name: Option<String>,
}

// ─── Filas internas ─────────────────────────────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
struct RequirementListRow {
    id: String,
    external_key: String,
    source: String,
    title: String,
    requirement_type: Option<String>,
    feature: Option<String>,
    developer_raw: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    updated_at: String,
    last_import_present: i64,
    manual_created: i64,
    manual_locked: i64,
    archived_at: Option<String>,
    repo_count: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct RequirementRow {
    id: String,
    external_key: String,
    source: String,
    title: String,
    requirement_type: Option<String>,
    feature: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    developer_raw: Option<String>,
    qa_raw: Option<String>,
    informed_raw: Option<String>,
    subtasks_summary: Option<String>,
    timeline_start: Option<String>,
    timeline_end: Option<String>,
    monday_doc_url: Option<String>,
    source_created_at: Option<String>,
    source_updated_at: Option<String>,
    first_seen_at: String,
    last_seen_at: String,
    last_import_present: i64,
    manual_created: i64,
    manual_locked: i64,
    is_active: i64,
    archived_at: Option<String>,
    notes: Option<String>,
    note_level: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, sqlx::FromRow)]
struct ExistingRequirement {
    id: String,
    external_key: String,
    source: String,
    title: String,
    requirement_type: Option<String>,
    feature: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    developer_raw: Option<String>,
    qa_raw: Option<String>,
    informed_raw: Option<String>,
    subtasks_summary: Option<String>,
    timeline_start: Option<String>,
    timeline_end: Option<String>,
    monday_doc_url: Option<String>,
    source_created_at: Option<String>,
    source_updated_at: Option<String>,
    manual_locked: i64,
    is_active: i64,
}

// ─── Lista y detalle ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn requirements_list(
    state: State<'_, AppState>,
    filter: RequirementFilter,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<RequirementPage, ApiError> {
    let pool = state.pool()?;
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(50).clamp(10, 200);
    let offset = (page - 1) * page_size;

    let mut count_query =
        QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM requirements WHERE 1 = 1");
    push_filters(&mut count_query, &filter);
    let total: i64 = count_query.build_query_scalar().fetch_one(pool).await?;

    let mut query = QueryBuilder::<Sqlite>::new(
        "SELECT id, external_key, source, title, type AS requirement_type, feature,
                developer_raw, status, priority, updated_at, last_import_present,
                manual_created, manual_locked, archived_at,
                (SELECT COUNT(*) FROM requirement_repositories rr
                  WHERE rr.requirement_id = requirements.id) AS repo_count
         FROM requirements WHERE 1 = 1",
    );
    push_filters(&mut query, &filter);
    query.push(" ORDER BY updated_at DESC, external_key LIMIT ");
    query.push_bind(page_size);
    query.push(" OFFSET ");
    query.push_bind(offset);

    let rows = query
        .build_query_as::<RequirementListRow>()
        .fetch_all(pool)
        .await?;

    Ok(RequirementPage {
        items: rows
            .into_iter()
            .map(|row| RequirementListItem {
                id: row.id,
                external_key: row.external_key,
                source: row.source,
                title: row.title,
                requirement_type: row.requirement_type,
                feature: row.feature,
                developer: row.developer_raw,
                status: row.status,
                priority: row.priority,
                repo_count: row.repo_count,
                manual_created: row.manual_created == 1,
                manual_locked: row.manual_locked == 1,
                updated_at: row.updated_at,
                last_import_present: row.last_import_present == 1,
                archived_at: row.archived_at,
            })
            .collect(),
        total,
        page,
        page_size,
    })
}

fn push_filters(query: &mut QueryBuilder<'_, Sqlite>, filter: &RequirementFilter) {
    if !filter.include_archived.unwrap_or(false) {
        query.push(" AND is_active = 1");
    }
    if let Some(search) = filter
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let pattern = format!("%{}%", search.to_lowercase());
        query
            .push(" AND (lower(external_key) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(title) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(feature, '')) LIKE ")
            .push_bind(pattern)
            .push(")");
    }
    if let Some(source) = filter
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| *value == "monday" || *value == "manual")
    {
        query.push(" AND source = ").push_bind(source.to_string());
    }
    if let Some(developers) = filter
        .developers
        .as_ref()
        .filter(|values| !values.is_empty())
    {
        query.push(" AND (");
        for (index, developer) in developers.iter().enumerate() {
            if index > 0 {
                query.push(" OR ");
            }
            query
                .push("lower(developer_normalized) = ")
                .push_bind(developer.trim().to_lowercase());
        }
        query.push(")");
    }
    if let Some(statuses) = filter
        .statuses
        .as_ref()
        .filter(|values| !values.is_empty())
    {
        query.push(" AND lower(status) IN (");
        for (index, status) in statuses.iter().enumerate() {
            if index > 0 {
                query.push(", ");
            }
            query.push_bind(status.trim().to_lowercase());
        }
        query.push(")");
    }
    if let Some(priority) = filter
        .priority
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        query
            .push(" AND lower(priority) = ")
            .push_bind(priority.to_lowercase());
    }
    if let Some(feature) = filter
        .feature
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        query
            .push(" AND lower(feature) = ")
            .push_bind(feature.to_lowercase());
    }
}

#[tauri::command]
pub async fn requirements_facets(
    state: State<'_, AppState>,
) -> Result<RequirementFacets, ApiError> {
    let pool = state.pool()?;
    let developers = distinct_values(pool, "developer_raw").await?;
    let statuses = distinct_values(pool, "status").await?;
    let priorities = distinct_values(pool, "priority").await?;
    let features = distinct_values(pool, "feature").await?;
    Ok(RequirementFacets {
        developers,
        statuses,
        priorities,
        features,
    })
}

async fn distinct_values(pool: &SqlitePool, column: &str) -> Result<Vec<String>, AppError> {
    let sql = format!(
        "SELECT DISTINCT {column} FROM requirements
         WHERE is_active = 1 AND {column} IS NOT NULL AND trim({column}) <> ''
         ORDER BY lower({column}) LIMIT 300"
    );
    let values: Vec<String> = sqlx::query_scalar(&sql).fetch_all(pool).await?;
    Ok(values)
}

#[tauri::command]
pub async fn requirements_get(
    state: State<'_, AppState>,
    requirement_id: String,
) -> Result<RequirementDetail, ApiError> {
    let pool = state.pool()?;
    let row = load_requirement(pool, &requirement_id).await?;
    detail_from_row(pool, row).await
}

async fn load_requirement(
    pool: &SqlitePool,
    requirement_id: &str,
) -> Result<RequirementRow, AppError> {
    sqlx::query_as::<_, RequirementRow>(
        "SELECT id, external_key, source, title, type AS requirement_type, feature,
                status, priority, developer_raw, qa_raw,
                informed_raw, subtasks_summary, timeline_start, timeline_end,
                monday_doc_url, source_created_at, source_updated_at, first_seen_at,
                last_seen_at, last_import_present, manual_created, manual_locked,
                is_active, archived_at, notes, note_level, created_at, updated_at
         FROM requirements WHERE id = ?1",
    )
    .bind(requirement_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("el requerimiento".into()))
}

async fn detail_from_row(
    pool: &SqlitePool,
    row: RequirementRow,
) -> Result<RequirementDetail, ApiError> {
    let subtasks = sqlx::query_as::<_, SubtaskDto>(
        "SELECT id, name, owner, status, estimated_sp, actual_sp, position_no
         FROM requirement_subtasks WHERE requirement_id = ?1
         ORDER BY position_no",
    )
    .bind(&row.id)
    .fetch_all(pool)
    .await?;

    let repositories = sqlx::query_as::<_, RequirementRepositoryDto>(
        "SELECT rr.id, rr.repository_id, r.name, r.local_path, rr.branch_name,
                rr.base_branch, rr.branch_status, rr.mapping_source, rr.notes,
                rr.base_sha, rr.branch_created_at, rr.last_analyzed_at, rr.created_by_app
         FROM requirement_repositories rr
         JOIN repositories r ON r.id = rr.repository_id
         WHERE rr.requirement_id = ?1
         ORDER BY r.name COLLATE NOCASE",
    )
    .bind(&row.id)
    .fetch_all(pool)
    .await?;

    Ok(RequirementDetail {
        id: row.id,
        external_key: row.external_key,
        source: row.source,
        title: row.title,
        requirement_type: row.requirement_type,
        feature: row.feature,
        status: row.status,
        priority: row.priority,
        developer: row.developer_raw,
        qa: row.qa_raw,
        informed: row.informed_raw,
        subtasks_summary: row.subtasks_summary,
        timeline_start: row.timeline_start,
        timeline_end: row.timeline_end,
        monday_doc_url: row.monday_doc_url,
        source_created_at: row.source_created_at,
        source_updated_at: row.source_updated_at,
        first_seen_at: row.first_seen_at,
        last_seen_at: row.last_seen_at,
        last_import_present: row.last_import_present == 1,
        manual_created: row.manual_created == 1,
        manual_locked: row.manual_locked == 1,
        is_active: row.is_active == 1,
        archived_at: row.archived_at,
        notes: row.notes,
        note_level: row.note_level,
        created_at: row.created_at,
        updated_at: row.updated_at,
        subtasks,
        repositories,
    })
}

// ─── Importación ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn requirements_import_preview(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<ImportPreview, ApiError> {
    let pool = state.pool()?;
    let path = validate_import_path(&file_path)?;
    let report = parse_file(&path)?;
    build_preview(pool, report).await
}

pub async fn build_preview(
    pool: &SqlitePool,
    report: crate::infra::requirements_parser::ParseReport,
) -> Result<ImportPreview, ApiError> {
    if report.requirements.is_empty() {
        return Err(AppError::ImportInvalid(
            "El archivo no contiene requerimientos con Task ID válidos.".into(),
        )
        .into());
    }

    let keys: Vec<String> = report
        .requirements
        .iter()
        .map(|requirement| requirement.external_key.clone())
        .collect();
    let existing = load_existing_map(pool, &keys).await?;

    let mut new_items = Vec::new();
    let mut updated_items = Vec::new();
    let mut manual_conflicts = Vec::new();
    let mut new_count = 0;
    let mut updated_count = 0;
    let mut unchanged_count = 0;
    let mut manual_conflict_count = 0;

    for requirement in &report.requirements {
        match existing.get(&requirement.external_key) {
            None => {
                new_count += 1;
                if new_items.len() < 50 {
                    new_items.push(preview_item(requirement));
                }
            }
            Some(found) if found.source == "manual" => {
                manual_conflict_count += 1;
                if manual_conflicts.len() < 50 {
                    manual_conflicts.push(ManualConflict {
                        external_key: found.external_key.clone(),
                        title: found.title.clone(),
                        developer: found.developer_raw.clone(),
                        manual_locked: found.manual_locked == 1,
                        archived: found.is_active == 0,
                    });
                }
            }
            Some(found) => {
                let changes = diff_requirement(found, requirement);
                if changes.is_empty() {
                    unchanged_count += 1;
                } else {
                    updated_count += 1;
                    if updated_items.len() < 50 {
                        updated_items.push(UpdatedPreview {
                            external_key: found.external_key.clone(),
                            title: found.title.clone(),
                            changes,
                        });
                    }
                }
            }
        }
    }

    let key_set: HashSet<String> = keys.into_iter().collect();
    let absent = load_absent(pool, &key_set).await?;

    Ok(ImportPreview {
        source: report.source,
        file_name: report.file_name,
        file_hash: report.file_hash,
        total_rows: report.total_rows,
        new_count,
        updated_count,
        unchanged_count,
        absent_count: absent.0,
        manual_conflict_count,
        invalid_count: report.invalid_rows.len(),
        duplicate_count: report.duplicate_keys.len(),
        new_items,
        updated_items,
        manual_conflicts,
        absent_items: absent.1,
        invalid_rows: report.invalid_rows,
        duplicate_keys: report.duplicate_keys,
    })
}

#[tauri::command]
pub async fn requirements_import_commit(
    state: State<'_, AppState>,
    input: ImportCommitInput,
) -> Result<ImportResult, ApiError> {
    let pool = state.pool()?;
    let path = validate_import_path(&input.file_path)?;
    let report = parse_file(&path)?;
    if report.file_hash != input.file_hash {
        return Err(AppError::StalePreview(
            "El archivo cambió desde la vista previa. Vuelve a previsualizarlo.".into(),
        )
        .into());
    }
    if report.requirements.is_empty() {
        return Err(AppError::ImportInvalid(
            "El archivo no contiene requerimientos válidos.".into(),
        )
        .into());
    }

    let adopt_manual = input.adopt_manual_keys.unwrap_or(false);
    let existing = load_existing_map(
        pool,
        &report
            .requirements
            .iter()
            .map(|requirement| requirement.external_key.clone())
            .collect::<Vec<_>>(),
    )
    .await?;
    let import_id = Uuid::now_v7().to_string();
    let imported_at = now();
    let mut transaction = pool.begin().await?;

    sqlx::query(
        "INSERT INTO requirement_imports
           (id, source, file_name, file_hash, imported_at, total_rows)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&import_id)
    .bind(&report.source)
    .bind(&report.file_name)
    .bind(&report.file_hash)
    .bind(&imported_at)
    .bind(report.requirements.len() as i64)
    .execute(&mut *transaction)
    .await?;

    let mut created = 0;
    let mut updated = 0;
    let mut unchanged = 0;
    let mut skipped_manual = 0;
    let mut adopted_manual = 0;
    let mut locked_manual = 0;

    for parsed in &report.requirements {
        let found = existing.get(&parsed.external_key);
        if let Some(found) = found {
            if found.source == "manual" {
                if found.is_active == 0 {
                    skipped_manual += 1;
                    continue;
                }
                if found.manual_locked == 1 {
                    locked_manual += 1;
                    continue;
                }
                if !adopt_manual {
                    skipped_manual += 1;
                    continue;
                }
                adopted_manual += 1;
            }
        }

        let changes = found
            .map(|found| diff_requirement(found, parsed))
            .unwrap_or_default();
        let requirement_id = found
            .map(|found| found.id.clone())
            .unwrap_or_else(|| Uuid::now_v7().to_string());

        if found.is_none() {
            created += 1;
            insert_requirement_tx(
                &mut transaction,
                &requirement_id,
                &import_id,
                parsed,
                &imported_at,
            )
            .await?;
        } else if changes.is_empty() && found.is_some_and(|found| found.source != "manual") {
            unchanged += 1;
            sqlx::query(
                "UPDATE requirements SET last_seen_at = ?1, last_import_id = ?2,
                    last_import_present = 1 WHERE id = ?3",
            )
            .bind(&imported_at)
            .bind(&import_id)
            .bind(&requirement_id)
            .execute(&mut *transaction)
            .await?;
        } else {
            updated += 1;
            update_requirement_tx(
                &mut transaction,
                &requirement_id,
                &import_id,
                parsed,
                &imported_at,
            )
            .await?;
        }

        replace_subtasks_tx(&mut transaction, &requirement_id, parsed).await?;
    }

    let parsed_keys: HashSet<String> = report
        .requirements
        .iter()
        .map(|requirement| requirement.external_key.clone())
        .collect();
    let absent = mark_absent_tx(&mut transaction, &parsed_keys, &imported_at).await?;

    sqlx::query(
        "UPDATE requirement_imports
         SET created_count = ?1, updated_count = ?2, unchanged_count = ?3, absent_count = ?4
         WHERE id = ?5",
    )
    .bind(created as i64)
    .bind(updated as i64)
    .bind(unchanged as i64)
    .bind(absent as i64)
    .bind(&import_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    Ok(ImportResult {
        import_id,
        total: report.requirements.len(),
        created,
        updated,
        unchanged,
        absent,
        skipped_manual,
        adopted_manual,
        locked_manual,
    })
}

async fn insert_requirement_tx(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    requirement_id: &str,
    import_id: &str,
    parsed: &ParsedRequirement,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO requirements
           (id, external_key, source, title, type, feature, status, priority,
            developer_raw, developer_normalized, qa_raw, informed_raw,
            subtasks_summary, timeline_start, timeline_end, monday_doc_url,
            source_created_at, source_updated_at, first_seen_at, last_seen_at,
            last_import_id, last_import_present, manual_created, manual_locked,
            is_active, raw_json, created_at, updated_at)
         VALUES (?1, ?2, 'monday', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                 ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18, ?19, 1, 0, 0, 1,
                 ?20, ?18, ?18)",
    )
    .bind(requirement_id)
    .bind(&parsed.external_key)
    .bind(&parsed.title)
    .bind(&parsed.requirement_type)
    .bind(&parsed.feature)
    .bind(&parsed.status)
    .bind(&parsed.priority)
    .bind(&parsed.developer_raw)
    .bind(&parsed.developer_normalized)
    .bind(&parsed.qa_raw)
    .bind(&parsed.informed_raw)
    .bind(&parsed.subtasks_summary)
    .bind(&parsed.timeline_start)
    .bind(&parsed.timeline_end)
    .bind(&parsed.monday_doc_url)
    .bind(&parsed.source_created_at)
    .bind(&parsed.source_updated_at)
    .bind(now)
    .bind(import_id)
    .bind(&parsed.raw_json)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn update_requirement_tx(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    requirement_id: &str,
    import_id: &str,
    parsed: &ParsedRequirement,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE requirements SET
           source = 'monday',
           title = ?1, type = ?2, feature = ?3, status = ?4, priority = ?5,
           developer_raw = ?6, developer_normalized = ?7, qa_raw = ?8,
           informed_raw = ?9, subtasks_summary = ?10, timeline_start = ?11,
           timeline_end = ?12, monday_doc_url = ?13, source_created_at = ?14,
           source_updated_at = ?15, last_seen_at = ?16, last_import_id = ?17,
           last_import_present = 1, raw_json = ?18, updated_at = ?16
         WHERE id = ?19",
    )
    .bind(&parsed.title)
    .bind(&parsed.requirement_type)
    .bind(&parsed.feature)
    .bind(&parsed.status)
    .bind(&parsed.priority)
    .bind(&parsed.developer_raw)
    .bind(&parsed.developer_normalized)
    .bind(&parsed.qa_raw)
    .bind(&parsed.informed_raw)
    .bind(&parsed.subtasks_summary)
    .bind(&parsed.timeline_start)
    .bind(&parsed.timeline_end)
    .bind(&parsed.monday_doc_url)
    .bind(&parsed.source_created_at)
    .bind(&parsed.source_updated_at)
    .bind(now)
    .bind(import_id)
    .bind(&parsed.raw_json)
    .bind(requirement_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn replace_subtasks_tx(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    requirement_id: &str,
    parsed: &ParsedRequirement,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM requirement_subtasks WHERE requirement_id = ?1")
        .bind(requirement_id)
        .execute(&mut **transaction)
        .await?;
    for (index, subtask) in parsed.subtasks.iter().enumerate() {
        sqlx::query(
            "INSERT INTO requirement_subtasks
               (id, requirement_id, name, owner, status, estimated_sp, actual_sp, position_no)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(requirement_id)
        .bind(&subtask.name)
        .bind(&subtask.owner)
        .bind(&subtask.status)
        .bind(subtask.estimated_sp)
        .bind(subtask.actual_sp)
        .bind(index as i64)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn mark_absent_tx(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    parsed_keys: &HashSet<String>,
    now: &str,
) -> Result<usize, AppError> {
    let existing: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, external_key FROM requirements
         WHERE source = 'monday' AND is_active = 1 AND last_import_present = 1",
    )
    .fetch_all(&mut **transaction)
    .await?;

    let mut absent = 0;
    for (id, key) in existing {
        if !parsed_keys.contains(&key) {
            sqlx::query(
                "UPDATE requirements SET last_import_present = 0, updated_at = ?1 WHERE id = ?2",
            )
            .bind(now)
            .bind(id)
            .execute(&mut **transaction)
            .await?;
            absent += 1;
        }
    }
    Ok(absent)
}

fn preview_item(parsed: &ParsedRequirement) -> PreviewItem {
    PreviewItem {
        external_key: parsed.external_key.clone(),
        title: parsed.title.clone(),
        developer: parsed.developer_raw.clone(),
        status: parsed.status.clone(),
        feature: parsed.feature.clone(),
        requirement_type: parsed.requirement_type.clone(),
        subtask_count: parsed.subtasks.len(),
    }
}

fn diff_requirement(
    existing: &ExistingRequirement,
    parsed: &ParsedRequirement,
) -> Vec<FieldChange> {
    let mut changes = Vec::new();
    compare(
        &mut changes,
        "Título",
        Some(existing.title.clone()),
        Some(parsed.title.clone()),
    );
    compare(
        &mut changes,
        "Feature",
        existing.feature.clone(),
        parsed.feature.clone(),
    );
    compare(
        &mut changes,
        "Tipo",
        existing.requirement_type.clone(),
        parsed.requirement_type.clone(),
    );
    compare(
        &mut changes,
        "Estado",
        existing.status.clone(),
        parsed.status.clone(),
    );
    compare(
        &mut changes,
        "Prioridad",
        existing.priority.clone(),
        parsed.priority.clone(),
    );
    compare(
        &mut changes,
        "Developer",
        existing.developer_raw.clone(),
        parsed.developer_raw.clone(),
    );
    compare(
        &mut changes,
        "QA",
        existing.qa_raw.clone(),
        parsed.qa_raw.clone(),
    );
    compare(
        &mut changes,
        "Informed",
        existing.informed_raw.clone(),
        parsed.informed_raw.clone(),
    );
    compare(
        &mut changes,
        "Sub Tasks",
        existing.subtasks_summary.clone(),
        parsed.subtasks_summary.clone(),
    );
    compare(
        &mut changes,
        "Timeline inicio",
        existing.timeline_start.clone(),
        parsed.timeline_start.clone(),
    );
    compare(
        &mut changes,
        "Timeline fin",
        existing.timeline_end.clone(),
        parsed.timeline_end.clone(),
    );
    compare(
        &mut changes,
        "Monday Doc",
        existing.monday_doc_url.clone(),
        parsed.monday_doc_url.clone(),
    );
    compare(
        &mut changes,
        "Creado en Monday",
        existing.source_created_at.clone(),
        parsed.source_created_at.clone(),
    );
    compare(
        &mut changes,
        "Actualizado en Monday",
        existing.source_updated_at.clone(),
        parsed.source_updated_at.clone(),
    );
    changes
}

fn compare(changes: &mut Vec<FieldChange>, field: &str, from: Option<String>, to: Option<String>) {
    let normalize = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let from = normalize(&from);
    let to = normalize(&to);
    if from != to {
        changes.push(FieldChange {
            field: field.to_string(),
            from,
            to,
        });
    }
}

async fn load_existing_map(
    pool: &SqlitePool,
    keys: &[String],
) -> Result<HashMap<String, ExistingRequirement>, AppError> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }
    let mut query = QueryBuilder::<Sqlite>::new(
        "SELECT id, external_key, source, title, type AS requirement_type, feature,
                status, priority, developer_raw, qa_raw, informed_raw,
                subtasks_summary, timeline_start, timeline_end, monday_doc_url,
                source_created_at, source_updated_at, manual_locked, is_active
         FROM requirements WHERE external_key IN (",
    );
    let mut separated = query.separated(", ");
    for key in keys {
        separated.push_bind(key);
    }
    query.push(")");
    let rows = query
        .build_query_as::<ExistingRequirement>()
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.external_key.clone(), row))
        .collect())
}

async fn load_absent(
    pool: &SqlitePool,
    keys: &HashSet<String>,
) -> Result<(usize, Vec<AbsentItem>), AppError> {
    let rows = sqlx::query_as::<_, AbsentItemRow>(
        "SELECT external_key, title, developer_raw, status
         FROM requirements
         WHERE source = 'monday' AND is_active = 1 AND last_import_present = 1
         ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await?;
    let absent: Vec<AbsentItem> = rows
        .into_iter()
        .filter(|row| !keys.contains(&row.external_key))
        .map(|row| AbsentItem {
            external_key: row.external_key,
            title: row.title,
            developer: row.developer_raw,
            status: row.status,
        })
        .collect();
    let count = absent.len();
    Ok((count, absent.into_iter().take(50).collect()))
}

#[derive(Debug, sqlx::FromRow)]
struct AbsentItemRow {
    external_key: String,
    title: String,
    developer_raw: Option<String>,
    status: Option<String>,
}

fn validate_import_path(raw: &str) -> Result<std::path::PathBuf, AppError> {
    let path = std::fs::canonicalize(Path::new(raw.trim()))?;
    if !path.is_file() {
        return Err(AppError::ImportInvalid(
            "La ruta del archivo no existe o no es un archivo.".into(),
        ));
    }
    let size = std::fs::metadata(&path)?.len();
    if size > MAX_IMPORT_BYTES {
        return Err(AppError::ImportInvalid(
            "El archivo supera el límite de 25 MB.".into(),
        ));
    }
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !matches!(extension.as_str(), "xlsx" | "xls" | "xlsm" | "csv") {
        return Err(AppError::ImportInvalid(
            "Formato no soportado. Usa .xlsx, .xls o .csv.".into(),
        ));
    }
    Ok(path)
}

// ─── CRUD manual ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn requirements_create_manual(
    state: State<'_, AppState>,
    input: ManualRequirementInput,
) -> Result<RequirementDetail, ApiError> {
    let pool = state.pool()?;
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Validation("El título es obligatorio.".into()).into());
    }

    let external_key = match input
        .external_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            let key = value.to_uppercase();
            if !TASK_KEY_RE.is_match(&key) {
                return Err(AppError::Validation(
                    "El Task ID debe tener un formato como MAN-0001 o BPIM-183.".into(),
                )
                .into());
            }
            if existing_key(pool, &key).await?.is_some() {
                return Err(
                    AppError::DuplicateKey(format!("El Task ID '{key}' ya existe.")).into(),
                );
            }
            key
        }
        None => generate_manual_key(pool).await?,
    };

    let id = Uuid::now_v7().to_string();
    let now = now();
    let developer_normalized = input.developer.as_deref().map(normalize_person);
    let mut transaction = pool.begin().await?;

    sqlx::query(
        "INSERT INTO requirements
           (id, external_key, source, title, type, feature, status, priority,
            developer_raw, developer_normalized, qa_raw, informed_raw,
            subtasks_summary, timeline_start, timeline_end, monday_doc_url,
            source_created_at, source_updated_at, first_seen_at, last_seen_at,
            last_import_id, last_import_present, manual_created, manual_locked,
            is_active, raw_json, notes, created_at, updated_at)
         VALUES (?1, ?2, 'manual', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL,
                 NULL, NULL, NULL, NULL, NULL, NULL, ?11, ?11, NULL, 1, 1, ?12,
                 1, NULL, ?13, ?11, ?11)",
    )
    .bind(&id)
    .bind(&external_key)
    .bind(title)
    .bind(&input.requirement_type)
    .bind(&input.feature)
    .bind(&input.status)
    .bind(&input.priority)
    .bind(&input.developer)
    .bind(&developer_normalized)
    .bind(&input.qa)
    .bind(now)
    .bind(input.manual_locked.unwrap_or(false) as i64)
    .bind(
        input
            .notes
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .execute(&mut *transaction)
    .await?;

    let default_branch = default_branch_name(input.requirement_type.as_deref(), &external_key);
    if let Some(repository_ids) = input.repository_ids {
        for repository_id in repository_ids {
            assign_repository_tx(&mut transaction, &id, &repository_id, &default_branch).await?;
        }
    }

    transaction.commit().await?;
    let row = load_requirement(pool, &id).await?;
    detail_from_row(pool, row).await
}

async fn existing_key(pool: &SqlitePool, key: &str) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT id FROM requirements WHERE external_key = ?1")
            .bind(key)
            .fetch_optional(pool)
            .await?,
    )
}

async fn generate_manual_key(pool: &SqlitePool) -> Result<String, AppError> {
    let prefix: String =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'manual_key_prefix'")
            .fetch_optional(pool)
            .await?
            .unwrap_or_else(|| "MAN".to_string());
    let prefix = prefix
        .trim()
        .to_uppercase()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>();
    let prefix = if prefix.is_empty() {
        "MAN".to_string()
    } else {
        prefix
    };

    let keys: Vec<String> =
        sqlx::query_scalar("SELECT external_key FROM requirements WHERE external_key LIKE ?1")
            .bind(format!("{prefix}-%"))
            .fetch_all(pool)
            .await?;

    let mut max = 0u64;
    for key in keys {
        if let Some(suffix) = key.rsplit('-').next() {
            if let Ok(number) = suffix.parse::<u64>() {
                max = max.max(number);
            }
        }
    }
    Ok(format!("{prefix}-{:04}", max + 1))
}

#[tauri::command]
pub async fn requirements_update_manual(
    state: State<'_, AppState>,
    requirement_id: String,
    patch: ManualRequirementPatch,
) -> Result<RequirementDetail, ApiError> {
    let pool = state.pool()?;
    let current = load_requirement(pool, &requirement_id).await?;
    if current.is_active == 0 {
        return Err(AppError::RequirementArchived(
            "El requerimiento está archivado. Restáuralo antes de editarlo.".into(),
        )
        .into());
    }

    if current.source == "monday" {
        let changes_monday_fields = patch.title.is_some()
            || patch.feature.is_some()
            || patch.requirement_type.is_some()
            || patch.developer.is_some()
            || patch.qa.is_some()
            || patch.status.is_some()
            || patch.priority.is_some();
        if changes_monday_fields {
            return Err(AppError::RequirementNotEditable(
                "Los campos de Monday son de solo lectura. Solo puedes editar notas locales."
                    .into(),
            )
            .into());
        }
        sqlx::query(
            "UPDATE requirements SET
               notes = ?1, note_level = COALESCE(?2, note_level),
               manual_locked = ?3, updated_at = ?4
             WHERE id = ?5",
        )
        .bind(trimmed_optional(patch.notes))
        .bind(normalize_note_level(patch.note_level))
        .bind(
            patch
                .manual_locked
                .map(i64::from)
                .unwrap_or(current.manual_locked),
        )
        .bind(now())
        .bind(&current.id)
        .execute(pool)
        .await?;
    } else {
        let title = patch
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or(current.title);
        let developer: Option<String> = patch.developer.clone().or(current.developer_raw);
        sqlx::query(
            "UPDATE requirements SET
               title = ?1, type = ?2, feature = ?3, status = ?4, priority = ?5,
               developer_raw = ?6, developer_normalized = ?7, qa_raw = ?8,
               notes = ?9, note_level = COALESCE(?10, note_level),
               manual_locked = ?11, updated_at = ?12
             WHERE id = ?13",
        )
        .bind(&title)
        .bind(trimmed_optional(patch.requirement_type).or(current.requirement_type))
        .bind(trimmed_optional(patch.feature).or(current.feature))
        .bind(trimmed_optional(patch.status).or(current.status))
        .bind(trimmed_optional(patch.priority).or(current.priority))
        .bind(&developer)
        .bind(developer.as_deref().map(normalize_person))
        .bind(trimmed_optional(patch.qa).or(current.qa_raw))
        .bind(trimmed_optional(patch.notes))
        .bind(normalize_note_level(patch.note_level))
        .bind(
            patch
                .manual_locked
                .map(i64::from)
                .unwrap_or(current.manual_locked),
        )
        .bind(now())
        .bind(&current.id)
        .execute(pool)
        .await?;
    }

    let row = load_requirement(pool, &requirement_id).await?;
    detail_from_row(pool, row).await
}

#[tauri::command]
pub async fn requirements_archive_manual(
    state: State<'_, AppState>,
    requirement_id: String,
) -> Result<(), ApiError> {
    let pool = state.pool()?;
    let current = load_requirement(pool, &requirement_id).await?;
    if current.source != "manual" {
        return Err(AppError::RequirementNotEditable(
            "Solo los requerimientos manuales se pueden archivar desde aquí.".into(),
        )
        .into());
    }
    let now = now();
    sqlx::query(
        "UPDATE requirements SET is_active = 0, archived_at = ?1, updated_at = ?1 WHERE id = ?2",
    )
    .bind(&now)
    .bind(&current.id)
    .execute(pool)
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn requirements_assign_repository(
    state: State<'_, AppState>,
    input: AssignRepositoryInput,
) -> Result<RequirementRepositoryDto, ApiError> {
    let pool = state.pool()?;
    let requirement = load_requirement(pool, &input.requirement_id).await?;
    if requirement.is_active == 0 {
        return Err(
            AppError::RequirementArchived("El requerimiento está archivado.".into()).into(),
        );
    }
    let mut transaction = pool.begin().await?;
    let branch_name = input
        .branch_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            default_branch_name(
                requirement.requirement_type.as_deref(),
                &requirement.external_key,
            )
        });
    assign_repository_tx(
        &mut transaction,
        &requirement.id,
        &input.repository_id,
        &branch_name,
    )
    .await?;
    transaction.commit().await?;

    load_repository_mapping(pool, &requirement.id, &input.repository_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn requirements_unassign_repository(
    state: State<'_, AppState>,
    requirement_id: String,
    repository_id: String,
) -> Result<(), ApiError> {
    let pool = state.pool()?;
    sqlx::query(
        "DELETE FROM requirement_repositories
         WHERE requirement_id = ?1 AND repository_id = ?2",
    )
    .bind(requirement_id)
    .bind(repository_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn assign_repository_tx(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    requirement_id: &str,
    repository_id: &str,
    branch_name: &str,
) -> Result<(), AppError> {
    let base_branch: String =
        sqlx::query_scalar("SELECT base_branch FROM repositories WHERE id = ?1 AND is_active = 1")
            .bind(repository_id)
            .fetch_optional(&mut **transaction)
            .await?
            .ok_or_else(|| AppError::NotFound("el repositorio".into()))?;

    let now = now();
    sqlx::query(
        "INSERT INTO requirement_repositories
           (id, requirement_id, repository_id, branch_name, base_branch,
            branch_status, mapping_source, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'planned', 'manual', NULL, ?6, ?6)
         ON CONFLICT(requirement_id, repository_id) DO UPDATE SET
           branch_name = excluded.branch_name,
           base_branch = excluded.base_branch,
           updated_at = excluded.updated_at",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(requirement_id)
    .bind(repository_id)
    .bind(branch_name)
    .bind(base_branch)
    .bind(now)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn load_repository_mapping(
    pool: &SqlitePool,
    requirement_id: &str,
    repository_id: &str,
) -> Result<RequirementRepositoryDto, AppError> {
    sqlx::query_as::<_, RequirementRepositoryDto>(
        "SELECT rr.id, rr.repository_id, r.name, r.local_path, rr.branch_name,
                rr.base_branch, rr.branch_status, rr.mapping_source, rr.notes,
                rr.base_sha, rr.branch_created_at, rr.last_analyzed_at, rr.created_by_app
         FROM requirement_repositories rr
         JOIN repositories r ON r.id = rr.repository_id
         WHERE rr.requirement_id = ?1 AND rr.repository_id = ?2",
    )
    .bind(requirement_id)
    .bind(repository_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("el mapeo de repositorio".into()))
}

// ─── Utilidades ─────────────────────────────────────────────────────────────

fn trimmed_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_note_level(value: Option<String>) -> Option<String> {
    trimmed_optional(value)
        .map(|value| value.to_lowercase())
        .filter(|value| matches!(value.as_str(), "info" | "warning" | "danger"))
}

fn normalize_person(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .replace('\u{00a0}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
