use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::pricing::ModelPriceQuote;
use crate::modules::{pricing, storage::endpoint_repo};
use crate::state::AppState;

#[tauri::command]
pub fn get_endpoint_model_prices(
    state: State<AppState>,
    endpoint_id: i64,
    model_ids: Option<Vec<String>>,
    at: Option<i64>,
) -> AppResult<Vec<ModelPriceQuote>> {
    let conn = state.db_pool.get()?;
    let endpoint = endpoint_repo::get_by_id(&conn, endpoint_id)?
        .ok_or_else(|| AppError::NotFound(format!("端点 #{endpoint_id} 不存在")))?;
    pricing::quote_models(&endpoint, model_ids, at.unwrap_or_else(|| chrono::Utc::now().timestamp_millis()))
}
