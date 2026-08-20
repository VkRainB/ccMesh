//! 宠物资产：扫描 / 导入 `<app_data_dir>/pets/<dir>/`。

use std::fs;
use std::io::{copy, Read};
use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tracing::warn;
use uuid::Uuid;
use zip::ZipArchive;

use crate::error::{AppError, AppResult};
use crate::models::pet::{PetFrames, PetListItem, PetManifest};
use crate::utils::paths;

const MANIFEST_FILE: &str = "pet.json";
const ACTIVE_FILE: &str = ".active";

/// 列出已安装宠物（按 displayName 忽略大小写排序；坏目录静默跳过）。
pub fn list_pets(app: &AppHandle) -> AppResult<Vec<PetListItem>> {
    let root = paths::pets_dir(app)?;
    Ok(scan_pets_dir(&root))
}

/// 当前激活宠物的目录名；未设置或目录已失效时返回 `None`。
pub fn get_active_pet(app: &AppHandle) -> AppResult<Option<String>> {
    let root = paths::pets_dir(app)?;
    let path = root.join(ACTIVE_FILE);
    if !path.is_file() {
        return Ok(None);
    }
    let id = fs::read_to_string(&path)?.trim().to_string();
    if id.is_empty() || !is_valid_dir_id(&id) || !root.join(&id).is_dir() {
        return Ok(None);
    }
    Ok(Some(id))
}

/// 设置激活宠物（须已存在于 `pets/`）。
pub fn set_active_pet(app: &AppHandle, dir_id: &str) -> AppResult<()> {
    if !is_valid_dir_id(dir_id) {
        return Err(AppError::InvalidArgument(format!(
            "非法宠物目录名: {dir_id}"
        )));
    }
    let root = paths::pets_dir(app)?;
    if !root.join(dir_id).is_dir() {
        return Err(AppError::NotFound(format!("宠物不存在: {dir_id}")));
    }
    fs::write(root.join(ACTIVE_FILE), dir_id)?;
    Ok(())
}

/// 删除已安装宠物目录；若正是当前激活则清除 `.active`。
pub fn delete_pet(app: &AppHandle, dir_id: &str) -> AppResult<()> {
    let root = paths::pets_dir(app)?;
    delete_pet_in_root(&root, dir_id)
}

fn delete_pet_in_root(root: &Path, dir_id: &str) -> AppResult<()> {
    if !is_valid_dir_id(dir_id) {
        return Err(AppError::InvalidArgument(format!(
            "非法宠物目录名: {dir_id}"
        )));
    }
    let dest = root.join(dir_id);
    if !dest.is_dir() {
        return Err(AppError::NotFound(format!("宠物不存在: {dir_id}")));
    }
    fs::remove_dir_all(&dest)?;

    let active_path = root.join(ACTIVE_FILE);
    if active_path.is_file() {
        let active = fs::read_to_string(&active_path).unwrap_or_default();
        if active.trim() == dir_id {
            let _ = fs::remove_file(&active_path);
        }
    }
    Ok(())
}

/// 从文件夹或 `.zip` 导入宠物到用户 `pets/` 目录。
pub fn import_pet(app: &AppHandle, source: &str) -> AppResult<PetListItem> {
    let src = PathBuf::from(source);
    if !src.exists() {
        return Err(AppError::NotFound(format!("路径不存在: {source}")));
    }
    let pets_root = paths::pets_dir(app)?;
    if src.is_dir() {
        import_package_dir(&src, &pets_root, None, None)
    } else if is_zip_path(&src) {
        import_from_zip(&src, &pets_root)
    } else {
        Err(AppError::InvalidArgument(
            "请选择宠物文件夹或 .zip 压缩包".into(),
        ))
    }
}

fn is_zip_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
}

fn is_valid_dir_id(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':'])
}

fn scan_pets_dir(root: &Path) -> Vec<PetListItem> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(dir_id) = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        if !is_valid_dir_id(&dir_id) {
            continue;
        }
        match load_pet_item(&path, &dir_id) {
            Some(item) => out.push(item),
            None => warn!(dir = %dir_id, "跳过无效宠物目录"),
        }
    }
    out.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    out
}

fn load_pet_item(dir: &Path, dir_id: &str) -> Option<PetListItem> {
    let manifest_path = dir.join(MANIFEST_FILE);
    let text = fs::read_to_string(&manifest_path).ok()?;
    let manifest: PetManifest = serde_json::from_str(&text).ok()?;
    if manifest.id.trim().is_empty() || manifest.display_name.trim().is_empty() {
        return None;
    }
    let sheet = resolve_spritesheet(dir, &manifest.spritesheet_path)?;
    Some(PetListItem {
        dir_id: dir_id.to_string(),
        id: manifest.id,
        display_name: manifest.display_name,
        description: manifest.description,
        spritesheet_path: sheet.to_string_lossy().into_owned(),
        tag: manifest.tag,
        // 标准 Codex pet.json 常省略 frames；缺省用 8×9 契约布局。
        frames: Some(manifest.frames.unwrap_or_else(PetFrames::codex_default)),
    })
}

