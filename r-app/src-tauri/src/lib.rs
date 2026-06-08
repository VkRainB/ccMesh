mod commands;
mod error;
mod models;
mod modules;
mod state;
mod utils;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 控制台 fmt 层（RUST_LOG 可覆盖）+ 捕获层（动态级别 + log-line 事件推送）
    use tracing_subscriber::prelude::*;
    let console_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(console_filter))
        .with(modules::logs::CaptureLayer)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // 数据目录 → 连接池 → 幂等迁移
            let db_file = utils::paths::db_path(&handle)?;
            let pool = modules::storage::db::create_pool(&db_file)?;
            {
                let conn = pool.get()?;
                modules::storage::migration::run_migrations(&conn)?;
            }

            // 日志级别（从配置恢复）+ 实时推送接线
            {
                let conn = pool.get()?;
                if let Ok(Some(level)) = modules::storage::config_repo::get_value(&conn, "logLevel") {
                    modules::logs::set_level(&level);
                }
            }
            modules::logs::set_app_handle(handle.clone());

            // 设备唯一 ID
            let device_id = {
                let conn = pool.get()?;
                modules::storage::device::get_or_create_device_id(&conn)?
            };
            tracing::info!(%device_id, "存储与设备标识初始化完成");

            // 统计聚合器（内存累加 + 2s 防抖落库 + 零延迟事件）
            let stats = modules::stats::aggregator::StatsAggregator::new(
                pool.clone(),
                handle.clone(),
                device_id.clone(),
            );

            // 注入全局状态，保存 AppHandle 供事件推送
            let app_state = state::AppState::new(pool, device_id, stats);
            let _ = app_state.app_handle.set(handle);
            app.manage(app_state);

            // 系统托盘
            if let Err(e) = modules::tray::build_tray(app.handle()) {
                tracing::warn!("托盘构建失败: {e}");
            }

            // 窗口关闭行为（quit 退出 / minimize 隐藏托盘 / ask 前端询问）
            if let Some(window) = app.get_webview_window("main") {
                let close_handle = window.app_handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let behavior = {
                            let state = close_handle.state::<state::AppState>();
                            state
                                .db_pool
                                .get()
                                .ok()
                                .and_then(|c| {
                                    modules::storage::config_repo::get_value(&c, "closeWindowBehavior")
                                        .ok()
                                        .flatten()
                                })
                                .unwrap_or_else(|| "ask".to_string())
                        };
                        match behavior.as_str() {
                            "quit" => close_handle.exit(0),
                            "minimize" => {
                                api.prevent_close();
                                if let Some(w) = close_handle.get_webview_window("main") {
                                    let _ = w.hide();
                                }
                            }
                            _ => {
                                api.prevent_close();
                                let _ = close_handle.emit("close-requested", ());
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health::get_health,
            commands::health::get_endpoint_health,
            commands::proxy::start_proxy,
            commands::proxy::stop_proxy,
            commands::proxy::get_proxy_status,
            commands::proxy::switch_endpoint,
            commands::stats::get_stats,
            commands::stats::get_request_logs,
            commands::stats::get_stats_history,
            commands::stats::delete_daily_stat,
            commands::stats::delete_stats_by_date,
            commands::usage::sync_session_usage,
            commands::usage::get_usage_summary,
            commands::usage::get_usage_by_model,
            commands::usage::get_usage_by_day,
            commands::usage::get_usage_by_day_model,
            commands::backup::export_config,
            commands::backup::import_config,
            commands::config::get_config,
            commands::config::get_all_config,
            commands::config::set_config,
            commands::endpoint::list_endpoints,
            commands::endpoint::create_endpoint,
            commands::endpoint::update_endpoint,
            commands::endpoint::delete_endpoint,
            commands::endpoint::reorder_endpoints,
            commands::endpoint::clone_endpoint,
            commands::endpoint::test_endpoint,
            commands::models::get_models,
            commands::models::fetch_endpoint_models,
            commands::tokens::count_tokens,
            commands::logs::get_recent_logs,
            commands::logs::set_log_level,
            commands::webdav::test_webdav,
            commands::webdav::webdav_backup,
            commands::webdav::webdav_restore,
            commands::webdav::webdav_list_backups,
            commands::webdav::webdav_delete_backup,
            commands::window::set_language,
            commands::window::apply_close_action,
            commands::window::hide_to_tray,
            commands::update::check_for_updates,
            commands::update::download_and_install,
            commands::update::get_update_settings,
            commands::update::set_update_settings,
            commands::update::skip_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
