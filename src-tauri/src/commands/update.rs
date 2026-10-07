use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use rusqlite::{Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

use crate::commands::proxy::stop_proxy_for_update;
use crate::error::{AppError, AppResult};
use crate::modules::lifecycle;
use crate::modules::proxy::client::should_proxy_update;
use crate::modules::storage::config_repo;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub version: String,
    pub current_version: String,
    pub notes: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings {
    pub auto_check: bool,
    pub check_interval: i64,
    pub skipped_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionJumpInfo {
    pub previous_version: String,
    pub current_version: String,
    pub notes: String,
}

#[derive(Deserialize, Serialize)]
struct PendingNotes {
    version: String,
    notes: String,
}

// 本机更新状态，不属于可同步的 AppConfig / SAFE_CONFIG_KEYS。
const LAST_RUN_VERSION_KEY: &str = "update_lastRunVersion";
const PENDING_NOTES_KEY: &str = "update_pendingNotes";
const BUNDLED_CHANGELOG: &str = include_str!("../../../CHANGELOG.md");

fn bundled_release_notes(changelog: &str, version: &str) -> String {
    let mut body_start = None;
    let mut offset = 0;
    for line in changelog.split_inclusive('\n') {
        if let Some(heading) = line.trim().strip_prefix("## ") {
            if let Some(start) = body_start {
                return changelog[start..offset].trim().to_string();
            }
            if heading
                .strip_prefix('[')
                .and_then(|heading| heading.split_once(']'))
                .is_some_and(|(heading_version, _)| heading_version == version)
            {
                body_start = Some(offset + line.len());
            }
        }
        offset += line.len();
    }
    body_start
        .map(|start| changelog[start..].trim().to_string())
        .unwrap_or_default()
}

fn clear_consumed_notes(conn: &Connection, package: &tauri::PackageInfo) -> AppResult<()> {
    let Some(raw) = config_repo::get_value(conn, PENDING_NOTES_KEY)? else {
        return Ok(());
    };
    let keep = serde_json::from_str::<PendingNotes>(&raw)
        .ok()
        .and_then(|pending| pending.version.parse().ok())
        .is_some_and(|version| package.version.cmp_precedence(&version).is_lt());
    if !keep {
        conn.execute("DELETE FROM app_config WHERE key = ?1", [PENDING_NOTES_KEY])?;
    }
    Ok(())
}

fn check_version_jump_in_db(
    conn: &mut Connection,
    package: &tauri::PackageInfo,
) -> AppResult<Option<VersionJumpInfo>> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current_version = package.version.to_string();
    let previous =
        config_repo::get_value(&tx, LAST_RUN_VERSION_KEY)?.and_then(|raw| raw.parse().ok());
    let result = match previous {
        Some(previous) if package.version.cmp_precedence(&previous).is_gt() => {
            let notes = config_repo::get_value(&tx, PENDING_NOTES_KEY)?
                .and_then(|raw| serde_json::from_str::<PendingNotes>(&raw).ok())
                .filter(|pending| {
                    pending.version == current_version && !pending.notes.trim().is_empty()
                })
                .map(|pending| pending.notes)
                .unwrap_or_else(|| bundled_release_notes(BUNDLED_CHANGELOG, &current_version));
            // 检测不消费升级：关闭说明弹层后才允许 ack 推进 baseline。
            Some(VersionJumpInfo {
                previous_version: previous.to_string(),
                current_version,
                notes,
            })
        }
        _ => {
            // 首次启动、损坏 baseline、同版和降级均只记录实际运行版本。
            config_repo::set_value(&tx, LAST_RUN_VERSION_KEY, &current_version)?;
            clear_consumed_notes(&tx, package)?;
            None
        }
    };
    tx.commit()?;
    Ok(result)
}

fn acknowledge_version_jump_in_db(
    conn: &mut Connection,
    package: &tauri::PackageInfo,
    version: &str,
) -> AppResult<()> {
    let current_version = package.version.to_string();
    if version != current_version {
        return Err(AppError::InvalidArgument(
            "只能确认当前运行版本的升级说明".into(),
        ));
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    config_repo::set_value(&tx, LAST_RUN_VERSION_KEY, &current_version)?;
    clear_consumed_notes(&tx, package)?;
    tx.commit()?;
    Ok(())
}

/// 本机升级检测：首次运行不弹，升级说明在确认前可重复读取。
#[tauri::command]
pub fn check_version_jump(
    app: AppHandle,
    state: State<AppState>,
) -> AppResult<Option<VersionJumpInfo>> {
    let mut conn = state.db_pool.get()?;
    check_version_jump_in_db(&mut conn, app.package_info())
}

/// 真实关闭升级说明后确认；旧版本弹层不能消费当前运行版本的状态。
#[tauri::command]
pub fn acknowledge_version_jump(
    app: AppHandle,
    state: State<AppState>,
    version: String,
) -> AppResult<()> {
    let mut conn = state.db_pool.get()?;
    acknowledge_version_jump_in_db(&mut conn, app.package_info(), &version)
}

const UPDATE_IN_PROGRESS: &str = "更新正在进行中";

struct UpdateGuard<'a>(&'a AtomicBool);

impl Drop for UpdateGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn begin_update(busy: &AtomicBool) -> AppResult<UpdateGuard<'_>> {
    busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| UpdateGuard(busy))
        .map_err(|_| AppError::InvalidArgument(UPDATE_IN_PROGRESS.into()))
}

