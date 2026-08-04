//! 宠物资产命令。

use tauri::AppHandle;

use crate::error::AppResult;
use crate::models::pet::PetListItem;
use crate::modules::pet;

#[tauri::command]
pub fn list_pets(app: AppHandle) -> AppResult<Vec<PetListItem>> {
    pet::list_pets(&app)
}

#[tauri::command]
pub fn import_pet(app: AppHandle, path: String) -> AppResult<PetListItem> {
    pet::import_pet(&app, &path)
}

#[tauri::command]
pub fn get_active_pet(app: AppHandle) -> AppResult<Option<String>> {
    pet::get_active_pet(&app)
}

#[tauri::command]
pub fn set_active_pet(app: AppHandle, dir_id: String) -> AppResult<()> {
    pet::set_active_pet(&app, &dir_id)
}

#[tauri::command]
pub fn delete_pet(app: AppHandle, dir_id: String) -> AppResult<()> {
    pet::delete_pet(&app, &dir_id)
}
