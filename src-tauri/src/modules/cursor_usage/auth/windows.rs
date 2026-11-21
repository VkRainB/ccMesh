//! Windows Cursor safeStorage (`v1` / Chromium `v10`). Uses the current user's DPAPI context.

use std::path::Path;
use std::ptr::{null, null_mut};

use aws_lc_rs::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{
    CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};
use zeroize::{Zeroize, Zeroizing};

use super::ENCRYPTED_TOKEN_PREFIX;
use crate::error::{AppError, AppResult};

const ENVELOPE_PREFIX: &str = "cursor-safe-storage:v1:";
const DPAPI_PREFIX: &[u8] = b"DPAPI";
const AES_PREFIX: &[u8] = b"v10";
const NONCE_LEN: usize = 12;

pub(super) fn decode_tokens(
    db_path: &Path,
    mut access: String,
    mut refresh: Option<String>,
) -> AppResult<(String, Option<String>)> {
    let encrypted_access = access.starts_with(ENCRYPTED_TOKEN_PREFIX);
    let encrypted_refresh = refresh
        .as_deref()
        .is_some_and(|token| token.starts_with(ENCRYPTED_TOKEN_PREFIX));
    if encrypted_access || encrypted_refresh {
        let key = load_key(db_path);
        let decrypt = |value: &str| decrypt_token(key.as_ref().map_err(|&err| err)?, value);
        if encrypted_access {
            access = decrypt(&access)
                .map_err(|err| AppError::Config(format!("无法读取 Cursor 加密登录凭证：{err}")))?;
        }
        if encrypted_refresh {
            // An unusable refresh token must not discard a usable access token.
            refresh = refresh.as_deref().and_then(|token| decrypt(token).ok());
        }
    }
    Ok((access, refresh))
}

#[derive(Deserialize)]
struct LocalState {
    os_crypt: OsCrypt,
}

#[derive(Deserialize)]
struct OsCrypt {
    encrypted_key: String,
}

fn load_key(db_path: &Path) -> Result<LessSafeKey, &'static str> {
    // The database is <user data>/User/globalStorage/state.vscdb.
    let root = db_path
        .ancestors()
        .nth(3)
        .ok_or("无法定位 Cursor 用户数据目录")?;
    let state =
        std::fs::read(root.join("Local State")).map_err(|_| "无法读取 Cursor Local State")?;
    let state: LocalState =
        serde_json::from_slice(&state).map_err(|_| "Cursor Local State 缺少有效的系统密钥")?;
    let wrapped = STANDARD
        .decode(state.os_crypt.encrypted_key)
        .map_err(|_| "Cursor 系统密钥编码无效")?;
    let wrapped = wrapped
        .strip_prefix(DPAPI_PREFIX)
        .ok_or("不支持该 Cursor 系统密钥格式")?;
    unprotect_key(wrapped)
}

fn unprotect_key(wrapped: &[u8]) -> Result<LessSafeKey, &'static str> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: wrapped
            .len()
            .try_into()
            .map_err(|_| "Cursor 系统密钥长度无效")?,
        pbData: wrapped.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    // SAFETY: DPAPI reads the input for this call and allocates the output on success.
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            null_mut(),
            null(),
            null(),
            null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 || output.pbData.is_null() {
        return Err("Windows 无法解锁系统密钥，请用登录 Cursor 的同一 Windows 用户运行 ccMesh");
    }
    // SAFETY: DPAPI returned this writable allocation; LocalFree releases it after use.
    let decoded = unsafe { std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize) };
    let key = UnboundKey::new(&AES_256_GCM, decoded);
    decoded.zeroize();
    unsafe { LocalFree(output.pbData.cast()) };
    key.map(LessSafeKey::new)
        .map_err(|_| "Cursor 系统密钥长度无效")
}

