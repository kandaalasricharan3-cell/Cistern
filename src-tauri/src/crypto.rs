use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::Argon2;
use rand::rngs::OsRng;
use rand::RngCore;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

#[derive(Serialize, Deserialize)]
struct WrappedKey {
    salt: Vec<u8>,
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct VaultMeta {
    passphrase: WrappedKey,
    recovery: WrappedKey,
}

fn derive_kek(secret: &[u8], salt: &[u8]) -> Result<[u8; KEY_LEN], String> {
    let mut output = [0u8; KEY_LEN];
    Argon2::default()
        .hash_password_into(secret, salt, &mut output)
        .map_err(|e| format!("Key derivation failed: {}", e))?;
    Ok(output)
}

fn wrap_key(db_key: &[u8; KEY_LEN], secret: &[u8]) -> Result<WrappedKey, String> {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let kek_bytes = derive_kek(secret, &salt)?;
    let kek = Key::<Aes256Gcm>::from_slice(&kek_bytes);
    let cipher = Aes256Gcm::new(kek);
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, db_key.as_ref())
        .map_err(|e| format!("Key wrap failed: {}", e))?;
    Ok(WrappedKey {
        salt: salt.to_vec(),
        nonce: nonce_bytes.to_vec(),
        ciphertext,
    })
}

fn unwrap_key(wrapped: &WrappedKey, secret: &[u8]) -> Result<[u8; KEY_LEN], String> {
    let kek_bytes = derive_kek(secret, &wrapped.salt)?;
    let kek = Key::<Aes256Gcm>::from_slice(&kek_bytes);
    let cipher = Aes256Gcm::new(kek);
    let nonce = Nonce::from_slice(&wrapped.nonce);
    let plaintext = cipher
        .decrypt(nonce, wrapped.ciphertext.as_ref())
        .map_err(|_| "Incorrect password — try again, or use your recovery key.".to_string())?;
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&plaintext);
    Ok(key)
}

/// Generates a high-entropy recovery key, formatted like XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
fn generate_recovery_key() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{:02X}", b)).collect();
    hex.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join("-")
}

fn recovery_key_to_bytes(recovery_key: &str) -> Vec<u8> {
    recovery_key.replace('-', "").into_bytes()
}

fn meta_path(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("vault.meta")
}

pub fn vault_exists(app_data_dir: &Path) -> bool {
    meta_path(app_data_dir).exists()
}