/// 构建 updater：`proxyForUpdate` 且地址非空时经代理出网（无 scheme 按 http 处理；无效则告警直连）。
fn build_updater(
    app: &AppHandle,
    state: &State<'_, AppState>,
) -> AppResult<tauri_plugin_updater::Updater> {
    let cfg = {
        let conn = state.db_pool.get()?;
        config_repo::get_config(&conn)?
    };
    let mut builder = app.updater_builder();
    // Windows install() 在 exit(0) 前触发 on_before_exit 钩子，把托盘移除 + 单实例锁销毁
    // 放到这里执行：install 成功才清理，install 失败则托盘/锁保留，应用不进入降级状态。
    let app_for_hook = app.clone();
    builder = builder.on_before_exit(move || lifecycle::prepare_for_process_exit(&app_for_hook));
    if should_proxy_update(cfg.proxy_for_update, &cfg.proxy_url) {
        let raw = cfg.proxy_url.trim();
        let normalized = if raw.contains("://") {
            raw.to_string()
        } else {
            format!("http://{raw}")
        };
        match normalized.parse() {
            Ok(u) => builder = builder.proxy(u),
            Err(e) => tracing::warn!("更新代理地址无效，直连检查更新: {e}"),
        }
    }
    builder
        .build()
        .map_err(|e| AppError::Unknown(format!("更新器不可用: {e}")))
}

/// 检查更新（endpoints/pubkey 未配置时返回错误，由前端容错处理）。
#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<UpdateInfo> {
    let current = app.package_info().version.to_string();
    let updater = build_updater(&app, &state)?;
    match updater.check().await {
        Ok(Some(u)) => Ok(UpdateInfo {
            available: true,
            version: u.version.clone(),
            current_version: u.current_version.clone(),
            notes: u.body.clone().unwrap_or_default(),
        }),
        Ok(None) => Ok(UpdateInfo {
            available: false,
            version: String::new(),
            current_version: current,
            notes: String::new(),
        }),
        Err(e) => Err(AppError::Unknown(format!("检查更新失败: {e}"))),
    }
}

/// 下载并安装应用更新，然后由后端直接重启应用。
///
/// Windows: `install()` 内部 `ShellExecuteW` + `exit(0)`，托盘与单实例锁的清理
/// 走 `on_before_exit` 钩子在 exit 前执行，install 失败则不清理，避免应用丢托盘/丢锁降级。
/// macOS/Linux: 先停代理释放端口与后台任务，再 install 原地替换 bundle，最后重启。
#[tauri::command]
pub async fn install_update_and_restart(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let _guard = begin_update(&state.update_busy)?;
    let updater = build_updater(&app, &state)?;
    let update = updater
        .check()
        .await
        .map_err(|e| AppError::Unknown(format!("检查更新失败: {e}")))?
        .ok_or_else(|| AppError::Unknown("无可用更新".to_string()))?;

    {
        let conn = state.db_pool.get()?;
        let pending = PendingNotes {
            version: update.version.clone(),
            notes: update.body.clone().unwrap_or_default(),
        };
        config_repo::set_value(&conn, PENDING_NOTES_KEY, &serde_json::to_string(&pending)?)?;
    }

    tracing::info!(version = %update.version, "开始下载应用更新");

    let mut downloaded: u64 = 0;
    let app_progress = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let _ = app_progress.emit(
                    "update-progress",
                    json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| AppError::Unknown(format!("下载更新失败: {e}")))?;

    tracing::info!(version = %update.version, "开始安装应用更新");

    #[cfg(target_os = "windows")]
    {
        stop_proxy_for_update(&state).await;
        // ponytail: 100ms 等 proxy 句柄释放/日志落盘再 install；非确定性，OS 调度慢时仍可能抢跑。
        //   升级路径：让 proxy.stop() 返回完成信号后 await，再去掉 sleep。
        tokio::time::sleep(Duration::from_millis(100)).await;
        update.install(bytes).map_err(|e| {
            AppError::Unknown(format!(
                "Windows 更新安装失败: {e}。已停止代理；请重启应用后再试。"
            ))
        })?;
        // install() 成功后插件内部走 on_before_exit 钩子（清理托盘+单实例锁）→ ShellExecuteW → exit(0)，不会返回。
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        stop_proxy_for_update(&state).await;

        // 等 proxy 句柄释放/日志落盘后再替换 bundle，避免 macOS 安装阶段仍持有旧进程资源。
        tokio::time::sleep(Duration::from_millis(100)).await;
        update
            .install(bytes)
            .map_err(|e| AppError::Unknown(format!("安装更新失败: {e}")))?;

        tracing::info!("应用更新安装完成，正在重启应用");
        lifecycle::restart_process(&app);
    }
}

