/// Convención de nombre de rama por tipo de requerimiento.
/// - Bug / Hotfix → `fix/<Task ID>`
/// - Resto → `feature/<Task ID>`
pub fn default_branch_name(requirement_type: Option<&str>, external_key: &str) -> String {
    let kind = requirement_type.unwrap_or_default().trim().to_lowercase();
    let prefix = if kind.contains("bug") || kind.contains("hotfix") {
        "fix"
    } else {
        "feature"
    };
    format!("{prefix}/{external_key}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bugs_use_fix_prefix() {
        assert_eq!(default_branch_name(Some("Bug"), "BPIM-133"), "fix/BPIM-133");
        assert_eq!(
            default_branch_name(Some("Hotfix"), "BPIM-900"),
            "fix/BPIM-900"
        );
    }

    #[test]
    fn stories_and_tasks_use_feature_prefix() {
        assert_eq!(
            default_branch_name(Some("User Story"), "BPIM-133"),
            "feature/BPIM-133"
        );
        assert_eq!(
            default_branch_name(Some("Task"), "BPIM-144"),
            "feature/BPIM-144"
        );
        assert_eq!(default_branch_name(None, "MAN-0001"), "feature/MAN-0001");
    }
}
