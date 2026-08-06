use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::chat::{
    BranchMessage, ChatSendResponse, ChatTopic, CreateChatTopicRequest, UpdateChatTopicRequest,
};
use crate::modules::chat;
use crate::modules::storage::chat_repo;
use crate::state::AppState;

#[tauri::command]
pub fn list_chat_topics(state: State<'_, AppState>) -> AppResult<Vec<ChatTopic>> {
    let conn = state.db_pool.get()?;
    chat_repo::list_topics(&conn)
}

#[tauri::command]
pub fn create_chat_topic(
    state: State<'_, AppState>,
    req: CreateChatTopicRequest,
) -> AppResult<ChatTopic> {
    let id = Uuid::new_v4().to_string();
    let conn = state.db_pool.get()?;
    chat_repo::create_topic(&conn, &id, &req)
}

#[tauri::command]
pub fn update_chat_topic(
    state: State<'_, AppState>,
    id: String,
    req: UpdateChatTopicRequest,
) -> AppResult<ChatTopic> {
    let conn = state.db_pool.get()?;
    chat_repo::update_topic(&conn, &id, &req)
}

#[tauri::command]
pub fn delete_chat_topic(state: State<'_, AppState>, id: String) -> AppResult<()> {
    chat::abort(&id);
    let conn = state.db_pool.get()?;
    chat_repo::delete_topic(&conn, &id)
}

#[tauri::command]
pub fn list_chat_messages(
    state: State<'_, AppState>,
    topic_id: String,
) -> AppResult<Vec<BranchMessage>> {
    let conn = state.db_pool.get()?;
    chat_repo::list_branch_messages(&conn, &topic_id)
}

#[tauri::command]
pub fn set_chat_active_node(
    state: State<'_, AppState>,
    topic_id: String,
    node_id: String,
) -> AppResult<ChatTopic> {
    let conn = state.db_pool.get()?;
    chat_repo::set_active_node(&conn, &topic_id, &node_id)
}

fn spawn_stream(
    app: AppHandle,
    db: crate::modules::storage::db::DbPool,
    topic_id: String,
    assistant_id: String,
    endpoint_id: i64,
    model: String,
) {
    tauri::async_runtime::spawn(async move {
        chat::run_stream(app, db, topic_id, assistant_id, endpoint_id, model).await;
    });
}

#[tauri::command]
pub fn chat_send(
    app: AppHandle,
    state: State<'_, AppState>,
    topic_id: String,
    content: String,
) -> AppResult<ChatSendResponse> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::InvalidArgument("消息不能为空".into()));
    }
    if !chat::try_begin(&topic_id) {
        return Err(AppError::InvalidArgument("该会话正在生成中，请稍候".into()));
    }

    let result = (|| -> AppResult<(i64, String, String, String)> {
        let conn = state.db_pool.get()?;
        chat_repo::ensure_topic_tree(&conn, &topic_id)?;
        let topic = chat_repo::require_topic(&conn, &topic_id)?;
        if topic.title == "新对话" {
            let title: String = content.chars().take(32).collect();
            let _ = chat_repo::update_topic(
                &conn,
                &topic_id,
                &UpdateChatTopicRequest {
                    title: Some(title),
                    ..Default::default()
                },
            );
        }
        let parent = topic
            .active_node_id
            .unwrap_or_else(|| chat_repo::root_id(&topic_id));
        let user_id = Uuid::new_v4().to_string();
        let assistant_id = Uuid::new_v4().to_string();
        chat_repo::insert_message(
            &conn,
            &user_id,
            &topic_id,
            Some(&parent),
            "user",
            &content,
            "success",
        )?;
        chat_repo::insert_message(
            &conn,
            &assistant_id,
            &topic_id,
            Some(&user_id),
            "assistant",
            "",
            "pending",
        )?;
        chat_repo::set_active_node(&conn, &topic_id, &assistant_id)?;
        Ok((topic.endpoint_id, topic.model, user_id, assistant_id))
    })();

    let (endpoint_id, model, user_id, assistant_id) = match result {
        Ok(v) => v,
        Err(e) => {
            chat::end(&topic_id);
            return Err(e);
        }
    };

    spawn_stream(
        app,
        state.db_pool.clone(),
        topic_id,
        assistant_id.clone(),
        endpoint_id,
        model,
    );

    Ok(ChatSendResponse {
        user_message_id: user_id,
        assistant_message_id: assistant_id,
    })
}

#[tauri::command]
pub fn chat_regenerate(
    app: AppHandle,
    state: State<'_, AppState>,
    topic_id: String,
    assistant_message_id: String,
) -> AppResult<ChatSendResponse> {
    if !chat::try_begin(&topic_id) {
        return Err(AppError::InvalidArgument("该会话正在生成中，请稍候".into()));
    }

    let result = (|| -> AppResult<(i64, String, String, String)> {
        let conn = state.db_pool.get()?;
        chat_repo::ensure_topic_tree(&conn, &topic_id)?;
        let topic = chat_repo::require_topic(&conn, &topic_id)?;
        let assistant = chat_repo::require_message(&conn, &assistant_message_id)?;
        if assistant.topic_id != topic_id || assistant.role != "assistant" {
            return Err(AppError::InvalidArgument("只能重生成助手消息".into()));
        }
        let user_id = assistant
            .parent_id
            .ok_or_else(|| AppError::InvalidArgument("助手消息缺少父节点".into()))?;
        let user = chat_repo::require_message(&conn, &user_id)?;
        if user.role != "user" {
            return Err(AppError::InvalidArgument("父节点不是用户消息".into()));
        }
        let new_assistant_id = Uuid::new_v4().to_string();
        chat_repo::insert_message(
            &conn,
            &new_assistant_id,
            &topic_id,
            Some(&user_id),
            "assistant",
            "",
            "pending",
        )?;
        chat_repo::set_active_node(&conn, &topic_id, &new_assistant_id)?;
        Ok((topic.endpoint_id, topic.model, user_id, new_assistant_id))
    })();

    let (endpoint_id, model, user_id, assistant_id) = match result {
        Ok(v) => v,
        Err(e) => {
            chat::end(&topic_id);
            return Err(e);
        }
    };

    spawn_stream(
        app,
        state.db_pool.clone(),
        topic_id,
        assistant_id.clone(),
        endpoint_id,
        model,
    );

    Ok(ChatSendResponse {
        user_message_id: user_id,
        assistant_message_id: assistant_id,
    })
}

#[tauri::command]
pub fn chat_abort(topic_id: String) -> AppResult<()> {
    chat::abort(&topic_id);
    Ok(())
}
