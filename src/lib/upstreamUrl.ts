/** 与后端 `utils/upstream_url.rs` 同一套拼接：`#` 或路径 `/vN` 时跳过自动 `/v1`。 */
const VERSION_IN_PATH = /\/v\d+(?:alpha|beta)?(?:\/|$)/i;

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    const afterScheme = url.includes("://") ? url.slice(url.indexOf("://") + 3) : url;
    const hostAndPath = afterScheme.split(/[?#]/, 1)[0] ?? afterScheme;
    const slash = hostAndPath.indexOf("/");
    return slash < 0 ? "" : hostAndPath.slice(slash);
  }
}

export function joinUpstreamUrl(apiUrl: string, apiPath: string): string {
  let s = apiUrl.trim();
  const skipVersion = s.endsWith("#");
  if (skipVersion) s = s.slice(0, -1);
  s = s.replace(/\/+$/, "");
  const path =
    (skipVersion || VERSION_IN_PATH.test(pathnameOf(s))) && apiPath.startsWith("/v1/")
      ? apiPath.slice(3)
      : apiPath;
  return `${s}${path}`;
}
