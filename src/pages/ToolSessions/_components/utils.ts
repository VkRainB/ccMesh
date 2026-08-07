import type { ReactNode } from "react";
import { createElement } from "react";

import type { ToolSessionMeta } from "@/services/modules/toolSessions";

const CODEX_IDE_CONTEXT_PREFIX = "# Context from my IDE setup:";
const CODEX_REQUEST_MARKER = "my request for codex";
export const UNKNOWN_PROJECT_DIR_KEY = "__unknown_project_dir__";

export interface SessionDirectoryGroup {
  key: string;
  projectDir: string | null;
  label: string;
  sessions: ToolSessionMeta[];
}

export interface SessionProviderGroup {
  providerId: string;
  sessions: ToolSessionMeta[];
  directories: SessionDirectoryGroup[];
}

export const getSessionKey = (session: ToolSessionMeta) =>
  `${session.providerId}:${session.sessionId}:${session.sourcePath ?? ""}`;

export const getSessionDirectoryGroupKey = (
  providerId: string,
  projectDir?: string | null,
) => {
  const trimmed = projectDir?.trim();
  return `${providerId}:${trimmed || UNKNOWN_PROJECT_DIR_KEY}`;
};

export const getBaseName = (value?: string | null) => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || trimmed;
};

export const formatTimestamp = (value?: number) => {
  if (!value) return "";
  return new Date(value).toLocaleString();
};

export const formatRelativeTime = (value?: number) => {
  if (!value) return "未知";
  const now = Date.now();
  const diff = now - value;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return new Date(value).toLocaleDateString();
};

export const getProviderLabel = (providerId: string) => {
  if (providerId === "claude") return "Claude";
  if (providerId === "codex") return "Codex";
  return providerId;
};

export const getRoleTone = (role: string) => {
  const normalized = role.toLowerCase();
  if (normalized === "assistant") return "text-blue-500";
  if (normalized === "user") return "text-emerald-500";
  if (normalized === "system") return "text-amber-500";
  if (normalized === "tool") return "text-purple-500";
  return "text-muted-foreground";
};

export const getRoleLabel = (role: string) => {
  const normalized = role.toLowerCase();
  if (normalized === "assistant") return "AI";
  if (normalized === "user") return "用户";
  if (normalized === "system") return "系统";
  if (normalized === "tool") return "工具";
  return role;
};

export const formatSessionTitle = (session: ToolSessionMeta) =>
  session.title ||
  getBaseName(session.projectDir) ||
  session.sessionId.slice(0, 8);

export const groupSessionsByProviderAndDirectory = (
  sessions: ToolSessionMeta[],
  unknownDirectoryLabel: string,
): SessionProviderGroup[] => {
  const providerGroups: SessionProviderGroup[] = [];
  const providerGroupMap = new Map<string, SessionProviderGroup>();
  const directoryGroupMaps = new Map<
    string,
    Map<string, SessionDirectoryGroup>
  >();

  sessions.forEach((session) => {
    let providerGroup = providerGroupMap.get(session.providerId);
    if (!providerGroup) {
      providerGroup = {
        providerId: session.providerId,
        sessions: [],
        directories: [],
      };
      providerGroupMap.set(session.providerId, providerGroup);
      providerGroups.push(providerGroup);
      directoryGroupMaps.set(session.providerId, new Map());
    }

    providerGroup.sessions.push(session);

    const trimmedProjectDir = session.projectDir?.trim() || null;
    const directoryKey = getSessionDirectoryGroupKey(
      session.providerId,
      trimmedProjectDir,
    );
    const directoryGroups = directoryGroupMaps.get(session.providerId)!;

    let directoryGroup = directoryGroups.get(directoryKey);
    if (!directoryGroup) {
      directoryGroup = {
        key: directoryKey,
        projectDir: trimmedProjectDir,
        label: trimmedProjectDir
          ? getBaseName(trimmedProjectDir) || trimmedProjectDir
          : unknownDirectoryLabel,
        sessions: [],
      };
      directoryGroups.set(directoryKey, directoryGroup);
      providerGroup.directories.push(directoryGroup);
    }

    directoryGroup.sessions.push(session);
  });

  return providerGroups;
};

export const shouldHideCodexMessageFromToc = (content: string) => {
  const trimmed = content.trim();
  return (
    trimmed.startsWith("# AGENTS.md instructions for ") ||
    trimmed.startsWith("<environment_context>") ||
    (trimmed.startsWith(CODEX_IDE_CONTEXT_PREFIX) &&
      !extractCodexPromptFromIdeContext(trimmed))
  );
};

const getCodexRequestHeadingPayload = (lineText: string) => {
  if (!lineText.startsWith("#")) return null;
  const heading = lineText.replace(/^#+\s*/, "");
  const suffix = heading.toLowerCase().startsWith(CODEX_REQUEST_MARKER)
    ? heading.slice(CODEX_REQUEST_MARKER.length).trimStart()
    : null;
  if (suffix === null) return null;
  if (!suffix) return "";
  if (!/^[:：\-—]/.test(suffix)) return null;
  return suffix.replace(/^[:：\-—\s]+/, "").trim();
};

const extractCodexPromptFromIdeContext = (content: string) => {
  const trimmed = content.trim();
  if (!trimmed.startsWith(CODEX_IDE_CONTEXT_PREFIX)) return null;
  const lines = trimmed.replace(/\r\n/g, "\n").split("\n");
  let prompt: string | null = null;
  for (const [index, line] of lines.entries()) {
    const inlinePrompt = getCodexRequestHeadingPayload(line.trim());
    if (inlinePrompt === null) continue;
    if (inlinePrompt) {
      prompt = inlinePrompt;
      continue;
    }
    const followingPrompt = lines
      .slice(index + 1)
      .join("\n")
      .trim();
    prompt = followingPrompt || null;
  }
  return prompt;
};

export const extractCodexPromptPreview = (content: string) =>
  extractCodexPromptFromIdeContext(content) ?? content;

export const formatSessionMessagePreview = (content: string, maxLength = 50) =>
  content.slice(0, maxLength) + (content.length > maxLength ? "..." : "");

export const highlightText = (text: string, query: string): ReactNode => {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1
      ? createElement(
          "mark",
          {
            key: i,
            className:
              "rounded-sm bg-yellow-200/60 px-0.5 text-inherit dark:bg-yellow-500/30",
          },
          part,
        )
      : part,
  );
};

export const matchesSessionSearch = (
  session: ToolSessionMeta,
  query: string,
) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    session.sessionId,
    session.title,
    session.summary,
    session.projectDir,
    session.sourcePath,
    session.resumeCommand,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
};
