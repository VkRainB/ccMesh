import { request } from "../request";

export interface UpdateSettings {
  autoCheck: boolean;
  checkInterval: number;
  skippedVersion: string;
  lastCheckTime: string;
}

export interface WebDavConfig {
  url: string;
  username: string;
  password: string;
  configPath: string;
  statsPath: string;
}

export interface AppConfig {
  port: number;
  logLevel: string;
  language: string;
  theme: string;
  themeAuto: boolean;
  autoLightStart: string;
  autoDarkStart: string;
  closeWindowBehavior: string;
  modelsCacheTtl: number;
  proxyUrl: string;
  openaiUa: string;
  claudeCliUa: string;
  update: UpdateSettings;
  webdav: WebDavConfig;
}

export const configApi = {
  getConfig: () => request<AppConfig>("get_config"),
  /** 部分更新：键为扁平配置键（如 port / theme / webdav_url / update_autoCheck），值为字符串。 */
  setConfig: (patch: Record<string, string>) =>
    request<AppConfig>("set_config", { patch }),
};
