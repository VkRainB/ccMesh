import type { UnlistenFn } from "@tauri-apps/api/event";

import { Events, request, subscribe } from "../request";

export type ChatMessageStatus = "pending" | "streaming" | "success" | "error";

export interface ChatTopic {
  id: string;
  title: string;
  endpointId: number;
  model: string;
  activeNodeId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BranchMessage {
  id: string;
  topicId: string;
  parentId: string | null;
  role: "user" | "assistant" | "system" | "root" | string;
  content: string;
  status: ChatMessageStatus | string;
  compactionSummary?: string | null;
  createdAt: string;
  updatedAt: string;
  siblingIndex: number;
  siblingCount: number;
  siblingIds: string[];
}

/** @deprecated 使用 BranchMessage */
export type ChatMessage = BranchMessage;

export interface CreateChatTopicRequest {
  title?: string;
  endpointId: number;
  model: string;
}

export interface UpdateChatTopicRequest {
  title?: string;
  endpointId?: number;
  model?: string;
}

export interface ChatSendResponse {
  userMessageId: string;
  assistantMessageId: string;
}

export interface ChatChunkPayload {
  topicId: string;
  messageId: string;
  delta: string;
}

export interface ChatDonePayload {
  topicId: string;
  messageId: string;
  content: string;
}

export interface ChatErrorPayload {
  topicId: string;
  messageId: string;
  error: string;
}

export const chatApi = {
  listTopics: () => request<ChatTopic[]>("list_chat_topics"),
  createTopic: (req: CreateChatTopicRequest) =>
    request<ChatTopic>("create_chat_topic", { req }),
  updateTopic: (id: string, req: UpdateChatTopicRequest) =>
    request<ChatTopic>("update_chat_topic", { id, req }),
  deleteTopic: (id: string) => request<void>("delete_chat_topic", { id }),
  listMessages: (topicId: string) =>
    request<BranchMessage[]>("list_chat_messages", { topicId }),
  setActiveNode: (topicId: string, nodeId: string) =>
    request<ChatTopic>("set_chat_active_node", { topicId, nodeId }),
  send: (topicId: string, content: string) =>
    request<ChatSendResponse>("chat_send", { topicId, content }),
  regenerate: (topicId: string, assistantMessageId: string) =>
    request<ChatSendResponse>("chat_regenerate", {
      topicId,
      assistantMessageId,
    }),
  abort: (topicId: string) => request<void>("chat_abort", { topicId }),
  onChunk: (cb: (p: ChatChunkPayload) => void): Promise<UnlistenFn> =>
    subscribe<ChatChunkPayload>(Events.chatChunk, (e) => cb(e.payload)),
  onDone: (cb: (p: ChatDonePayload) => void): Promise<UnlistenFn> =>
    subscribe<ChatDonePayload>(Events.chatDone, (e) => cb(e.payload)),
  onError: (cb: (p: ChatErrorPayload) => void): Promise<UnlistenFn> =>
    subscribe<ChatErrorPayload>(Events.chatError, (e) => cb(e.payload)),
};
