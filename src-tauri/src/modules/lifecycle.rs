use tauri::AppHandle;

#[cfg(not(target_os = "windows"))]
use tauri::Manager;

const TRAY_ID: &str = "main-tray";

/// 通过 `set_visible(false)` 移除托盘图标；macOS 走主线程代理，跨线程安全。
pub fn remove_tray_icon_before_exit(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(e) = tray.set_visible(false) {
            tracing::warn!("退出时移除托盘图标失败: {e}");
        } else {
            tracing::info!("已显式从系统托盘移除图标");
        }
    }
}

/// 主动释放 single-instance 锁，避免重启后新进程误连旧 listener。
pub fn destroy_single_instance_lock(app: &AppHandle) {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    tauri_plugin_single_instance::destroy(app);
}

/// 移除托盘并释放单实例锁（Windows install 前、或配合 restart 使用）。
pub fn prepare_for_process_exit(app: &AppHandle) {
    remove_tray_icon_before_exit(app);
    destroy_single_instance_lock(app);
}

/// 清理托盘与单实例锁后重启进程，不经过 `request_restart` 事件循环。
///
/// macOS 不能直接用 `tauri::process::restart`：它从将死的进程里 spawn bundle 内的可执行
/// 文件，新实例继承旧进程的 stdio 与进程组，且绕过 LaunchServices —— Gatekeeper 视其为
/// "被另一个 App 打开的 App"，未签名 bundle 会在这条路径上被静默拦下，表现为更新装完就
/// 退出、不重启（tauri-apps/tauri#15742）。改交给 LaunchServices 拉起，由 launchd 给新
/// 实例干净的 stdio 与会话；拿不到 bundle 路径（如 `cargo run` 的裸二进制）时按原路走。
#[cfg(not(target_os = "windows"))]
pub fn restart_process(app: &AppHandle) -> ! {
    prepare_for_process_exit(app);

    #[cfg(target_os = "macos")]
    {
        if let Ok(exe) = tauri::process::current_binary(&app.env()) {
            if let Some(bundle) = macos_bundle_path(&exe) {
                // ponytail: 不透传原始命令行参数（`open` 需 `--args`）；本应用不读 argv。
                match std::process::Command::new("/usr/bin/open")
                    .arg("-n")
                    .arg(&bundle)
                    .status()
                {
                    Ok(s) if s.success() => std::process::exit(0),
                    Ok(s) => {
                        tracing::error!("open -n {} 失败({s})，回退直接重启", bundle.display())
                    }
                    Err(e) => tracing::error!("调用 open 失败: {e}，回退直接重启"),
                }
            }
        }
    }

    tauri::process::restart(&app.env());
}

/// `/Applications/Foo.app/Contents/MacOS/foo` → `/Applications/Foo.app`，不在 bundle 内返回 None。
#[cfg(any(target_os = "macos", test))]
fn macos_bundle_path(exe: &std::path::Path) -> Option<std::path::PathBuf> {
    let bundle = exe.ancestors().nth(3)?;
    (bundle.extension()? == "app").then(|| bundle.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::macos_bundle_path;
    use std::path::{Path, PathBuf};

    #[test]
    fn bundle_path_resolves_only_inside_dot_app() {
        assert_eq!(
            macos_bundle_path(Path::new("/Applications/ccMesh.app/Contents/MacOS/ccMesh")),
            Some(PathBuf::from("/Applications/ccMesh.app"))
        );
        // 裸二进制（cargo run / Linux 布局）没有 bundle，必须回退到 process::restart
        assert_eq!(macos_bundle_path(Path::new("/usr/local/bin/ccmesh")), None);
        assert_eq!(
            macos_bundle_path(Path::new("/home/me/target/release/ccmesh")),
            None
        );
    }
}
