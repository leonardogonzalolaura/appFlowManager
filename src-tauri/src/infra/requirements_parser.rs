use crate::error::AppError;
use calamine::{open_workbook_auto, Data, Reader};
use regex::Regex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;

static TASK_KEY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Z][A-Z0-9]*-\d+$").expect("regex válida"));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSubtask {
    pub name: String,
    pub owner: Option<String>,
    pub status: Option<String>,
    pub estimated_sp: Option<f64>,
    pub actual_sp: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct ParsedRequirement {
    pub external_key: String,
    pub title: String,
    pub feature: Option<String>,
    pub requirement_type: Option<String>,
    pub informed_raw: Option<String>,
    pub developer_raw: Option<String>,
    pub developer_normalized: Option<String>,
    pub qa_raw: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub timeline_start: Option<String>,
    pub timeline_end: Option<String>,
    pub monday_doc_url: Option<String>,
    pub source_created_at: Option<String>,
    pub source_updated_at: Option<String>,
    pub subtasks_summary: Option<String>,
    pub subtasks: Vec<ParsedSubtask>,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvalidRow {
    pub row_number: usize,
    pub reason: String,
    pub preview: String,
}

#[derive(Debug)]
pub struct ParseReport {
    pub source: String,
    pub file_name: String,
    pub file_hash: String,
    pub total_rows: usize,
    pub requirements: Vec<ParsedRequirement>,
    pub invalid_rows: Vec<InvalidRow>,
    pub duplicate_keys: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct Columns {
    title: usize,
    subtasks_summary: Option<usize>,
    feature: Option<usize>,
    requirement_type: Option<usize>,
    informed: Option<usize>,
    developer: Option<usize>,
    qa: Option<usize>,
    status: Option<usize>,
    priority: Option<usize>,
    timeline_start: Option<usize>,
    timeline_end: Option<usize>,
    monday_doc: Option<usize>,
    task_id: usize,
    created_at: Option<usize>,
    updated_at: Option<usize>,
}

#[derive(Debug, Clone)]
struct SubitemColumns {
    name: usize,
    owner: Option<usize>,
    status: Option<usize>,
    estimated: Option<usize>,
    actual: Option<usize>,
}

impl Default for SubitemColumns {
    fn default() -> Self {
        Self {
            name: 1,
            owner: Some(2),
            status: Some(3),
            estimated: Some(4),
            actual: Some(5),
        }
    }
}

pub fn parse_file(path: &Path) -> Result<ParseReport, AppError> {
    let bytes = std::fs::read(path)?;
    let file_hash = format!("{:x}", Sha256::digest(&bytes));
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "export".to_string());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let (rows, source) = match extension.as_str() {
        "xlsx" | "xls" | "xlsm" => (read_xlsx(path)?, "monday_xlsx".to_string()),
        "csv" => (read_csv(&bytes)?, "monday_csv".to_string()),
        _ => {
            return Err(AppError::ImportInvalid(
                "Formato no soportado. Usa un archivo .xlsx, .xls o .csv.".into(),
            ))
        }
    };

    let mut report = parse_rows(rows);
    report.source = source;
    report.file_name = file_name;
    report.file_hash = file_hash;
    Ok(report)
}

fn read_xlsx(path: &Path) -> Result<Vec<Vec<String>>, AppError> {
    let mut workbook = open_workbook_auto(path).map_err(|error| {
        AppError::ImportInvalid(format!("No se pudo abrir el archivo Excel: {error}"))
    })?;

    let sheet_names = workbook.sheet_names().to_vec();
    let mut sheets: Vec<Vec<Vec<String>>> = Vec::new();

    for name in &sheet_names {
        let range = workbook.worksheet_range(name).map_err(|error| {
            AppError::ImportInvalid(format!("No se pudo leer la hoja '{name}': {error}"))
        })?;
        let rows: Vec<Vec<String>> = range
            .rows()
            .map(|row| row.iter().map(cell_string).collect())
            .collect();
        if rows.iter().any(|row| header_columns(row).is_some()) {
            sheets.push(rows);
        }
    }

    sheets.into_iter().next().ok_or_else(|| {
        AppError::ImportInvalid(
            "No se encontró una hoja con los encabezados 'Name' y 'Task ID'.".into(),
        )
    })
}

fn read_csv(bytes: &[u8]) -> Result<Vec<Vec<String>>, AppError> {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(bytes);

    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record
            .map_err(|error| AppError::ImportInvalid(format!("No se pudo leer el CSV: {error}")))?;
        rows.push(
            record
                .iter()
                .map(|value| value.trim().to_string())
                .collect(),
        );
    }

    if rows.is_empty() {
        return Err(AppError::ImportInvalid("El CSV está vacío.".into()));
    }
    Ok(rows)
}

