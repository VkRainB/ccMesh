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
  silentStart: boolean;
  autoRun: boolean;
  modelsCacheTtl: number;
  proxyUrl: string;
  proxyEnabled: boolean;
  proxyForUpdate: boolean;
  openaiUa: string;
  claudeCliUa: string;
  circuitBreakerEnabled: boolean;
  circuitBreakerFailureThreshold: number;
  circuitBreakerTimeout: number;
  update: UpdateSettings;
  webdav: WebDavConfig;
}

export interface ProxyTestResult {
  success: boolean;
  status: string;
  latencyMs: number;
  message: string;
}

export const configApi = {
  getConfig: () => request<AppConfig>("get_config"),
  /** 部分更新：键为扁平配置键（如 port / theme / webdav_url / update_autoCheck），值为字符串。 */
  setConfig: (patch: Record<string, string>) =>
    request<AppConfig>("set_config", { patch }),
  /** 经给定代理地址做一次连通性检测。 */
  testProxy: (url: string) => request<ProxyTestResult>("test_proxy", { url }),
};
