/// Convenciones y protecciones para el flujo de despliegue.
const MAX_BRANCH_LENGTH: usize = 90;

const RESERVED_BRANCHES: &[&str] = &[
    "dev",
    "develop",
    "development",
    "qa",
    "qas",
    "stage",
    "staging",
    "uat",
    "prd",
    "prod",
    "production",
    "main",
    "master",
];

/// Nombre de la rama hija del ambiente: claves de requerimiento + ambiente.
/// Si excede 90 caracteres se usa la primera clave, un identificador corto de
/// sesión y el ambiente.
pub fn deployment_branch_name(keys: &[String], environment: &str, short: &str) -> String {
    let environment = sanitize(environment);
    let sanitized: Vec<String> = keys.iter().map(|key| sanitize(key)).collect();
    let joined = sanitized.join("-");
    let candidate = format!("{joined}-{environment}");
    if candidate.len() <= MAX_BRANCH_LENGTH {
        return candidate;
    }

    let first = sanitized
        .first()
        .map(String::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or("req");
    let fallback = format!("{first}-bundle-{short}-{environment}");
    if fallback.len() <= MAX_BRANCH_LENGTH {
        return fallback;
    }
    fallback
        .chars()
        .take(MAX_BRANCH_LENGTH)
        .collect::<String>()
        .trim_end_matches(|character| matches!(character, '-' | '/' | '.'))
        .to_string()
}

/// Las ramas de ambiente canónicas y `release/*` nunca se empujan ni se
/// sobrescriben desde FlowManager.
pub fn is_protected_branch(branch: &str) -> bool {
    let lower = branch.trim().to_ascii_lowercase();
    lower.starts_with("release/")
        || RESERVED_BRANCHES
            .iter()
            .any(|reserved| lower == *reserved)
}

fn sanitize(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut last_dash = false;
    for character in value.trim().chars() {
        let allowed = character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '/');
        if allowed {
            result.push(character);
            last_dash = false;
        } else if !last_dash {
            result.push('-');
            last_dash = true;
        }
    }
    result.trim_matches(|character| matches!(character, '-' | '/' | '.')).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_requirement_keys_and_environment() {
        let keys = vec!["BPIM-139".to_string(), "BPIM-140".to_string()];
        assert_eq!(
            deployment_branch_name(&keys, "qas", "abc12345"),
            "BPIM-139-BPIM-140-qas"
        );
    }

    #[test]
    fn falls_back_when_branch_is_too_long() {
        let keys = vec!["A-VERY-LONG-REQUIREMENT-KEY-THAT-KEEPS-GOING".to_string()];
        let name = deployment_branch_name(&keys, "stage", "abcd1234");
        assert!(name.len() <= MAX_BRANCH_LENGTH);
        assert!(name.starts_with("A-VERY-LONG-REQUIREMENT-KEY"));
        assert!(name.ends_with("-stage"));
    }

    #[test]
    fn sanitizes_spaces() {
        let keys = vec!["BPIM 139".to_string()];
        assert_eq!(
            deployment_branch_name(&keys, "ppr", "abcd1234"),
            "BPIM-139-ppr"
        );
    }

    #[test]
    fn protects_environment_and_release_branches() {
        for branch in ["dev", "DEV", "qas", "uat", "prd", "stage", "master"] {
            assert!(is_protected_branch(branch), "{branch} should be protected");
        }
        assert!(is_protected_branch("release/2026-01"));
        assert!(!is_protected_branch("BPIM-139-BPIM-140-qas"));
        assert!(!is_protected_branch("feature/BPIM-139"));
    }
}