fn parse_rows(rows: Vec<Vec<String>>) -> ParseReport {
    let mut columns: Option<Columns> = None;
    let mut requirements: Vec<ParsedRequirement> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut duplicate_keys = Vec::new();
    let mut invalid_rows = Vec::new();
    let mut last_requirement: Option<usize> = None;
    let mut in_subitems = false;
    let mut subitem_columns = SubitemColumns::default();
    let total_rows = rows.len();

    for (row_index, row) in rows.iter().enumerate() {
        let row_number = row_index + 1;

        if let Some(found) = header_columns(row) {
            columns = Some(found);
            in_subitems = false;
            continue;
        }

        let first = normalized(&value_at(row, 0));

        if first == "subitems" {
            in_subitems = true;
            subitem_columns = subitem_columns_from(row);
            continue;
        }

        if in_subitems {
            let new_requirement = columns
                .as_ref()
                .is_some_and(|cols| !value_at(row, cols.task_id).trim().is_empty());
            if !new_requirement {
                if let (Some(last), Some(name)) =
                    (last_requirement, optional_value(row, subitem_columns.name))
                {
                    requirements[last].subtasks.push(ParsedSubtask {
                        name,
                        owner: subitem_columns
                            .owner
                            .and_then(|column| optional_value(row, column)),
                        status: subitem_columns
                            .status
                            .and_then(|column| optional_value(row, column)),
                        estimated_sp: subitem_columns
                            .estimated
                            .and_then(|column| optional_value(row, column))
                            .and_then(|value| parse_number(&value)),
                        actual_sp: subitem_columns
                            .actual
                            .and_then(|column| optional_value(row, column))
                            .and_then(|value| parse_number(&value)),
                    });
                }
                continue;
            }
            in_subitems = false;
        }

        let Some(cols) = columns.as_ref() else {
            continue;
        };

        let key = value_at(row, cols.task_id).trim().to_uppercase();
        let title = value_at(row, cols.title).trim().to_string();

        if key.is_empty() {
            let non_empty = row.iter().filter(|value| !value.trim().is_empty()).count();
            let section = first == "all tasks" || first.starts_with("tasks |");
            if !title.is_empty() && non_empty >= 2 && !section {
                invalid_rows.push(InvalidRow {
                    row_number,
                    reason: "Fila sin Task ID.".into(),
                    preview: truncate(&title, 90),
                });
            }
            continue;
        }

        if !TASK_KEY_RE.is_match(&key) {
            invalid_rows.push(InvalidRow {
                row_number,
                reason: "Task ID con formato inválido.".into(),
                preview: format!("{key} · {}", truncate(&title, 70)),
            });
            continue;
        }

        if title.is_empty() {
            invalid_rows.push(InvalidRow {
                row_number,
                reason: "El requerimiento no tiene título.".into(),
                preview: key,
            });
            continue;
        }

        let developer_raw = optional_value_at(row, cols.developer);
        let parsed = ParsedRequirement {
            external_key: key.clone(),
            title,
            feature: optional_value_at(row, cols.feature),
            requirement_type: optional_value_at(row, cols.requirement_type),
            informed_raw: optional_value_at(row, cols.informed),
            developer_normalized: developer_raw.as_deref().map(normalize_person),
            developer_raw,
            qa_raw: optional_value_at(row, cols.qa),
            status: optional_value_at(row, cols.status),
            priority: optional_value_at(row, cols.priority),
            timeline_start: optional_value_at(row, cols.timeline_start),
            timeline_end: optional_value_at(row, cols.timeline_end),
            monday_doc_url: optional_value_at(row, cols.monday_doc),
            source_created_at: optional_value_at(row, cols.created_at),
            source_updated_at: optional_value_at(row, cols.updated_at),
            subtasks_summary: optional_value_at(row, cols.subtasks_summary),
            subtasks: Vec::new(),
            raw_json: serde_json::json!({
                "row": row_number,
                "externalKey": key,
                "title": parsed_title(row, cols),
            })
            .to_string(),
        };

        if let Some(existing) = index.get(&key).copied() {
            merge_requirement(&mut requirements[existing], parsed);
            duplicate_keys.push(key);
            last_requirement = Some(existing);
        } else {
            index.insert(key, requirements.len());
            requirements.push(parsed);
            last_requirement = Some(requirements.len() - 1);
        }
    }

    ParseReport {
        source: String::new(),
        file_name: String::new(),
        file_hash: String::new(),
        total_rows,
        requirements,
        invalid_rows,
        duplicate_keys,
    }
}

