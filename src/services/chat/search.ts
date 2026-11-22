import MiniSearch from 'minisearch'
import { getVisibleMessages } from './branches.js'
import * as db from './db.js'
import type { Session, SessionSummary } from './types.js'

/**
 * 全局文本搜索：MiniSearch 内存倒排索引（匹配与相关性）+ 自研摘录定位（命中窗口映射回原文并高亮）。
 * 中文按二元组（bigram）切分，拉丁文按词切分；打开搜索浮层时异步建索引，之后查询即时返回。
 */

export type SearchHit = {
  sessionId: string
  messageId: string
  /** 命中所在的原文片段，命中词以 \x00 标记边界供界面高亮 */
  snippet: string
}

export type SearchIndex = {
  index: MiniSearch<SearchDoc>
  titles: Map<string, string>
  /** 每个会话第一条消息：仅标题命中时作为入口摘录 */
  firstMessages: Map<string, { messageId: string; text: string }>
}

type SearchDoc = {
  id: string
  sessionId: string
  messageId: string
  text: string
}

export type SearchProgress = { scanned: number; total: number }

const MAX_HITS = 300
/** 摘录窗口：命中词前后各取的字符数 */
const SNIPPET_CONTEXT = 48
const MARK = '\x00'

/** CJK 连续段按二元组切分，拉丁/数字按词切分；其余字符忽略。 */
const tokenize = (text: string): string[] => {
  const normalized = text.normalize('NFKC').toLowerCase()
  const tokens: string[] = []
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9'+.-]*/g)) {
    tokens.push(match[0])
  }
  for (const match of normalized.matchAll(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g)) {
    const run = match[0]
    if (run.length === 1) {
      tokens.push(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i++) {
      tokens.push(run.slice(i, i + 2))
    }
  }
  return tokens
}

const miniSearchOptions = {
  fields: ['text'],
  storeFields: ['sessionId', 'messageId', 'text'],
  tokenize,
  searchOptions: { prefix: true, fuzzy: 0.2, tokenize, combineWith: 'AND' as const },
}

/** 归一化文本与原文的位置映射，用于摘录与高亮（见 normalizeMapped 的 map）。 */
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

/** 归一化位置换算回原文位置。 */
const toOriginalIndex = (map: number[], normalizedIndex: number, fallback: number) =>
  normalizedIndex >= 0 && normalizedIndex < map.length ? map[normalizedIndex] : fallback

/** 会话的搜索域：当前分支上每条消息的可读文本 */
const searchableTexts = (session: Session): { messageId: string; text: string }[] => {
  const texts: { messageId: string; text: string }[] = []
  for (const message of getVisibleMessages(session)) {
    if (message.role === 'user') {
      if (message.content.trim()) {
        texts.push({ messageId: message.id, text: message.content })
      }
      continue
    }
    // 模板提示（过载、拦截等）与思考过程不进入搜索域。
    const text = message.blocks
      .map((block) => (block.type === 'text' && !block.isTemplate ? block.text : ''))
      .join('')
      .replace(/\[citation:\d+\]/g, '')
    if (text.trim()) {
      texts.push({ messageId: message.id, text })
    }
  }
  return texts
}

