export const LATEST_API_URL =
  'https://api.github.com/repos/VkRainB/ccMesh/releases/latest'

export const LATEST_JSON_URL =
  'https://github.com/VkRainB/ccMesh/releases/latest/download/latest.json'

export const RELEASES_LATEST_URL = 'https://github.com/VkRainB/ccMesh/releases/latest'

export type PlatformKey = 'windows' | 'macos' | 'linux'

export type ReleaseDownloads = {
  version: string
  tagUrl: string
  urls: Record<PlatformKey, string>
}

type NamedUrl = { name: string; url: string }

const INSTALLER: Record<PlatformKey, RegExp[]> = {
  windows: [/setup\.exe$/i, /\.msi$/i],
  macos: [/\.dmg$/i],
  linux: [/\.AppImage$/i, /\.deb$/i]
}

const JSON_KEYS: Record<PlatformKey, string[]> = {
  windows: ['windows-x86_64', 'windows-aarch64'],
  macos: ['darwin-universal', 'darwin-aarch64', 'darwin-x86_64'],
  linux: ['linux-x86_64', 'linux-aarch64']
}

/** 与 CI 产物文件名一致：ccMesh_{ver}_x64-setup.exe / universal.dmg / amd64.AppImage */
export function assetUrlsFromTag(tag: string): Record<PlatformKey, string> {
  const ver = tag.replace(/^v/i, '')
  const slug = tag.startsWith('v') ? tag : `v${ver}`
  const base = `https://github.com/VkRainB/ccMesh/releases/download/${slug}`
  return {
    windows: `${base}/ccMesh_${ver}_x64-setup.exe`,
    macos: `${base}/ccMesh_${ver}_universal.dmg`,
    linux: `${base}/ccMesh_${ver}_amd64.AppImage`
  }
}

export function pickNamedUrl(items: NamedUrl[], patterns: RegExp[]): string | undefined {
  const usable = items.filter((a) => a.name && !a.name.endsWith('.sig') && a.name !== 'latest.json')
  for (const re of patterns) {
    const hit = usable.find((a) => re.test(a.name))
    if (hit) return hit.url
  }
}

function installerFromJsonUrl(url: string | undefined, patterns: RegExp[]): string | undefined {
  if (!url) return
  const name = url.split('/').pop() ?? url
  return pickNamedUrl([{ name, url }], patterns)
}

export async function fetchReleaseDownloads(fallback = 'v0.2.5'): Promise<ReleaseDownloads> {
  const empty: ReleaseDownloads = {
    version: fallback,
    tagUrl: `https://github.com/VkRainB/ccMesh/releases/tag/${fallback}`,
    urls: assetUrlsFromTag(fallback)
  }
  try {
    const res = await fetch(LATEST_API_URL, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as {
      tag_name?: string
      html_url?: string
      assets?: { name?: string; browser_download_url?: string }[]
    }
    const assets: NamedUrl[] = (data.assets ?? [])
      .filter((a): a is { name: string; browser_download_url: string } => !!a.name && !!a.browser_download_url)
      .map((a) => ({ name: a.name, url: a.browser_download_url }))

    let jsonPlatforms: Record<string, { url?: string }> = {}
    const jsonUrl =
      assets.find((a) => a.name === 'latest.json')?.url ?? LATEST_JSON_URL
    try {
      const jr = await fetch(jsonUrl)
      if (jr.ok) {
        const j = (await jr.json()) as { platforms?: Record<string, { url?: string }> }
        jsonPlatforms = j.platforms ?? {}
      }
    } catch {
      // latest.json 可能被 CORS 拦住，下面用 Release assets
    }

    const version = data.tag_name ?? fallback
    const guessed = assetUrlsFromTag(version)
    const urls: Record<PlatformKey, string> = { ...guessed }
    for (const os of Object.keys(INSTALLER) as PlatformKey[]) {
      const fromJson = JSON_KEYS[os]
        .map((k) => installerFromJsonUrl(jsonPlatforms[k]?.url, INSTALLER[os]))
        .find(Boolean)
      urls[os] = fromJson ?? pickNamedUrl(assets, INSTALLER[os]) ?? guessed[os]
    }

    return {
      version,
      tagUrl: data.html_url ?? `https://github.com/VkRainB/ccMesh/releases/tag/${version}`,
      urls
    }
  } catch {
    return empty
  }
}

export async function fetchReleaseVersion(fallback = 'v0.2.5'): Promise<string> {
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