fn parsed_title(row: &[String], columns: &Columns) -> String {
    value_at(row, columns.title).trim().to_string()
}

fn header_columns(row: &[String]) -> Option<Columns> {
    let mut title = None;
    let mut task_id = None;
    let mut columns = Columns::default();

    for (index, raw) in row.iter().enumerate() {
        match normalized(raw).as_str() {
            "name" => {
                title = Some(index);
                columns.title = index;
            }
            "task id" => {
                task_id = Some(index);
                columns.task_id = index;
            }
            "sub tasks" => columns.subtasks_summary = Some(index),
            "feature" => columns.feature = Some(index),
            "type" => columns.requirement_type = Some(index),
            "informed" => columns.informed = Some(index),
            "developer" => columns.developer = Some(index),
            "qa" => columns.qa = Some(index),
            "status" => columns.status = Some(index),
            "priority" => columns.priority = Some(index),
            "timeline - start" => columns.timeline_start = Some(index),
            "timeline - end" => columns.timeline_end = Some(index),
            "monday doc v2" => columns.monday_doc = Some(index),
            value if value.starts_with("registro de creaci") => columns.created_at = Some(index),
            value if value.starts_with("registro de actualizaci") => {
                columns.updated_at = Some(index)
            }
            _ => {}
        }
    }

    title?;
    task_id?;
    Some(columns)
}

fn subitem_columns_from(row: &[String]) -> SubitemColumns {
    let mut columns = SubitemColumns::default();
    for (index, raw) in row.iter().enumerate() {
        match normalized(raw).as_str() {
            "name" => columns.name = index,
            "owner" => columns.owner = Some(index),
            "status" => columns.status = Some(index),
            "estimated sp" | "estimated" => columns.estimated = Some(index),
            "actual sp" | "actual" => columns.actual = Some(index),
            _ => {}
        }
    }
    columns
}

fn merge_requirement(target: &mut ParsedRequirement, source: ParsedRequirement) {
    fill_if_empty(&mut target.title, source.title);
    fill_option(&mut target.feature, source.feature);
    fill_option(&mut target.requirement_type, source.requirement_type);
    fill_option(&mut target.informed_raw, source.informed_raw);
    fill_option(&mut target.developer_raw, source.developer_raw);
    fill_option(
        &mut target.developer_normalized,
        source.developer_normalized,
    );
    fill_option(&mut target.qa_raw, source.qa_raw);
    fill_option(&mut target.status, source.status);
    fill_option(&mut target.priority, source.priority);
    fill_option(&mut target.timeline_start, source.timeline_start);
    fill_option(&mut target.timeline_end, source.timeline_end);
    fill_option(&mut target.monday_doc_url, source.monday_doc_url);
    fill_option(&mut target.source_created_at, source.source_created_at);
    fill_option(&mut target.source_updated_at, source.source_updated_at);
    fill_option(&mut target.subtasks_summary, source.subtasks_summary);
    target.subtasks.extend(source.subtasks);
}

