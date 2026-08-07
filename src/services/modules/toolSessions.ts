import { request } from "../request";

export interface ToolSessionMeta {
  providerId: string;
  sessionId: string;
  title?: string;
  summary?: string;
  projectDir?: string | null;
  createdAt?: number;
  lastActiveAt?: number;
  sourcePath?: string;
  resumeCommand?: string;
}

export interface ToolSessionMessage {
  role: string;
  content: string;
  ts?: number;
}

export interface DeleteToolSessionRequest {
  providerId: string;
  sessionId: string;
  sourcePath: string;
}

export interface DeleteToolSessionOutcome extends DeleteToolSessionRequest {
  success: boolean;
  error?: string;
}

export const toolSessionsApi = {
  list: () => request<ToolSessionMeta[]>("list_tool_sessions"),
  getMessages: (providerId: string, sourcePath: string) =>
    request<ToolSessionMessage[]>("get_tool_session_messages", {
      providerId,
      sourcePath,
    }),
  delete: (req: DeleteToolSessionRequest) =>
    request<boolean>("delete_tool_session", {
      providerId: req.providerId,
      sessionId: req.sessionId,
      sourcePath: req.sourcePath,
    }),
  deleteMany: (items: DeleteToolSessionRequest[]) =>
    request<DeleteToolSessionOutcome[]>("delete_tool_sessions", { items }),
};