fn decrypt_token(key: &LessSafeKey, stored: &str) -> Result<String, &'static str> {
    let encoded = stored
        .strip_prefix(ENVELOPE_PREFIX)
        .ok_or("不支持该 Cursor 加密凭证版本")?;
    let mut bytes = Zeroizing::new(
        STANDARD
            .decode(encoded)
            .map_err(|_| "Cursor 加密凭证编码无效")?,
    );
    if !bytes.starts_with(AES_PREFIX) {
        return Err("不支持该 Cursor 加密凭证格式");
    }
    let payload = &mut bytes[AES_PREFIX.len()..];
    if payload.len() < NONCE_LEN + AES_256_GCM.tag_len() {
        return Err("Cursor 加密凭证长度无效");
    }
    let (nonce, ciphertext) = payload.split_at_mut(NONCE_LEN);
    let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| "Cursor 加密凭证长度无效")?;
    let plaintext = key
        .open_in_place(nonce, Aad::empty(), ciphertext)
        .map_err(|_| "Cursor 加密凭证校验失败")?;
    std::str::from_utf8(plaintext)
        .map(str::to_owned)
        .map_err(|_| "Cursor 凭证文本无效")
}

#[cfg(test)]
mod tests {
    use rusqlite::{params, Connection};
    use serde_json::json;
    use windows_sys::Win32::Security::Cryptography::CryptProtectData;

    use super::*;
    use crate::modules::cursor_usage::auth::read_auth;

    #[test]
    fn reads_windows_encrypted_tokens_and_handles_bad_refresh() {
        let dir = tempfile::tempdir().unwrap();
        let storage = dir.path().join("User").join("globalStorage");
        std::fs::create_dir_all(&storage).unwrap();
        let db_path = storage.join("state.vscdb");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)")
            .unwrap();

        let mut aes_key = [42u8; 32];
        let key = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &aes_key).unwrap());
        let seal = |text: &str, nonce: [u8; NONCE_LEN]| {
            let mut ciphertext = text.as_bytes().to_vec();
            key.seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Aad::empty(),
                &mut ciphertext,
            )
            .unwrap();
            let envelope = [AES_PREFIX, &nonce, ciphertext.as_slice()].concat();
            format!("{ENVELOPE_PREFIX}{}", STANDARD.encode(envelope))
        };

        let input = CRYPT_INTEGER_BLOB {
            cbData: aes_key.len() as u32,
            pbData: aes_key.as_mut_ptr(),
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };
        // SAFETY: The input is valid for this call; Windows owns the output allocation.
        let encrypted = unsafe {
            assert_ne!(
                CryptProtectData(
                    &input,
                    null(),
                    null(),
                    null(),
                    null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                ),
                0
            );
            assert!(!output.pbData.is_null());
            let wrapped = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
            let encrypted = STANDARD.encode([DPAPI_PREFIX, wrapped].concat());
            LocalFree(output.pbData.cast());
            encrypted
        };
        std::fs::write(
            dir.path().join("Local State"),
            json!({"os_crypt": {"encrypted_key": encrypted}}).to_string(),
        )
        .unwrap();

        let access = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyX3Rlc3QifQ.sig";
        let refresh = "test-refresh-token";
        let set_token = |key, value: &str| {
            conn.execute(
                "INSERT OR REPLACE INTO ItemTable VALUES (?1, ?2)",
                params![key, value],
            )
            .unwrap();
        };
        set_token("cursorAuth/accessToken", &seal(access, [1; NONCE_LEN]));
        set_token("cursorAuth/refreshToken", &seal(refresh, [2; NONCE_LEN]));

        let tokens = read_auth(&db_path).unwrap();
        assert_eq!(tokens.access_token, access);
        assert_eq!(tokens.refresh_token.as_deref(), Some(refresh));

        let bad = format!("{ENVELOPE_PREFIX}bad");
        set_token("cursorAuth/refreshToken", &bad);
        let tokens = read_auth(&db_path).unwrap();
        assert_eq!(tokens.access_token, access);
        assert!(tokens.refresh_token.is_none());

        set_token("cursorAuth/accessToken", &bad);
        assert!(matches!(read_auth(&db_path), Err(AppError::Config(_))));

        set_token("cursorAuth/accessToken", access);
        set_token("cursorAuth/refreshToken", refresh);
        std::fs::remove_file(dir.path().join("Local State")).unwrap();
        let tokens = read_auth(&db_path).unwrap();
        assert_eq!(tokens.access_token, access);
        assert_eq!(tokens.refresh_token.as_deref(), Some(refresh));
    }
}