fn resolve_spritesheet(dir: &Path, relative: &str) -> Option<PathBuf> {
    let rel = relative.trim();
    if rel.is_empty() {
        return None;
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() || rel.contains(':') {
        return None;
    }
    if rel.split(['/', '\\']).any(|p| p == "..") {
        return None;
    }
    let sheet = dir.join(rel_path);
    if !sheet.is_file() {
        return None;
    }
    // canonicalize 后确认仍在宠物目录内（防 symlink / Windows 盘符相对路径）。
    let Ok(canon_dir) = fs::canonicalize(dir) else {
        return Some(sheet);
    };
    let Ok(canon_sheet) = fs::canonicalize(&sheet) else {
        return None;
    };
    if canon_sheet.starts_with(&canon_dir) {
        Some(sheet)
    } else {
        None
    }
}

/// 定位含 `pet.json` 的包根：自身或唯一一层子目录。
fn find_package_dir(root: &Path) -> AppResult<PathBuf> {
    if root.join(MANIFEST_FILE).is_file() {
        return Ok(root.to_path_buf());
    }
    let mut candidates = Vec::new();
    let entries = fs::read_dir(root)
        .map_err(|e| AppError::InvalidArgument(format!("无法读取宠物包目录: {e}")))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join(MANIFEST_FILE).is_file() {
            candidates.push(path);
        }
    }
    match candidates.len() {
        1 => Ok(candidates.remove(0)),
        0 => Err(AppError::InvalidArgument(
            "未找到 pet.json，请选择合法的宠物包".into(),
        )),
        _ => Err(AppError::InvalidArgument(
            "压缩包内含多个宠物目录，请解压后单独导入".into(),
        )),
    }
}

fn dir_id_for_package(
    package_dir: &Path,
    extract_root: Option<&Path>,
    fallback: &str,
) -> AppResult<String> {
    let name = if extract_root.is_some_and(|r| r == package_dir) {
        fallback.to_string()
    } else {
        package_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(fallback)
            .to_string()
    };
    let name = name.trim();
    if !is_valid_dir_id(name) {
        return Err(AppError::InvalidArgument(format!("非法宠物目录名: {name}")));
    }
    Ok(name.to_string())
}

fn import_package_dir(
    src: &Path,
    pets_root: &Path,
    extract_root: Option<&Path>,
    preferred_dir_id: Option<&str>,
) -> AppResult<PetListItem> {
    let package_dir = find_package_dir(src)?;
    let fallback = preferred_dir_id
        .or_else(|| src.file_name().and_then(|n| n.to_str()))
        .unwrap_or("pet");
    let dir_id = dir_id_for_package(&package_dir, extract_root, fallback)?;
    load_pet_item(&package_dir, &dir_id).ok_or_else(|| {
        AppError::InvalidArgument("宠物包不完整：需要有效的 pet.json 与精灵图".into())
    })?;

    let dest = pets_root.join(&dir_id);
    // ponytail: 先复制到临时目录并校验，再原子替换；避免复制失败时原宠物被清空无法恢复。
    let tmp_dest = pets_root.join(format!(".{dir_id}.tmp-{}", Uuid::new_v4()));
    let result = (|| {
        copy_dir_recursive(&package_dir, &tmp_dest)?;
        load_pet_item(&tmp_dest, &dir_id)
            .ok_or_else(|| AppError::Unknown("导入后校验失败".into()))?;
        let backup = if dest.exists() {
            let bak = pets_root.join(format!(".{dir_id}.bak-{}", Uuid::new_v4()));
            fs::rename(&dest, &bak)?;
            Some(bak)
        } else {
            None
        };
        if let Err(e) = fs::rename(&tmp_dest, &dest) {
            if let Some(bak) = backup.as_ref() {
                let _ = fs::rename(bak, &dest);
            }
            return Err(e.into());
        }
        if let Some(bak) = backup {
            let _ = fs::remove_dir_all(&bak);
        }
        load_pet_item(&dest, &dir_id).ok_or_else(|| AppError::Unknown("导入后校验失败".into()))
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&tmp_dest);
    }
    result
}

fn import_from_zip(zip_path: &Path, pets_root: &Path) -> AppResult<PetListItem> {
    let stem = zip_path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("pet");
    let tmp = std::env::temp_dir().join(format!("ccmesh-pet-import-{}", Uuid::new_v4()));
    fs::create_dir_all(&tmp)?;
    let result = (|| {
        extract_zip(zip_path, &tmp)?;
        import_package_dir(&tmp, pets_root, Some(&tmp), Some(stem))
    })();
    let _ = fs::remove_dir_all(&tmp);
    result
}

