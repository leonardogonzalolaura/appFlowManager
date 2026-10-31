use serde::{Deserialize, Serialize};

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Dev,
    Qas,
    Uat,
    Prd,
}

#[cfg(test)]
impl Environment {
    pub fn as_str(self) -> &'static str {
        match self {
            Environment::Dev => "dev",
            Environment::Qas => "qas",
            Environment::Uat => "uat",
            Environment::Prd => "prd",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Environment::Dev => "DEV",
            Environment::Qas => "QAS",
            Environment::Uat => "UAT",
            Environment::Prd => "PRD",
        }
    }

    pub fn from_key(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "dev" => Some(Environment::Dev),
            "qas" => Some(Environment::Qas),
            "uat" => Some(Environment::Uat),
            "prd" => Some(Environment::Prd),
            _ => None,
        }
    }

    /// Nombres habituales de rama. La comparación es case-insensitive.
    pub fn default_aliases(self) -> &'static [&'static str] {
        match self {
            Environment::Dev => &["dev", "develop", "development"],
            Environment::Qas => &["qas", "qa", "quality"],
            Environment::Uat => &["uat", "preuat", "pre-uat"],
            Environment::Prd => &["prd", "prod", "production", "main", "master"],
        }
    }

    /// Patrón de respaldo cuando no hay coincidencia exacta.
    pub fn default_pattern(self) -> Option<&'static str> {
        match self {
            Environment::Qas => Some("release/*"),
            Environment::Dev | Environment::Uat | Environment::Prd => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResolutionMode {
    Auto,
    Manual,
}

impl ResolutionMode {
    pub fn as_str(self) -> &'static str {
        match self {
            ResolutionMode::Auto => "auto",
            ResolutionMode::Manual => "manual",
        }
    }

    pub fn from_key(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "auto" => Some(ResolutionMode::Auto),
            "manual" => Some(ResolutionMode::Manual),
            _ => None,
        }
    }
}

/// Definición de un ambiente del catálogo global. Los ambientes son datos,
/// no una enumeración cerrada: DEV/QAS/UAT/PRD son solo los iniciales.
#[derive(Debug, Clone)]
pub struct EnvironmentSpec {
    pub key: String,
    pub label: String,
    pub color: String,
    pub aliases: Vec<String>,
    pub pattern: Option<String>,
}

impl EnvironmentSpec {
    #[cfg(test)]
    pub fn from_builtin(environment: Environment) -> Self {
        Self {
            key: environment.as_str().to_string(),
            label: environment.label().to_string(),
            color: default_color(environment).to_string(),
            aliases: environment
                .default_aliases()
                .iter()
                .map(|alias| alias.to_string())
                .collect(),
            pattern: environment.default_pattern().map(str::to_string),
        }
    }
}

#[cfg(test)]
pub fn default_color(environment: Environment) -> &'static str {
    match environment {
        Environment::Dev => "#6aa8ff",
        Environment::Qas => "#f5b84b",
        Environment::Uat => "#b08cff",
        Environment::Prd => "#3dd68c",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_environment_keys() {
        assert_eq!(Environment::from_key("QAS"), Some(Environment::Qas));
        assert_eq!(Environment::from_key("prd"), Some(Environment::Prd));
        assert_eq!(Environment::from_key("staging"), None);
        assert_eq!(Environment::Prd.label(), "PRD");
    }

    #[test]
    fn only_qas_has_release_pattern_by_default() {
        assert_eq!(Environment::Qas.default_pattern(), Some("release/*"));
        assert_eq!(Environment::Uat.default_pattern(), None);
        assert_eq!(Environment::Dev.default_pattern(), None);
        assert_eq!(Environment::Prd.default_pattern(), None);
    }
}
