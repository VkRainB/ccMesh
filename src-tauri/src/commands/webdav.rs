use chrono::Utc;
use serde_json::json;
use tauri::State;

use crate::error::AppResult;
use crate::models::config::WebDavConfig;
use crate::models::webdav::{BackupFile, WebDavTestResult};
use crate::modules::storage::config_repo;
use crate::modules::webdav::client::WebDavClient;
use crate::modules::webdav::sync;
use crate::state::AppState;

fn webdav_cfg(state: &AppState) -> AppResult<WebDavConfig> {
    let conn = state.db_pool.get()?;
    Ok(config_repo::get_config(&conn)?.webdav)
}

/// 测试 WebDAV 连接（接收待测配置，无需先保存）。
#[tauri::command]
pub async fn test_webdav(config: WebDavConfig) -> AppResult<WebDavTestResult> {
    let res = match WebDavClient::connect(&config) {
        Ok(c) => c.test().await,
        Err(e) => Err(e),
    };
    Ok(match res {
        Ok(_) => WebDavTestResult {
            success: true,
            message: "连接成功".into(),
        },
        Err(e) => WebDavTestResult {
            success: false,
            message: e.to_string(),
        },
    })
}

/// 备份：生成脱敏数据库副本并上传（含 time+version 元数据 sidecar）。
#[tauri::command]
pub async fn webdav_backup(state: State<'_, AppState>) -> AppResult<String> {
    let cfg = webdav_cfg(&state)?;
    let temp = std::env::temp_dir().join("ccmesh_backup.db");
    {
        let conn = state.db_pool.get()?;
        sync::create_backup_copy(&conn, &temp)?;
    }
    let bytes = std::fs::read(&temp)?;
    let _ = std::fs::remove_file(&temp);

    let filename = format!("ccmesh_{}.db", chrono::Local::now().format("%Y%m%d_%H%M%S"));
    let client = WebDavClient::connect(&cfg)?;
    client.put(&filename, bytes).await?;
    let meta = json!({ "backupTime": Utc::now().to_rfc3339(), "version": env!("CARGO_PKG_VERSION") });
    let _ = client
        .put(
            &format!("{filename}.meta.json"),
            serde_json::to_vec(&meta).unwrap_or_default(),
        )
        .await;
    Ok(filename)
}

/// 恢复：下载备份并合并；strategy="remote" 覆盖本地，否则保留本地。
#[tauri::command]
pub async fn webdav_restore(
    state: State<'_, AppState>,
    filename: String,
    strategy: Option<String>,
) -> AppResult<()> {
    let cfg = webdav_cfg(&state)?;
    let client = WebDavClient::connect(&cfg)?;
    let bytes = client.get(&filename).await?;
    let temp = std::env::temp_dir().join("ccmesh_restore.db");
    std::fs::write(&temp, &bytes)?;

    let overwrite = strategy.as_deref() == Some("remote");
    let device_id = state.device_id.clone();
    {
        let mut conn = state.db_pool.get()?;
        sync::merge_from_backup(&mut conn, &temp, overwrite, &device_id)?;
    }
    let _ = std::fs::remove_file(&temp);
    Ok(())
}

#[tauri::command]
pub async fn webdav_list_backups(state: State<'_, AppState>) -> AppResult<Vec<BackupFile>> {
    let cfg = webdav_cfg(&state)?;
    WebDavClient::connect(&cfg)?.list_backups().await
}

#[tauri::command]
pub async fn webdav_delete_backup(state: State<'_, AppState>, filename: String) -> AppResult<()> {
    let cfg = webdav_cfg(&state)?;
    let client = WebDavClient::connect(&cfg)?;
    client.delete(&filename).await?;
    let _ = client.delete(&format!("{filename}.meta.json")).await;
    Ok(())
}