const ZIP_MAX_ENTRIES: usize = 10_000;
const ZIP_MAX_TOTAL_UNCOMPRESSED: u64 = 1024 * 1024 * 1024; // 1 GiB
const ZIP_MAX_ENTRY_UNCOMPRESSED: u64 = 256 * 1024 * 1024; // 256 MiB

fn extract_zip(zip_path: &Path, dest: &Path) -> AppResult<()> {
    let file = fs::File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| AppError::InvalidArgument(format!("无法打开 zip: {e}")))?;
    if archive.len() > ZIP_MAX_ENTRIES {
        return Err(AppError::InvalidArgument(format!(
            "压缩包条目过多（{}），上限 {}",
            archive.len(),
            ZIP_MAX_ENTRIES
        )));
    }
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| AppError::InvalidArgument(format!("读取 zip 条目失败: {e}")))?;
        let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue; // zip slip
        };
        let out = dest.join(&rel);
        if entry.name().ends_with('/') {
            fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut outfile = fs::File::create(&out)?;
        // ponytail: 用 take(cap+1) 限制实际解压字节数，防止恶意 zip 在 header 谎报小尺寸而实际解压巨大（zip bomb）。
        let mut limited = entry.take(ZIP_MAX_ENTRY_UNCOMPRESSED + 1);
        let n = copy(&mut limited, &mut outfile)?;
        if n > ZIP_MAX_ENTRY_UNCOMPRESSED {
            let _ = fs::remove_file(&out);
            return Err(AppError::InvalidArgument(format!(
                "压缩包内条目过大（解压 {} 字节），单条上限 {} 字节",
                n, ZIP_MAX_ENTRY_UNCOMPRESSED
            )));
        }
        total = total
            .checked_add(n)
            .ok_or_else(|| AppError::InvalidArgument("压缩包解压总大小超限".into()))?;
        if total > ZIP_MAX_TOTAL_UNCOMPRESSED {
            let _ = fs::remove_file(&out);
            return Err(AppError::InvalidArgument(format!(
                "压缩包解压总大小超限（{} 字节），上限 {} 字节",
                total, ZIP_MAX_TOTAL_UNCOMPRESSED
            )));
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> AppResult<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ccmesh-pet-{label}-{ns}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_pet(dir: &Path, id: &str, name: &str, sheet: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join(MANIFEST_FILE),
            format!(
                r#"{{"id":"{id}","displayName":"{name}","description":"d","spritesheetPath":"{sheet}"}}"#
            ),
        )
        .unwrap();
        fs::write(dir.join(sheet), b"fake").unwrap();
    }

    #[test]
    fn scan_pets_dir_loads_valid_and_skips_bad() {
        let root = temp_root("scan");
        write_pet(&root.join("熊猫"), "panda", "Panda", "spritesheet.webp");
        write_pet(&root.join("恐龙"), "dino", "Dino", "spritesheet.webp");
        fs::create_dir_all(root.join("坏包")).unwrap();
        fs::write(
            root.join("坏包").join(MANIFEST_FILE),
            r#"{"id":"x","displayName":"X","spritesheetPath":"missing.webp"}"#,
        )
        .unwrap();

        let list = scan_pets_dir(&root);
        let _ = fs::remove_dir_all(&root);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].display_name, "Dino");
        assert_eq!(list[0].dir_id, "恐龙");
        assert_eq!(list[1].dir_id, "熊猫");
    }

    #[test]
    fn resolve_spritesheet_rejects_escape() {
        let root = temp_root("escape");
        assert!(resolve_spritesheet(&root, "../x.webp").is_none());
        assert!(resolve_spritesheet(&root, "/abs.webp").is_none());
        assert!(resolve_spritesheet(&root, "C:../x.webp").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn import_package_dir_copies_into_pets_root() {
        let workspace = temp_root("import-src");
        let pets_root = temp_root("import-dst");
        let src = workspace.join("月薪喵");
        write_pet(&src, "cat", "月薪喵", "spritesheet.webp");

        let item = import_package_dir(&src, &pets_root, None, None).unwrap();
        assert_eq!(item.dir_id, "月薪喵");
        assert_eq!(item.display_name, "月薪喵");
        assert!(pets_root.join("月薪喵").join(MANIFEST_FILE).is_file());

        let _ = fs::remove_dir_all(&workspace);
        let _ = fs::remove_dir_all(&pets_root);
    }

    #[test]
    fn import_package_dir_overwrites_existing() {
        // 覆盖导入：同 dir_id 二次导入应原子替换，旧内容清空、新内容生效，无残留 .tmp/.bak。
        let workspace = temp_root("overwrite-src");
        let pets_root = temp_root("overwrite-dst");
        let dir_id = "熊猫";
        let src_v1 = workspace.join("v1").join(dir_id);
        write_pet(&src_v1, "panda", "PandaV1", "spritesheet.webp");
        let src_v2 = workspace.join("v2").join(dir_id);
        write_pet(&src_v2, "panda", "PandaV2", "spritesheet.webp");

        import_package_dir(&src_v1, &pets_root, None, None).unwrap();
        fs::write(pets_root.join(dir_id).join("legacy.txt"), b"old").unwrap();
        let item = import_package_dir(&src_v2, &pets_root, None, None).unwrap();

        assert_eq!(item.display_name, "PandaV2");
        assert!(pets_root.join(dir_id).join(MANIFEST_FILE).is_file());
        assert!(
            !pets_root.join(dir_id).join("legacy.txt").exists(),
            "旧文件应被清除"
        );
        let leftovers: Vec<_> = fs::read_dir(&pets_root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("."))
            .collect();
        assert!(leftovers.is_empty(), "不应残留临时/备份目录: {leftovers:?}");

        let _ = fs::remove_dir_all(&workspace);
        let _ = fs::remove_dir_all(&pets_root);
    }

    #[test]
    fn import_from_zip_with_nested_folder() {
        let workspace = temp_root("zip");
        let pets_root = temp_root("zip-dst");
        let nested = workspace.join("pack").join("熊猫");
        write_pet(&nested, "panda", "Panda", "spritesheet.webp");

        let zip_path = workspace.join("panda.zip");
        {
            let file = fs::File::create(&zip_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let opts = zip::write::SimpleFileOptions::default();
            zip.add_directory("熊猫/", opts).unwrap();
            zip.start_file("熊猫/pet.json", opts).unwrap();
            zip.write_all(
                br#"{"id":"panda","displayName":"Panda","description":"d","spritesheetPath":"spritesheet.webp"}"#,
            )
            .unwrap();
            zip.start_file("熊猫/spritesheet.webp", opts).unwrap();
            zip.write_all(b"fake").unwrap();
            zip.finish().unwrap();
        }

        let item = import_from_zip(&zip_path, &pets_root).unwrap();
        assert_eq!(item.dir_id, "熊猫");
        assert!(pets_root.join("熊猫").join(MANIFEST_FILE).is_file());

        let _ = fs::remove_dir_all(&workspace);
        let _ = fs::remove_dir_all(&pets_root);
    }

    #[test]
    fn load_pet_item_accepts_minimal_codex_manifest() {
        // 与官方 Codex 素材一致：无 tag/frames，displayName 可为 \uXXXX。
        let root = temp_root("codex-minimal");
        let dir = root.join("yingyu-aima.codex-pet");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(MANIFEST_FILE),
            r#"{
  "id": "yingyu-aima",
  "displayName": "\u6a31\u7fbd\u827e\u739b",
  "description": "A compact Codex digital pet.",
  "spritesheetPath": "spritesheet.webp"
}"#,
        )
        .unwrap();
        fs::write(dir.join("spritesheet.webp"), b"fake").unwrap();

        let item = load_pet_item(&dir, "yingyu-aima.codex-pet").unwrap();
        assert_eq!(item.display_name, "樱羽艾玛");
        assert!(item.tag.is_none());
        let frames = item.frames.expect("frames filled from Codex default");
        assert_eq!(frames.cols, 8);
        assert_eq!(frames.rows, 9);
        assert_eq!(frames.counts, vec![6, 8, 8, 4, 5, 8, 6, 6, 6]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_pet_in_root_removes_dir() {
        let root = temp_root("del");
        write_pet(&root.join("熊猫"), "panda", "Panda", "spritesheet.webp");
        delete_pet_in_root(&root, "熊猫").unwrap();
        assert!(!root.join("熊猫").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_pet_in_root_clears_active() {
        let root = temp_root("del-active");
        write_pet(&root.join("熊猫"), "panda", "Panda", "spritesheet.webp");
        fs::write(root.join(ACTIVE_FILE), "熊猫").unwrap();
        delete_pet_in_root(&root, "熊猫").unwrap();
        assert!(!root.join(ACTIVE_FILE).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_pet_in_root_rejects_bad_id() {
        let root = temp_root("del-bad");
        let err = delete_pet_in_root(&root, "../x").unwrap_err();
        assert!(matches!(err, AppError::InvalidArgument(_)));
        let err = delete_pet_in_root(&root, "不存在").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
        let _ = fs::remove_dir_all(&root);
    }
}
