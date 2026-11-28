import { translate } from '../../../../i18n/index.js'
import { createId } from '../../../../utils/id.js'
import type { FileAttachment, Session } from '../../types.js'
import { record, safeId, toMs, toSession, type Loose, type Round } from './common.js'

const PROMPT_PREFIX = /^prompted\s+/i

/** 会话列表标题只做展示截断；消息正文仍保留完整 prompt。 */
const displayTitle = (value: string): string => {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) {
    return 'Gemini 对话'
  }
  return compact.length > 80 ? `${compact.slice(0, 80)}…` : compact
}

const htmlToText = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|h[1-6]|li|ul|ol|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const MISSING_HTML = /<(?:p|li)[^>]*>\s*[.…⋯·•-]?\s*<\/(?:p|li)>/i
const MISSING_HTML_GLOBAL = /<(p|li)([^>]*)>\s*[.…⋯·•-]?\s*<\/\1>/gi

const activityHtml = (item: Loose): string => {
  const htmlItems = Array.isArray(item.safeHtmlItem) ? item.safeHtmlItem : []
  return htmlItems
    .map((entry) => {
      const html = record(entry)?.html
      return typeof html === 'string' ? html : ''
    })
    .filter(Boolean)
    .join('\n')
}

const activityText = (html: string): string =>
  htmlToText(
    html.replace(
      MISSING_HTML_GLOBAL,
      (_match, tag: string, attrs: string) =>
        `<${tag}${attrs}>${translate('geminiMissingPlaceholder')}</${tag}>`
    )
  )

const activityAttachments = (item: Loose): FileAttachment[] => {
  const names: string[] = []
  if (typeof item.imageFile === 'string' && item.imageFile.trim()) {
    names.push(item.imageFile.trim())
  }
  if (Array.isArray(item.attachedFiles)) {
    for (const name of item.attachedFiles) {
      if (typeof name === 'string' && name.trim()) {
        names.push(name.trim())
      }
    }
  }
  return [...new Set(names)].map((name) => ({
    id: name,
    name,
    size: 0,
    sizeKnown: false,
    isImage: /\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(name),
    mimeType: '',
  }))
}

const conversationKey = (item: Loose): string => {
  const details = Array.isArray(item.details) ? item.details : []
  const url = details.map(record).find((detail) => typeof detail?.url === 'string')?.url
  return typeof url === 'string' ? url : ''
}

const conversationId = (url: string): string => {
  const last = url.split('/').filter(Boolean).at(-1)
  return last ? safeId(last) : createId()
}

/**
 * Gemini Takeout 的 My Activity 是活动日志，不是完整会话导出：
 * 同一会话 URL 的记录会聚合成一个 Session，数组顺序通常是倒序。
 * 用户提示只能取 activity title，可能被 Google 截断。
 */
export const fromGemini = (parsed: Loose[], groupId: string): Session[] => {
  const groups = new Map<string, Loose[]>()
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const key = conversationKey(item) || `activity-${createId()}`
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }

  const sessions: Session[] = []
  for (const [url, items] of groups) {
    items.sort((a, b) => toMs(a.time, 0) - toMs(b.time, 0))
    const rounds: Round[] = []
    for (const item of items) {
      const rawTitle =
        typeof item.title === 'string' ? item.title.replace(PROMPT_PREFIX, '').trim() : ''
      const question = rawTitle || ''
      const html = activityHtml(item)
      const answer = activityText(html)
      const answerNotice = MISSING_HTML.test(html) ? translate('geminiMissingContent') : undefined
      if (!question && !answer && !answerNotice) {
        continue
      }
      rounds.push({
        question,
        answer,
        at: toMs(item.time, Date.now()),
        files: activityAttachments(item),
        ...(answerNotice ? { answerNotice } : {}),
      })
    }
    if (rounds.length === 0) {
      continue
    }
    const first = items[0]
    const title = displayTitle(rounds.find((round) => round.question)?.question || '')
    const createdAt = toMs(first.time, Date.now())
    const updatedAt = toMs(items.at(-1)?.time, createdAt)
    const session = toSession(
      'gemini',
      groupId,
      conversationId(url),
      title,
      createdAt,
      updatedAt,
      rounds
    )
    if (session) {
      sessions.push(session)
    }
  }
  return sessions
}
