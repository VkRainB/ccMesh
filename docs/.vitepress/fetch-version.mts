export const LATEST_JSON_URL =
  'https://github.com/VkRainB/ccMesh/releases/latest/download/latest.json'

export async function fetchReleaseVersion(fallback = 'v0.1.7'): Promise<string> {
  try {
    const res = await fetch(LATEST_JSON_URL)
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { version?: string }
    if (data.version) return `v${data.version}`
  } catch {
    // 构建或客户端拉取失败时使用 fallback
  }
  return fallback
}
