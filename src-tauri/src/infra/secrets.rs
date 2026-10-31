use crate::error::AppError;

/// Entropía adicional fija de FlowManager. DPAPI sigue ligando el secreto al
/// usuario/máquina de Windows, pero evita que otro proceso del mismo usuario
/// descifre el blob sin conocer esta constante.
const ENTROPY: &[u8] = b"FlowManager.DB.Secret.v1";

#[cfg(windows)]
pub fn protect(plaintext: &str) -> Result<Vec<u8>, AppError> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let data = plaintext.as_bytes();
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: ENTROPY.len() as u32,
        pbData: ENTROPY.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptProtectData(
            &input,
            windows::core::PCWSTR::null(),
            Some(&entropy),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| AppError::Secret(format!("No se pudo cifrar el secreto: {error}")))?;

        let ciphertext = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Ok(ciphertext)
    }
}

#[cfg(windows)]
pub fn unprotect(ciphertext: &[u8]) -> Result<String, AppError> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: ciphertext.len() as u32,
        pbData: ciphertext.as_ptr() as *mut u8,
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: ENTROPY.len() as u32,
        pbData: ENTROPY.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(
            &input,
            None,
            Some(&entropy),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| AppError::Secret(format!("No se pudo descifrar el secreto: {error}")))?;

        let plaintext = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        String::from_utf8(plaintext)
            .map_err(|_| AppError::Secret("El secreto no es UTF-8 válido.".into()))
    }
}

#[cfg(not(windows))]
pub fn protect(_plaintext: &str) -> Result<Vec<u8>, AppError> {
    Err(AppError::Secret(
        "DPAPI solo está disponible en Windows.".into(),
    ))
}

#[cfg(not(windows))]
pub fn unprotect(_ciphertext: &[u8]) -> Result<String, AppError> {
    Err(AppError::Secret(
        "DPAPI solo está disponible en Windows.".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpapi_round_trip() {
        let plaintext = "s3cr3t-ñ-🔐";
        let ciphertext = protect(plaintext).expect("protect");
        assert_ne!(ciphertext, plaintext.as_bytes());
        assert_eq!(unprotect(&ciphertext).expect("unprotect"), plaintext);
    }
}
