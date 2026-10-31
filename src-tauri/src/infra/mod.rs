pub mod branch_ops;
pub mod git_cli;
pub mod git_reader;
pub mod requirements_parser;
pub mod secrets;
pub mod squash_ops;

use crate::error::AppError;
use std::path::{Path, PathBuf};

/// Canonicaliza una ruta y quita el prefijo `\\?\` de Windows para mostrarla
/// de forma natural en la UI y la base.
pub fn canonicalize_path(path: &Path) -> Result<PathBuf, AppError> {
    let canonical = std::fs::canonicalize(path)?;

    #[cfg(windows)]
    {
        if let Some(value) = canonical.to_str() {
            if let Some(stripped) = value.strip_prefix(r"\\?\") {
                return Ok(PathBuf::from(stripped));
            }
        }
    }

    Ok(canonical)
}
