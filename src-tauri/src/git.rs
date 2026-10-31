use serde::Serialize;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub available: bool,
    pub version: Option<String>,
    pub message: Option<String>,
}

pub fn detect() -> GitStatus {
    let mut command = Command::new("git");
    command.arg("--version");

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    match command.output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            GitStatus {
                available: true,
                version: Some(version),
                message: None,
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            GitStatus {
                available: false,
                version: None,
                message: Some(if stderr.is_empty() {
                    "Git respondió con un error desconocido.".to_string()
                } else {
                    stderr
                }),
            }
        }
        Err(err) => GitStatus {
            available: false,
            version: None,
            message: Some(format!(
                "No se encontró Git en el PATH del sistema ({err})."
            )),
        },
    }
}
