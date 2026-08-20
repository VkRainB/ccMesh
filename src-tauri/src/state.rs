use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, OnceLock};

use tauri::AppHandle;

use crate::modules::proxy::server::ProxyHandle;
use crate::modules::stats::aggregator::StatsAggregator;
use crate::modules::storage::db::DbPool;

/// 模型列表缓存（30 分钟 TTL)
#[derive(Default)]
pub struct ModelsCache {
    pub models: Vec<serde_json::Value>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// 全局应用状态，经 `app.manage(AppState)` 注入，命令通过 `State<AppState>` 访问。
pub struct AppState {
    pub db_pool: DbPool,
    pub proxy: Mutex<Option<ProxyHandle>>,
    pub models_cache: Mutex<ModelsCache>,
    pub device_id: String,
    pub stats: Arc<StatsAggregator>,
    pub app_handle: OnceLock<AppHandle>,
    /// 防止 `install_update_and_restart` 重入：连点会并行下载同一份更新包。
    pub update_busy: AtomicBool,
}

impl AppState {
    pub fn new(db_pool: DbPool, device_id: String, stats: Arc<StatsAggregator>) -> Self {
        Self {
            db_pool,
            proxy: Mutex::new(None),
            models_cache: Mutex::new(ModelsCache::default()),
            device_id,
            stats,
            app_handle: OnceLock::new(),
            update_busy: AtomicBool::new(false),
        }
    }
}
