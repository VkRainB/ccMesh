use serde::{Deserialize, Serialize};

/// 精灵图帧布局（pet.json 可选 `frames` 字段）。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetFrames {
    /// 精灵图列数（每行最大帧数）。
    pub cols: u32,
    /// 精灵图行数（动作数）。
    #[serde(default = "default_one")]
    pub rows: u32,
    /// 播放帧率（帧/秒）。
    #[serde(default = "default_fps")]
    pub fps: u32,
    /// 每行实际帧数；缺省或不足时按 `cols` 计。
    #[serde(default)]
    pub counts: Vec<u32>,
}

impl PetFrames {
    /// Codex 精灵表默认布局：1536×1872 / 8×9 / 单帧 192×208。
    /// 标准 pet.json 常省略 `frames`，与 Desk-cat / Codex Pet 契约一致。
    pub fn codex_default() -> Self {
        Self {
            cols: 8,
            rows: 9,
            fps: 8,
            counts: vec![6, 8, 8, 4, 5, 8, 6, 6, 6],
        }
    }
}

fn default_one() -> u32 {
    1
}

fn default_fps() -> u32 {
    8
}

/// 磁盘 `pet.json` 清单。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetManifest {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    /// 相对宠物目录的精灵图路径。
    #[serde(default = "default_spritesheet_path")]
    pub spritesheet_path: String,
    /// 可选来源标签，如 "Codex"；前端以橙色 pill 展示。
    #[serde(default)]
    pub tag: Option<String>,
    /// 精灵图帧布局；缺省时加载阶段填入 Codex 默认 8×9。
    #[serde(default)]
    pub frames: Option<PetFrames>,
}

fn default_spritesheet_path() -> String {
    "spritesheet.webp".into()
}

/// 列表 API 返回项（spritesheet 已解析为绝对路径）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetListItem {
    /// 子目录名，文件系统主键。
    pub dir_id: String,
    pub id: String,
    pub display_name: String,
    pub description: String,
    /// spritesheet 绝对路径，供前端 `convertFileSrc`。
    pub spritesheet_path: String,
    /// 可选来源标签（来自 pet.json），缺省为 None。
    pub tag: Option<String>,
    /// 精灵图帧布局；pet.json 未写时为 Codex 默认。
    pub frames: Option<PetFrames>,
}
