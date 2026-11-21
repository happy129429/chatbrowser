import { getVisibleMessages } from './branches.js'
import * as db from './db.js'
import type { Session, SessionSummary } from './types.js'

/**
 * 全局文本搜索：标题 + 提问 + 回答正文。
 * 归一化（NFKC + 小写 + 空白折叠）后子串匹配；子串无命中时降级为子序列模糊匹配。
 * 逐会话扫描，命中数达到上限即提前结束；映射表保证摘录与高亮对回原文。
 */

export type SearchHit = {
  sessionId: string
  messageId: string
  /** 命中消息的角色，用于区分提问与回答 */
  role: 'user' | 'assistant'
  /** 命中所在的原文片段，命中词以 \x00 标记边界供界面高亮 */
  snippet: string
}

export type SearchProgress = { hits: SearchHit[]; scanned: number; total: number }

const MAX_HITS = 300

/** 摘录窗口：命中词前后各取的字符数 */
const SNIPPET_CONTEXT = 48
const MARK = '\x00'

/**
 * 归一化并保留映射：normalized[i] 对应原文 map[i]。
 * NFKC 统一全半角、lowercase 统一大小写、连续空白折叠为单个空格。
 */
const normalizeMapped = (text: string) => {
  let normalized = ''
  const map: number[] = []
  for (let index = 0; index < text.length; index++) {
    const mapped = text[index].normalize('NFKC').toLowerCase()
    for (const char of mapped) {
      if (/\s/.test(char)) {
        if (normalized === '' || normalized.endsWith(' ')) {
          continue
        }
        normalized += ' '
        map.push(index)
        continue
      }
      normalized += char
      map.push(index)
    }
  }
  return { normalized, map }
}

/** 依次出现即可命中（在归一化文本上比较），返回首尾字符的归一化位置。 */
const subsequenceRange = (
  needle: string,
  haystack: string
): { start: number; end: number } | null => {
  let first = -1
  let start = 0
  for (const char of needle) {
    const index = haystack.indexOf(char, start)
    if (index === -1) {
      return null
    }
    if (first === -1) {
      first = index
    }
    start = index + 1
  }
  return { start: first, end: start }
}

/** 归一化位置换算回原文位置。 */
const toOriginalIndex = (map: number[], normalizedIndex: number, fallback: number) =>
  normalizedIndex >= 0 && normalizedIndex < map.length ? map[normalizedIndex] : fallback

/** 会话的搜索域：当前分支上每条消息的可读文本 */
const searchableTexts = (
  session: Session
): { messageId: string; role: 'user' | 'assistant'; text: string }[] => {
  const texts: { messageId: string; role: 'user' | 'assistant'; text: string }[] = []
  for (const message of getVisibleMessages(session)) {
    if (message.role === 'user') {
      if (message.content.trim()) {
        texts.push({ messageId: message.id, role: 'user', text: message.content })
      }
      continue
    }
    // 模板提示（过载、拦截等）与思考过程不进入搜索域。
    const text = message.blocks
      .map((block) => (block.type === 'text' && !block.isTemplate ? block.text : ''))
      .join('')
      .replace(/\[citation:\d+\]/g, '')
    if (text.trim()) {
      texts.push({ messageId: message.id, role: 'assistant', text })
    }
  }
  return texts
}

