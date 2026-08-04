use serde::{Deserialize, Serialize};

/// 单条模型映射：入站模型名 `from` → 出站（上游真实）模型名 `to`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMapping {
    pub from: String,
    pub to: String,
}

/// 端点（上游 API 提供方）。对应 `endpoints` 表。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub id: i64,
    pub name: String,
    pub api_url: String,
    pub api_key: String,
    /// 认证模式：api_key（默认）/ auth_token 等。
    pub auth_mode: String,
    pub enabled: bool,
    /// 是否经全局代理出网（代理地址见 AppConfig.proxy_url）。
    pub use_proxy: bool,
    /// 转换器名：claude / openai。
    pub transformer: String,
    /// 可选锁定模型：非空则强制覆盖客户端请求的 model（专用型端点）；空则透传。
    pub model: String,
    /// 对外暴露/已选的模型清单（聚合型端点，供 /v1/models 公布与 UI 展示）。
    pub models: Vec<String>,
    /// 点亮（对外公布）的模型子集：`models` 的子集。空数组表示全部公布（向后兼容旧端点）；
    /// 非空时仅这些模型对外公布与可路由，其余视为保留不公布。
    pub active_models: Vec<String>,
    /// 入站→出站模型映射。客户端用入站名请求 → 路由匹配 + 改写为出站名转发上游。
    pub model_mappings: Vec<ModelMapping>,
    /// 是否启用模型映射。关闭时保留 `model_mappings` 配置，但不公布入站别名、不改写出站。
    pub model_mappings_enabled: bool,
    pub remark: String,
    pub sort_order: i64,
    /// 是否属于快速队列。仅启用端点可为 true；禁用端点保存时会被清除。
    pub fast: bool,
    /// 快速队列内独立排序，不影响全局 sort_order。
    pub fast_sort_order: i64,
    /// 测试状态：unknown / available / unavailable。
    pub test_status: String,
    pub created_at: String,
    pub updated_at: String,
    /// 是否已归档。归档端点从主列表隐藏，可还原或删除。
    pub archived: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEndpointRequest {
    pub name: String,
    pub api_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_auth_mode")]
    pub auth_mode: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub use_proxy: bool,
    #[serde(default = "default_transformer")]
    pub transformer: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub active_models: Vec<String>,
    #[serde(default)]
    pub model_mappings: Vec<ModelMapping>,
    #[serde(default = "default_true")]
    pub model_mappings_enabled: bool,
    #[serde(default)]
    pub remark: String,
    #[serde(default)]
    pub fast: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEndpointRequest {
    pub name: Option<String>,
    pub api_url: Option<String>,
    pub api_key: Option<String>,
    pub auth_mode: Option<String>,
    pub enabled: Option<bool>,
    pub use_proxy: Option<bool>,
    pub transformer: Option<String>,
    pub model: Option<String>,
    pub models: Option<Vec<String>>,
    pub active_models: Option<Vec<String>>,
    pub model_mappings: Option<Vec<ModelMapping>>,
    pub model_mappings_enabled: Option<bool>,
    pub remark: Option<String>,
    pub fast: Option<bool>,
}

fn default_true() -> bool {
    true
}
fn default_auth_mode() -> String {
    "api_key".to_string()
}
fn default_transformer() -> String {
    "claude".to_string()
}
