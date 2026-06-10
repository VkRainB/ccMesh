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
    /// 入站→出站模型映射。客户端用入站名请求 → 路由匹配 + 改写为出站名转发上游。
    pub model_mappings: Vec<ModelMapping>,
    pub remark: String,
    pub sort_order: i64,
    /// 测试状态：unknown / available / unavailable。
    pub test_status: String,
    pub created_at: String,
    pub updated_at: String,
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
    pub model_mappings: Vec<ModelMapping>,
    #[serde(default)]
    pub remark: String,
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
    pub model_mappings: Option<Vec<ModelMapping>>,
    pub remark: Option<String>,
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