/** 在单个文本中匹配关键词组（全部命中才算），返回带高亮标记的摘录。 */
const matchText = (text: string, terms: string[]): string | null => {
  const { normalized, map } = normalizeMapped(text)
  let matched: { start: number; end: number } | null = null
  let fuzzy: { start: number; end: number } | null = null
  for (const term of terms) {
    const index = normalized.indexOf(term)
    if (index !== -1) {
      // 取第一个子串命中的词作为摘录锚点。
      if (!matched) {
        const start = toOriginalIndex(map, index, 0)
        const end = toOriginalIndex(map, index + term.length, text.length)
        matched = { start, end }
      }
    } else {
      const range = subsequenceRange(term, normalized)
      if (!range) {
        // 有一个词连子序列都不匹配，整条文本不命中。
        return null
      }
      if (!fuzzy) {
        fuzzy = range
      }
    }
  }
  // 子串命中的摘录以命中词为中心，加粗标记；仅模糊命中时锚定到匹配区间，不高亮。
  const anchor =
    matched ??
    (fuzzy
      ? {
          start: toOriginalIndex(map, fuzzy.start, 0),
          end: toOriginalIndex(map, fuzzy.end, text.length),
        }
      : null)
  if (!anchor) {
    return null
  }
  const start = Math.max(0, anchor.start - SNIPPET_CONTEXT)
  const end = Math.min(text.length, anchor.end + SNIPPET_CONTEXT)
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) {
    snippet = `…${snippet}`
  }
  if (end < text.length) {
    snippet = `${snippet}…`
  }
  if (!matched) {
    // 模糊命中无法连续高亮，摘录只保证覆盖匹配位置。
    return snippet
  }
  // 折叠空白会移动位置，标记前重新对齐：把 \x00 插在两端，再裁掉错位部分。
  const prefix = snippet.startsWith('…') ? 1 : 0
  const suffix = snippet.endsWith('…') ? 1 : 0
  const body = snippet.slice(prefix, snippet.length - suffix)
  const shrink = (originalIndex: number) => {
    let visible = 0
    for (let index = start; index < originalIndex && index < end; index++) {
      if (!/\s/.test(text[index]) || (visible > 0 && body[visible - 1] !== ' ')) {
        visible += 1
      }
    }
    return visible
  }
  const markStart = shrink(matched.start)
  const markEnd = shrink(matched.end)
  const left = `${prefix ? '…' : ''}${body.slice(0, markStart)}`
  const middle = body.slice(markStart, markEnd)
  const right = `${body.slice(markEnd)}${suffix ? '…' : ''}`
  return `${left}${MARK}${middle}${MARK}${right}`
}

export type SearchOptions = {
  signal: AbortSignal
  onProgress?: (progress: SearchProgress) => void
}

/**
 * 扫描全部会话；signal 中止或命中达上限时提前结束。
 * onProgress 在扫描过程中回调，界面可以增量展示。
 */
export const searchSessions = async (
  summaries: SessionSummary[],
  query: string,
  options: SearchOptions
): Promise<void> => {
  const terms = normalizeMapped(query)
    .normalized.split(' ')
    .filter((term) => term !== '')
  if (terms.length === 0) {
    return
  }
  const hits: SearchHit[] = []
  let scanned = 0
  const report = () => options.onProgress?.({ hits, scanned, total: summaries.length })
  report()
  for (const summary of summaries) {
    if (options.signal.aborted || hits.length >= MAX_HITS) {
      break
    }
    scanned += 1
    try {
      const session = await db.loadSession(summary.id)
      if (!session || options.signal.aborted) {
        continue
      }
      const texts = searchableTexts(session)
      const pushed = new Set<string>()
      // 标题参与匹配：标题命中但没有消息命中时，摘录展示第一条消息的开头作为入口（不高亮）。
      const titleHit = terms.every((term) => {
        const { normalized } = normalizeMapped(session.title)
        return normalized.includes(term) || subsequenceRange(term, normalized) !== null
      })
      if (titleHit && texts.length > 0) {
        const first = texts[0]
        pushed.add(first.messageId)
        const head = first.text
          .slice(0, SNIPPET_CONTEXT * 2)
          .replace(/\s+/g, ' ')
          .trim()
        hits.push({
          sessionId: session.id,
          messageId: first.messageId,
          role: first.role,
          snippet: head,
        })
      }
      for (const { messageId, role, text } of texts) {
        if (hits.length >= MAX_HITS) {
          break
        }
        const snippet = matchText(text, terms)
        if (snippet !== null && !pushed.has(messageId)) {
          pushed.add(messageId)
          hits.push({ sessionId: session.id, messageId, role, snippet })
        }
      }
    } catch (error) {
      db.reportStorageError('search session')(error)
    }
    if (scanned % 10 === 0) {
      report()
    }
  }
  report()
}