/** 在单个文本中定位第一个命中词，返回带高亮标记的摘录。 */
const matchText = (text: string, terms: string[]): string | null => {
  const { normalized, map } = normalizeMapped(text)
  let matched: { start: number; end: number } | null = null
  for (const term of terms) {
    const index = normalized.indexOf(term)
    if (index !== -1) {
      if (!matched) {
        matched = {
          start: toOriginalIndex(map, index, 0),
          end: toOriginalIndex(map, index + term.length, text.length),
        }
      }
    }
  }
  if (!matched) {
    // 词条经索引匹配但正文里没有连续子串（前缀/模糊命中）：摘录取文本开头，不高亮。
    const head = text
      .slice(0, SNIPPET_CONTEXT * 2)
      .replace(/\s+/g, ' ')
      .trim()
    return text.length > SNIPPET_CONTEXT * 2 ? `${head}…` : head
  }
  const start = Math.max(0, matched.start - SNIPPET_CONTEXT)
  const end = Math.min(text.length, matched.end + SNIPPET_CONTEXT)
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) {
    snippet = `…${snippet}`
  }
  if (end < text.length) {
    snippet = `${snippet}…`
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

export type BuildOptions = {
  signal: AbortSignal
  onProgress?: (progress: SearchProgress) => void
}

/** 遍历全部会话构建搜索索引；signal 中止时提前结束。 */
export const buildSearchIndex = async (
  summaries: SessionSummary[],
  options: BuildOptions
): Promise<SearchIndex | null> => {
  const index = new MiniSearch<SearchDoc>(miniSearchOptions)
  const titles = new Map<string, string>()
  const firstMessages = new Map<string, { messageId: string; text: string }>()
  let scanned = 0
  const report = () => options.onProgress?.({ scanned, total: summaries.length })
  report()
  for (const summary of summaries) {
    if (options.signal.aborted) {
      return null
    }
    scanned += 1
    try {
      const session = await db.loadSession(summary.id)
      if (!session || options.signal.aborted) {
        continue
      }
      titles.set(session.id, session.title)
      const texts = searchableTexts(session)
      if (texts.length > 0) {
        firstMessages.set(session.id, { messageId: texts[0].messageId, text: texts[0].text })
      }
      const docs: SearchDoc[] = texts.map(({ messageId, text }) => ({
        id: `${session.id}:${messageId}`,
        sessionId: session.id,
        messageId,
        text,
      }))
      index.addAll(docs)
    } catch (error) {
      db.reportStorageError('search index')(error)
    }
    if (scanned % 10 === 0) {
      report()
    }
  }
  report()
  return { index, titles, firstMessages }
}

/** 在索引上查询；无结果时放宽为 OR 组合再试一次。 */
const queryIndex = (index: SearchIndex, terms: string[]) => {
  const search = (combineWith: 'AND' | 'OR') =>
    index.index.search(terms.join(' '), { ...miniSearchOptions.searchOptions, combineWith })
  return search('AND').length > 0 ? search('AND') : search('OR')
}

/** 在索引上执行搜索，返回带高亮摘录的命中列表（按相关性排序，限 MAX_HITS）。 */
export const searchIndexed = (search: SearchIndex, query: string): SearchHit[] => {
  const terms = tokenize(query)
  if (terms.length === 0) {
    return []
  }
  const uniqueTerms = [...new Set(terms)]
  const results = queryIndex(search, uniqueTerms).slice(0, MAX_HITS)
  const hits: SearchHit[] = []
  const seenSessions = new Map<string, number>()
  for (const result of results) {
    const doc = result as unknown as SearchDoc
    if ((seenSessions.get(doc.sessionId) ?? 0) >= MAX_HITS_PER_SESSION) {
      continue
    }
    const snippet = matchText(doc.text, uniqueTerms)
    if (snippet === null) {
      continue
    }
    seenSessions.set(doc.sessionId, (seenSessions.get(doc.sessionId) ?? 0) + 1)
    hits.push({ sessionId: doc.sessionId, messageId: doc.messageId, snippet })
  }
  return hits
}

const MAX_HITS_PER_SESSION = 20

/** 仅标题命中（无消息命中）的会话列表，按摘要顺序返回。 */
export const titleOnlySessions = (
  search: SearchIndex,
  summaries: SessionSummary[],
  query: string,
  messageHitSessions: ReadonlySet<string>
): SearchHit[] => {
  const terms = tokenize(query)
  if (terms.length === 0) {
    return []
  }
  const hits: SearchHit[] = []
  for (const summary of summaries) {
    if (messageHitSessions.has(summary.id)) {
      continue
    }
    const title = search.titles.get(summary.id)
    if (title === undefined) {
      continue
    }
    const { normalized } = normalizeMapped(title)
    const matched =
      terms.every((term) => normalized.includes(term)) ||
      terms.every((term) => subsequenceRange(term, normalized) !== null)
    if (!matched) {
      continue
    }
    const first = search.firstMessages.get(summary.id)
    if (!first) {
      continue
    }
    const head = first.text
      .slice(0, SNIPPET_CONTEXT * 2)
      .replace(/\s+/g, ' ')
      .trim()
    hits.push({ sessionId: summary.id, messageId: first.messageId, snippet: head })
  }
  return hits
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
