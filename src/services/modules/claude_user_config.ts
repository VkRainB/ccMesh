import { request } from "../request";

export interface ClaudeUserFlags {
  skipOnboarding: boolean;
}

export const CLAUDE_USER_FLAGS_KEY = ["claude-user-flags"] as const;

export const claudeUserConfigApi = {
  getFlags: () => request<ClaudeUserFlags>("get_claude_user_flags"),
  setFlags: (patch: Partial<ClaudeUserFlags>) =>
    request<ClaudeUserFlags>("set_claude_user_flags", { patch }),
};