fn fill_if_empty(target: &mut String, source: String) {
    if target.trim().is_empty() && !source.trim().is_empty() {
        *target = source;
    }
}

fn fill_option(target: &mut Option<String>, source: Option<String>) {
    if target.is_none() && source.is_some() {
        *target = source;
    }
}

fn normalized(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .replace('\u{00a0}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_person(value: &str) -> String {
    normalized(value)
}

fn value_at(row: &[String], index: usize) -> &str {
    row.get(index).map(String::as_str).unwrap_or("")
}

fn optional_value(row: &[String], index: usize) -> Option<String> {
    optional_value_at(row, Some(index))
}

fn optional_value_at(row: &[String], index: Option<usize>) -> Option<String> {
    let value = index.map(|index| value_at(row, index)).unwrap_or("").trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn parse_number(value: &str) -> Option<f64> {
    value.trim().replace(',', ".").parse::<f64>().ok()
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let shortened: String = value.chars().take(max.saturating_sub(1)).collect();
    format!("{shortened}…")
}

fn cell_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(value) => value.clone(),
        Data::Int(value) => value.to_string(),
        Data::Float(value) => {
            if value.fract() == 0.0 {
                format!("{value:.0}")
            } else {
                value.to_string()
            }
        }
        Data::Bool(value) => value.to_string(),
        Data::DateTime(value) => value.to_string(),
        Data::DateTimeIso(value) => value.clone(),
        Data::DurationIso(value) => value.clone(),
        Data::Error(value) => format!("{value:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sample_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace")
            .join("Tasks_Bplanner_Changes_Improvements_1793459694.xlsx")
    }

    #[test]
    fn parses_the_real_monday_export() {
        let path = sample_path();
        if !path.exists() {
            return;
        }
        let report = parse_file(&path).expect("parse xlsx");
        assert_eq!(report.source, "monday_xlsx");
        assert!(report.requirements.len() >= 50);
        assert!(report.invalid_rows.is_empty());

        let subtask_requirement = report
            .requirements
            .iter()
            .find(|requirement| requirement.external_key == "BPIM-079")
            .expect("BPIM-079");
        assert_eq!(subtask_requirement.subtasks.len(), 7);
        assert!(subtask_requirement
            .subtasks
            .iter()
            .any(|subtask| subtask.status.as_deref() == Some("Done")));

        let second_section = report
            .requirements
            .iter()
            .find(|requirement| requirement.external_key == "BPIM-144")
            .expect("BPIM-144");
        assert_eq!(second_section.requirement_type.as_deref(), Some("Task"));
    }

    #[test]
    fn detects_an_invalid_row() {
        let rows = vec![
            vec![
                "Name".into(),
                "Sub Tasks".into(),
                "Feature".into(),
                "Type".into(),
                "Informed".into(),
                "Developer".into(),
                "QA".into(),
                "Status".into(),
                "Priority".into(),
                "Timeline - Start".into(),
                "Timeline - End".into(),
                "monday Doc v2".into(),
                "Task ID".into(),
            ],
            vec![
                "Sin key".into(),
                String::new(),
                "Feature".into(),
                "Bug".into(),
                String::new(),
                String::new(),
                String::new(),
                "To Do".into(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
            ],
        ];
        let report = parse_rows(rows);
        assert!(report.requirements.is_empty());
        assert_eq!(report.invalid_rows.len(), 1);
    }
}