fn load_meta(app_data_dir: &Path) -> Result<VaultMeta, String> {
    let json = fs::read_to_string(meta_path(app_data_dir))
        .map_err(|e| format!("Could not read vault metadata: {}", e))?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

fn open_encrypted_db(app_data_dir: &Path, db_key: &[u8; KEY_LEN]) -> Result<Connection, String> {
    let db_path = app_data_dir.join("cistern.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let key_hex: String = db_key.iter().map(|b| format!("{:02x}", b)).collect();
    conn.pragma_update(None, "key", &format!("x'{}'", key_hex))
        .map_err(|e| e.to_string())?;
    // A real query is the only reliable way to confirm the key was correct —
    // SQLCipher won't error on pragma_update itself with a wrong key.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
        .map_err(|_| "Incorrect password — try again, or use your recovery key.".to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

/// First launch: generates a fresh DB key + recovery key, wraps both, writes vault.meta.
/// If a plaintext cistern.db already exists (real data present), migrates it into a new
/// encrypted file via SQLCipher's sqlcipher_export(), verifies row counts match, and only
/// then renames the original aside (never deletes it) before swapping the encrypted file in.
/// Returns (connection, recovery_key, whether a migration happened).
pub fn create_vault(app_data_dir: &Path, passphrase: &str) -> Result<(Connection, String, bool), String> {
    let db_path = app_data_dir.join("cistern.db");
    let has_existing_data = db_path.exists();

    let mut db_key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut db_key);
    let key_hex: String = db_key.iter().map(|b| format!("{:02x}", b)).collect();

    let recovery_key = generate_recovery_key();
    let recovery_bytes = recovery_key_to_bytes(&recovery_key);
    let passphrase_wrapped = wrap_key(&db_key, passphrase.as_bytes())?;
    let recovery_wrapped = wrap_key(&db_key, &recovery_bytes)?;
    let meta = VaultMeta {
        passphrase: passphrase_wrapped,
        recovery: recovery_wrapped,
    };
    let json = serde_json::to_string(&meta).map_err(|e| e.to_string())?;

    if !has_existing_data {
        fs::write(meta_path(app_data_dir), json).map_err(|e| e.to_string())?;
        let conn = open_encrypted_db(app_data_dir, &db_key)?;
        return Ok((conn, recovery_key, false));
    }

    // ---- Migration path: a real plaintext database already exists ----
    let new_path = app_data_dir.join("cistern_encrypted_tmp.db");
    if new_path.exists() {
        fs::remove_file(&new_path).map_err(|e| e.to_string())?;
    }

    // Count rows in the ORIGINAL, untouched, plaintext db first.
    let old_conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let old_count: i64 = old_conn
        .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
        .unwrap_or(-1);
    drop(old_conn);

    // Create the new encrypted file and set its key.
    let new_conn = Connection::open(&new_path).map_err(|e| e.to_string())?;
    new_conn
        .pragma_update(None, "key", &format!("x'{}'", key_hex))
        .map_err(|e| e.to_string())?;

    // Attach the ORIGINAL plaintext file — we only ever read from it via export, never write.
    new_conn
        .execute_batch(&format!(
            "ATTACH DATABASE '{}' AS plaintext_src KEY '';",
            db_path.to_string_lossy().replace('\'', "''")
        ))
        .map_err(|e| format!("Attach failed: {}", e))?;

    // Copies everything from the attached plaintext db INTO this new encrypted db.
    new_conn
        .query_row("SELECT sqlcipher_export('main', 'plaintext_src')", [], |_| Ok(()))
        .map_err(|e| format!("Migration export failed — original database untouched: {}", e))?;

    new_conn
        .execute_batch("DETACH DATABASE plaintext_src;")
        .map_err(|e| format!("Detach failed: {}", e))?;

    // Verify before trusting the migration at all.
    let new_count: i64 = new_conn
        .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
        .map_err(|e| format!("Verification query failed — original database untouched: {}", e))?;

    if new_count != old_count {
        return Err(format!(
            "Migration verification failed: original had {} transactions, encrypted copy has {}. \
             Nothing was changed — your original database is untouched. The partial copy at {:?} was left for inspection.",
            old_count, new_count, new_path
        ));
    }

    drop(new_conn);

    // Only now — after verified success — touch the original, and only by renaming, never deleting.
    let backup_path = app_data_dir.join("cistern_plaintext.bak");
    fs::rename(&db_path, &backup_path).map_err(|e| e.to_string())?;
    fs::rename(&new_path, &db_path).map_err(|e| e.to_string())?;

    fs::write(meta_path(app_data_dir), json).map_err(|e| e.to_string())?;

    let conn = open_encrypted_db(app_data_dir, &db_key)?;
    Ok((conn, recovery_key, true))
}

/// Normal launch: passphrase -> unwrap DB key -> open.
pub fn unlock_with_passphrase(app_data_dir: &Path, passphrase: &str) -> Result<Connection, String> {
    let meta = load_meta(app_data_dir)?;
    let db_key = unwrap_key(&meta.passphrase, passphrase.as_bytes())?;
    open_encrypted_db(app_data_dir, &db_key)
}

/// Forgot-password path: recovery key -> unwrap DB key -> open.
pub fn unlock_with_recovery(app_data_dir: &Path, recovery_key: &str) -> Result<Connection, String> {
    let meta = load_meta(app_data_dir)?;
    let recovery_bytes = recovery_key_to_bytes(recovery_key);
    let db_key = unwrap_key(&meta.recovery, &recovery_bytes)?;
    open_encrypted_db(app_data_dir, &db_key)
}