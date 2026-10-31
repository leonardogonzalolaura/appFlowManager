#[cfg(test)]
use crate::domain::environment::Environment;
use crate::domain::environment::EnvironmentSpec;
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

static VERSION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?").expect("regex válida"));

#[derive(Debug, Clone)]
pub struct BranchRef {
    pub name: String,
    pub sha: String,
    pub committed_at: DateTime<Utc>,
    pub author: Option<String>,
    pub message: Option<String>,
    pub is_remote: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub name: String,
    pub sha: String,
    pub committed_at: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    pub branch_name: Option<String>,
    pub sha: Option<String>,
    pub note: String,
    pub ambiguous: bool,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveError {
    ManualBranchNotFound(String),
}

pub fn resolve(
    spec: &EnvironmentSpec,
    branches: &[BranchRef],
    mode: crate::domain::environment::ResolutionMode,
    manual_branch: Option<&str>,
) -> Result<Resolution, ResolveError> {
    let candidates = sorted_candidates(branches);

    if mode == crate::domain::environment::ResolutionMode::Manual {
        let requested = manual_branch.unwrap_or_default().trim();
        if requested.is_empty() {
            return Err(ResolveError::ManualBranchNotFound(
                "No se indicó una rama manual.".into(),
            ));
        }
        let found = candidates
            .iter()
            .find(|candidate| candidate.name == requested)
            .or_else(|| {
                candidates
                    .iter()
                    .find(|candidate| candidate.name.eq_ignore_ascii_case(requested))
            })
            .ok_or_else(|| ResolveError::ManualBranchNotFound(requested.to_string()))?;

        return Ok(Resolution {
            branch_name: Some(found.name.clone()),
            sha: Some(found.sha.clone()),
            note: "Selección manual del usuario".into(),
            ambiguous: false,
            candidates,
        });
    }

    let exact: Vec<&Candidate> = candidates
        .iter()
        .filter(|candidate| {
            spec.aliases
                .iter()
                .any(|alias| alias.eq_ignore_ascii_case(&candidate.name))
        })
        .collect();

    if let Some(best) = exact.first() {
        let alias = spec
            .aliases
            .iter()
            .find(|alias| alias.eq_ignore_ascii_case(&best.name))
            .cloned()
            .unwrap_or_else(|| best.name.clone());
        return Ok(Resolution {
            branch_name: Some(best.name.clone()),
            sha: Some(best.sha.clone()),
            note: format!("Coincidencia exacta con alias '{alias}'"),
            ambiguous: exact.len() > 1,
            candidates,
        });
    }

    if let Some(pattern) = spec.pattern.as_deref() {
        let matches: Vec<&Candidate> = candidates
            .iter()
            .filter(|candidate| wildcard_match(pattern, &candidate.name))
            .collect();

        if let Some(best) = matches.first() {
            let note = match &best.version {
                Some(version) => format!(
                    "Mayor versión {pattern}: {version} (fecha {})",
                    best.committed_at.get(..10).unwrap_or(&best.committed_at)
                ),
                None => format!("Coincidencia con el patrón {pattern}"),
            };
            let ambiguous = matches.len() > 1 && is_tie(best, matches[1]);
            return Ok(Resolution {
                branch_name: Some(best.name.clone()),
                sha: Some(best.sha.clone()),
                note,
                ambiguous,
                candidates,
            });
        }
    }

    Ok(Resolution {
        branch_name: None,
        sha: None,
        note: format!(
            "No se encontró una rama para {} con los alias configurados.",
            spec.label
        ),
        ambiguous: false,
        candidates,
    })
}

fn sorted_candidates(branches: &[BranchRef]) -> Vec<Candidate> {
    let use_remote = branches.iter().any(|branch| branch.is_remote);
    let mut candidates: Vec<Candidate> = branches
        .iter()
        .filter(|branch| !use_remote || branch.is_remote)
        .filter(|branch| !branch.name.eq_ignore_ascii_case("HEAD"))
        .map(|branch| {
            let version = parse_version(&branch.name);
            Candidate {
                name: branch.name.clone(),
                sha: branch.sha.clone(),
                committed_at: branch
                    .committed_at
                    .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                version: version.map(|(major, minor, patch, _)| format!("{major}.{minor}.{patch}")),
            }
        })
        .collect();

    candidates.sort_by(|left, right| {
        let left_version =
            parse_version(&left.name).map(|(major, minor, patch, _)| (major, minor, patch));
        let right_version =
            parse_version(&right.name).map(|(major, minor, patch, _)| (major, minor, patch));
        right_version
            .cmp(&left_version)
            .then_with(|| right.committed_at.cmp(&left.committed_at))
            .then_with(|| left.name.cmp(&right.name))
    });
    candidates
}

fn is_tie(left: &Candidate, right: &Candidate) -> bool {
    let left_version =
        parse_version(&left.name).map(|(major, minor, patch, _)| (major, minor, patch));
    let right_version =
        parse_version(&right.name).map(|(major, minor, patch, _)| (major, minor, patch));
    left_version == right_version && left.committed_at == right.committed_at
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    match pattern.split_once('*') {
        Some((prefix, suffix)) => {
            let value = value.to_lowercase();
            let prefix = prefix.to_lowercase();
            let suffix = suffix.to_lowercase();
            value.len() >= prefix.len() + suffix.len()
                && value.starts_with(&prefix)
                && value.ends_with(&suffix)
        }
        None => pattern.eq_ignore_ascii_case(value),
    }
}

/// Devuelve (major, minor, patch, etiqueta normalizada) de la última
/// secuencia numérica de la rama. `release/1.0.10` > `release/1.0.9`.
fn parse_version(branch: &str) -> Option<(u64, u64, u64, String)> {
    let tail = branch.rsplit('/').next().unwrap_or(branch);
    let captures = VERSION_RE.captures_iter(tail).last()?;
    let major = captures.get(1)?.as_str().parse::<u64>().ok()?;
    let minor = captures
        .get(2)
        .and_then(|value| value.as_str().parse::<u64>().ok())
        .unwrap_or(0);
    let patch = captures
        .get(3)
        .and_then(|value| value.as_str().parse::<u64>().ok())
        .unwrap_or(0);
    Some((major, minor, patch, captures.get(0)?.as_str().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::environment::ResolutionMode;

    fn branch(name: &str, day: u32) -> BranchRef {
        BranchRef {
            name: name.into(),
            sha: format!("sha-{name}"),
            committed_at: DateTime::from_timestamp((day as i64) * 86_400, 0).expect("fecha válida"),
            author: Some("Leonardo".into()),
            message: Some(format!("commit {name}")),
            is_remote: true,
        }
    }

    fn spec(environment: Environment) -> EnvironmentSpec {
        EnvironmentSpec::from_builtin(environment)
    }

    #[test]
    fn exact_alias_wins_over_release_pattern() {
        let branches = vec![branch("qas", 1), branch("release/1.0.5", 2)];
        let result = resolve(
            &spec(Environment::Qas),
            &branches,
            ResolutionMode::Auto,
            None,
        )
        .expect("resolución");

        assert_eq!(result.branch_name.as_deref(), Some("qas"));
        assert!(result.note.contains("alias 'qas'"));
        assert!(!result.ambiguous);
    }

    #[test]
    fn release_uses_numeric_semver_not_lexicographic() {
        let branches = vec![
            branch("release/1.0.9", 10),
            branch("release/1.0.10", 5),
            branch("release/1.0.2", 20),
        ];
        let result = resolve(
            &spec(Environment::Qas),
            &branches,
            ResolutionMode::Auto,
            None,
        )
        .expect("resolución");

        assert_eq!(result.branch_name.as_deref(), Some("release/1.0.10"));
        assert!(result.note.contains("1.0.10"));
    }

    #[test]
    fn version_tie_breaks_by_commit_date() {
        let branches = vec![
            branch("release/2.0.0", 10),
            branch("release/2.0.0-hotfix", 20),
        ];
        let result = resolve(
            &spec(Environment::Qas),
            &branches,
            ResolutionMode::Auto,
            None,
        )
        .expect("resolución");

        assert_eq!(result.branch_name.as_deref(), Some("release/2.0.0-hotfix"));
    }

    #[test]
    fn manual_mode_requires_existing_branch() {
        let branches = vec![branch("qas", 1)];
        let error = resolve(
            &spec(Environment::Qas),
            &branches,
            ResolutionMode::Manual,
            Some("release/9.9.9"),
        )
        .expect_err("debe fallar");

        assert_eq!(
            error,
            ResolveError::ManualBranchNotFound("release/9.9.9".into())
        );
    }

    #[test]
    fn manual_mode_accepts_branch_case_insensitive() {
        let branches = vec![branch("release/1.0.5", 1)];
        let result = resolve(
            &spec(Environment::Qas),
            &branches,
            ResolutionMode::Manual,
            Some("Release/1.0.5"),
        )
        .expect("resolución");

        assert_eq!(result.branch_name.as_deref(), Some("release/1.0.5"));
        assert!(result.note.contains("manual"));
    }

    #[test]
    fn prd_detects_main() {
        let branches = vec![branch("main", 1), branch("dev", 2)];
        let result = resolve(
            &spec(Environment::Prd),
            &branches,
            ResolutionMode::Auto,
            None,
        )
        .expect("resolución");

        assert_eq!(result.branch_name.as_deref(), Some("main"));
    }

    #[test]
    fn unresolved_environment_reports_no_branch() {
        let branches = vec![branch("develop", 1)];
        let result = resolve(
            &spec(Environment::Qas),
            &branches,
            ResolutionMode::Auto,
            None,
        )
        .expect("resolución");

        assert!(result.branch_name.is_none());
        assert!(result.sha.is_none());
        assert!(result.note.contains("No se encontró"));
    }

    #[test]
    fn identical_version_and_date_is_ambiguous() {
        let branches = vec![
            branch("release/3.1.0", 5),
            branch("release/3.1.0-hotfix", 5),
        ];
        let result = resolve(
            &spec(Environment::Qas),
            &branches,
            ResolutionMode::Auto,
            None,
        )
        .expect("resolución");

        assert!(result.ambiguous);
        assert_eq!(result.candidates.len(), 2);
    }

    #[test]
    fn wildcard_matching_is_case_insensitive() {
        assert!(wildcard_match("release/*", "Release/1.0.0"));
        assert!(wildcard_match("release/*", "release/2024.10"));
        assert!(!wildcard_match("release/*", "qas"));
    }
}
