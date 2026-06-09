use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::modules::storage::config_repo;
use crate::state::AppState;

struct Labels {
    show: &'static str,
    start: &'static str,
    stop: &'static str,
    quit: &'static str,
}

fn labels(lang: &str) -> Labels {
    if lang == "en" {
        Labels {
            show: "Show Window",
            start: "Start Proxy",
            stop: "Stop Proxy",
            quit: "Quit",
        }
    } else {
        Labels {
            show: "显示窗口",
            start: "启动代理",
            stop: "停止代理",
            quit: "退出",
        }
    }
}

fn current_lang<R: Runtime>(app: &AppHandle<R>) -> String {
    let state = app.state::<AppState>();
    state
        .db_pool
        .get()
        .ok()
        .and_then(|c| config_repo::get_value(&c, "language").ok().flatten())
        .unwrap_or_else(|| "zh".to_string())
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 构建系统托盘：图标 + 菜单（显示窗口 / 启停代理 / 退出），左键显示窗口。
/// 启停代理通过 `tray-action` 事件交前端调用命令；菜单文案随语言。
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let l = labels(&current_lang(app));
    let show = MenuItem::with_id(app, "show", l.show, true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start_proxy", l.start, true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop_proxy", l.stop, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", l.quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &start, &stop, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("ccMesh")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            "start_proxy" => {
                let _ = app.emit("tray-action", "start");
            }
            "stop_proxy" => {
                let _ = app.emit("tray-action", "stop");
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// 语言变更后重建托盘。
pub fn rebuild_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if app.tray_by_id("main-tray").is_some() {
        app.remove_tray_by_id("main-tray");
    }
    build_tray(app)
}
