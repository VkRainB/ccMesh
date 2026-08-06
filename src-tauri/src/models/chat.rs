use serde::{Deserialize, Serialize};

/// 对话会话。对应 `chat_topics`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTopic {
    pub id: String,
    pub title: String,
    pub endpoint_id: i64,
    pub model: String,
    pub active_node_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatTopicRequest {
    #[serde(default)]
    pub title: String,
    pub endpoint_id: i64,
    pub model: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChatTopicRequest {
    pub title: Option<String>,
    pub endpoint_id: Option<i64>,
    pub model: Option<String>,
}

/// 对话消息。对应 `chat_messages`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub topic_id: String,
    pub parent_id: Option<String>,
    pub role: String,
    pub content: String,
    /// pending | streaming | success | error
    pub status: String,
    pub compaction_summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 活跃路径上的消息，附带兄弟分支信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchMessage {
    #[serde(flatten)]
    pub message: ChatMessage,
    pub sibling_index: i64,
    pub sibling_count: i64,
    /// 同父节点下兄弟 id（按创建时间），便于前端切分支。
    pub sibling_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendResponse {
    pub user_message_id: String,
    pub assistant_message_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatChunkPayload {
    pub topic_id: String,
    pub message_id: String,
    pub delta: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDonePayload {
    pub topic_id: String,
    pub message_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatErrorPayload {
    pub topic_id: String,
    pub message_id: String,
    pub error: String,
}
