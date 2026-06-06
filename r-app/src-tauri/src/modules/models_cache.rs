use serde_json::{json, Value};

use crate::models::endpoint::Endpoint;
use crate::modules::transform::transformer::UpstreamFormat;

fn default_model(ep: &Endpoint) -> &str {
    if ep.model.is_empty() {
        "claude-3-5-sonnet-latest"
    } else {
        ep.model.as_str()
    }
}

pub fn model_info(id: &str, endpoint_name: &str) -> Value {
    json!({
        "id": id,
        "object": "model",
        "created": 1_735_689_600,
        "owned_by": endpoint_name,
        "endpoint_id": endpoint_name
    })
}

/// 拉取指定上游的模型 id 列表：OpenAI 走 `Bearer`，Claude/Anthropic 走 `x-api-key + anthropic-version`；
/// 两者上游 `/v1/models` 响应均为 `data[].id`。失败返回空。按字段传参，供未保存端点的表单刷新调用。
pub async fn fetch_model_ids(
    client: &reqwest::Client,
    api_url: &str,
    api_key: &str,
    transformer: &str,
) -> Vec<String> {
    let base = api_url.trim_end_matches('/');
    let url = format!("{base}/v1/models");
    let req = match UpstreamFormat::from_transformer_name(transformer) {
        UpstreamFormat::OpenAiChat => client
            .get(&url)
            .header("authorization", format!("Bearer {api_key}")),
        UpstreamFormat::Claude => client
            .get(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01"),
    };
    if let Ok(resp) = req.send().await {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<Value>().await {
                if let Some(data) = v.get("data").and_then(|d| d.as_array()) {
                    return data
                        .iter()
                        .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(String::from))
                        .collect();
                }
            }
        }
    }
    Vec::new()
}

/// 拉取单个端点的模型列表（OpenAI 走 `/v1/models`；Claude 或失败回落默认模型）。
pub async fn fetch_models(client: &reqwest::Client, ep: &Endpoint) -> Vec<Value> {
    let ids = fetch_model_ids(client, &ep.api_url, &ep.api_key, &ep.transformer).await;
    if ids.is_empty() {
        vec![model_info(default_model(ep), &ep.name)]
    } else {
        ids.iter().map(|id| model_info(id, &ep.name)).collect()
    }
}
