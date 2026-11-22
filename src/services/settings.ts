import { create } from 'zustand'

export type Locale = 'zh-CN' | 'en-US'

/** 语言偏好；默认跟随浏览器语言 */
export type LocalePreference = 'system' | Locale

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：语言、主题、侧边栏收起状态、自动检查更新 */
type Settings = {
  /** 语言偏好；locale 为其解析结果，翻译统一读取 locale */
  localePreference: LocalePreference
  locale: Locale
  themePreference: ThemePreference
  siderCollapsed: boolean
  /** 启动后是否自动请求 GitHub 检查更新；手动检查不受影响 */
  autoCheckUpdates: boolean
}

const KEYS = {
  locale: 'chat-demo:locale',
  themePreference: 'chat-demo:theme-preference',
  siderCollapsed: 'chat-demo:sider-collapsed',
  autoCheckUpdates: 'chat-demo:auto-check-updates',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 浏览器语言解析为界面语言；中文浏览器为简体中文，其余为英文。 */
const browserLocale = (): Locale =>
  (typeof navigator === 'undefined' ? 'en' : navigator.language).toLowerCase().startsWith('zh')
    ? 'zh-CN'
    : 'en-US'

const resolveLocale = (preference: LocalePreference): Locale =>
  preference === 'system' ? browserLocale() : preference

const initialLocalePreference = (): LocalePreference => {
  const saved = read(KEYS.locale)
  return saved === 'zh-CN' || saved === 'en-US' ? saved : 'system'
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

const initialPreference = initialLocalePreference()

export const useSettings = create<Settings>(() => ({
  localePreference: initialPreference,
  locale: resolveLocale(initialPreference),
  themePreference: initialThemePreference(),
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  autoCheckUpdates: read(KEYS.autoCheckUpdates) !== 'false',
}))

export const setLocalePreference = (preference: LocalePreference) => {
  write(KEYS.locale, preference)
  useSettings.setState({ localePreference: preference, locale: resolveLocale(preference) })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setAutoCheckUpdates = (autoCheckUpdates: boolean) => {
  write(KEYS.autoCheckUpdates, String(autoCheckUpdates))
  useSettings.setState({ autoCheckUpdates })
}
