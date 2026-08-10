export const LATEST_API_URL =
  'https://api.github.com/repos/VkRainB/ccMesh/releases/latest'

export async function fetchReleaseVersion(fallback = 'v0.2.3'): Promise<string> {
  try {
    const res = await fetch(LATEST_API_URL, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { tag_name?: string }
    if (data.tag_name) return data.tag_name
  } catch {
    // 构建或客户端拉取失败时使用 fallback
  }
  return fallback
}
