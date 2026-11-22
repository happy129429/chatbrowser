const REPO = 'happy129429/chatbrowser'
export const RELEASES_URL = `https://github.com/${REPO}/releases`
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const CACHE_KEY = 'chat-demo:update-check'
const DISMISS_KEY = 'chat-demo:update-dismissed'
const DAY = 24 * 60 * 60 * 1000
const TIMEOUT = 8000

export type UpdateResult = { latest: string; url: string; newer: boolean }

export type UpdateCheck =
  | ({ status: 'ok' } & UpdateResult)
  | { status: 'error'; reason: 'rate-limit' | 'network'; resetAt?: number }

type Cached = { at: number; latest: string; url: string }

const parseVersion = (value: string) =>
  value
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)

/** 简易 semver 比较：a 新于 b 时返回正数。 */
export const compareVersions = (a: string, b: string) => {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

const readCache = (): Cached | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<Cached>
    return typeof parsed.at === 'number' && typeof parsed.latest === 'string'
      ? {
          at: parsed.at,
          latest: parsed.latest,
          url: typeof parsed.url === 'string' ? parsed.url : RELEASES_URL,
        }
      : null
  } catch {
    return null
  }
}

const writeCache = (latest: string, url: string) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), latest, url }))
  } catch {
    // 存储不可用时忽略缓存
  }
}

/** 查询 GitHub 最新 Release；force=false 时 24 小时内复用缓存。 */
export const checkForUpdates = async (force = false): Promise<UpdateCheck> => {
  const cached = readCache()
  if (!force && cached && Date.now() - cached.at < DAY) {
    return {
      status: 'ok',
      latest: cached.latest,
      url: cached.url,
      newer: compareVersions(cached.latest, __APP_VERSION__) > 0,
    }
  }
  try {
    const response = await fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!response.ok) {
      const remaining = response.headers.get('x-ratelimit-remaining')
      const reset = Number(response.headers.get('x-ratelimit-reset'))
      if ((response.status === 403 || response.status === 429) && remaining === '0') {
        return {
          status: 'error',
          reason: 'rate-limit',
          resetAt: Number.isFinite(reset) ? reset * 1000 : undefined,
        }
      }
      return { status: 'error', reason: 'network' }
    }
    const data = (await response.json()) as { tag_name?: string; html_url?: string }
    const latest = (data.tag_name ?? '').replace(/^v/, '')
    if (!latest) {
      return { status: 'error', reason: 'network' }
    }
    const url = data.html_url ?? RELEASES_URL
    writeCache(latest, url)
    return { status: 'ok', latest, url, newer: compareVersions(latest, __APP_VERSION__) > 0 }
  } catch {
    return { status: 'error', reason: 'network' }
  }
}

export const dismissUpdate = (version: string) => {
  try {
    localStorage.setItem(DISMISS_KEY, version)
  } catch {
    // 忽略
  }
}

export const isUpdateDismissed = (version: string) => {
  try {
    return localStorage.getItem(DISMISS_KEY) === version
  } catch {
    return false
  }
}