#[tauri::command]
pub fn get_update_settings(state: State<AppState>) -> AppResult<UpdateSettings> {
    let conn = state.db_pool.get()?;
    let cfg = config_repo::get_config(&conn)?;
    Ok(UpdateSettings {
        auto_check: cfg.update.auto_check,
        check_interval: cfg.update.check_interval,
        skipped_version: cfg.update.skipped_version,
    })
}

#[tauri::command]
pub fn set_update_settings(
    state: State<AppState>,
    auto_check: bool,
    check_interval: i64,
) -> AppResult<()> {
    let conn = state.db_pool.get()?;
    config_repo::set_value(&conn, "update_autoCheck", &auto_check.to_string())?;
    config_repo::set_value(&conn, "update_checkInterval", &check_interval.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn skip_version(state: State<AppState>, version: String) -> AppResult<()> {
    let conn = state.db_pool.get()?;
    config_repo::set_value(&conn, "update_skippedVersion", &version)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn begin_update_rejects_reentry_and_releases_on_drop() {
        let busy = AtomicBool::new(false);
        {
            let _g = begin_update(&busy).expect("first acquire");
            match begin_update(&busy) {
                Err(e) => assert!(e.to_string().contains(UPDATE_IN_PROGRESS)),
                Ok(_) => panic!("reentry should fail"),
            }
        }
        begin_update(&busy).expect("acquire after drop");
    }

    fn package(version: &str) -> tauri::PackageInfo {
        tauri::PackageInfo {
            name: "ccmesh".into(),
            version: version.parse().unwrap(),
            authors: "",
            description: "",
            crate_name: "ccmesh",
        }
    }

    #[test]
    fn version_jump_requires_current_ack_and_matching_notes() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .unwrap();
        let first = package("1.0.0-rc.9");
        let current = package("1.0.0-rc.10");
        assert!(check_version_jump_in_db(&mut conn, &first)
            .unwrap()
            .is_none());
        assert!(check_version_jump_in_db(&mut conn, &first)
            .unwrap()
            .is_none());

        // Missing, corrupt and unrelated notes must not suppress a real upgrade.
        for raw in [
            None,
            Some("not json"),
            Some(r#"{"version":"2.0.0","notes":"future"}"#),
        ] {
            if let Some(raw) = raw {
                config_repo::set_value(&conn, PENDING_NOTES_KEY, raw).unwrap();
            }
            let jump = check_version_jump_in_db(&mut conn, &current)
                .unwrap()
                .unwrap();
            assert_eq!(jump.previous_version, "1.0.0-rc.9");
            assert_eq!(jump.current_version, "1.0.0-rc.10");
            assert_eq!(jump.notes, "");
        }

        config_repo::set_value(
            &conn,
            PENDING_NOTES_KEY,
            r#"{"version":"1.0.0-rc.10","notes":"installed release"}"#,
        )
        .unwrap();
        for _ in 0..2 {
            assert_eq!(
                check_version_jump_in_db(&mut conn, &current)
                    .unwrap()
                    .unwrap()
                    .notes,
                "installed release"
            );
        }
        assert!(acknowledge_version_jump_in_db(&mut conn, &current, "1.0.0-rc.9").is_err());
        assert_eq!(
            check_version_jump_in_db(&mut conn, &current)
                .unwrap()
                .unwrap()
                .notes,
            "installed release"
        );
        acknowledge_version_jump_in_db(&mut conn, &current, "1.0.0-rc.10").unwrap();
        assert!(check_version_jump_in_db(&mut conn, &current)
            .unwrap()
            .is_none());
        assert!(config_repo::get_value(&conn, PENDING_NOTES_KEY)
            .unwrap()
            .is_none());

        // A future downloaded release survives acknowledgment and a downgrade.
        config_repo::set_value(
            &conn,
            PENDING_NOTES_KEY,
            r#"{"version":"2.0.0","notes":"future release"}"#,
        )
        .unwrap();
        acknowledge_version_jump_in_db(&mut conn, &current, "1.0.0-rc.10").unwrap();
        assert!(check_version_jump_in_db(&mut conn, &first)
            .unwrap()
            .is_none());
        let future = package("2.0.0");
        let jump = check_version_jump_in_db(&mut conn, &future)
            .unwrap()
            .unwrap();
        assert_eq!(jump.previous_version, "1.0.0-rc.9");
        assert_eq!(jump.notes, "future release");
        acknowledge_version_jump_in_db(&mut conn, &future, "2.0.0").unwrap();
        assert!(config_repo::get_value(&conn, PENDING_NOTES_KEY)
            .unwrap()
            .is_none());
    }

    #[test]
    fn bundled_notes_select_exact_release_not_unreleased_or_neighbor() {
        let changelog = "## [未发布]\nnext\n## [1.0.10] - 2026-01-01\nwrong\n## [1.0.1]\n### 修复\nright\n## [1.0.0]\nold\n";
        assert_eq!(bundled_release_notes(changelog, "1.0.1"), "### 修复\nright");
        assert_eq!(bundled_release_notes(changelog, "1.0.0"), "old");
        assert_eq!(bundled_release_notes(changelog, "1.0.2"), "");
    }
}
