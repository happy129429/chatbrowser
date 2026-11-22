import type { AssistantMessage, Session, SessionGroup } from '../types.js'
import type { TextCitation } from '../../api/types.js'
import { EXT_PATH } from './paths.js'
import { readArchive, readEntry, skipEntry } from './zipReader.js'

/** chatbrowser_ext.json：官方 schema 之外的应用扩展数据（可选旁路文件）。 */
export type MessageExtension = {
  /** 归档中的消息 ID（按父链顺序编号，字符串形式） */
  id: string
  citations?: { textIndex: number; citations: TextCitation[] }[]
  thinking?: {
    thinkingIndex: number
    signature?: string
    truncated?: boolean
    hidden?: boolean
  }[]
}

export type ArchiveExtension = {
  format: 'chatbrowser-ext'
  version: 1
  group?: {
    name?: string
    color?: string | null
    extras?: { title: string; content: string }[]
  }
  sessions?: {
    id: string
    systemPrompt?: string
    summary?: string
    messages?: MessageExtension[]
  }[]
}

const record = (value: unknown) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** 宽松读取：只接受我们写出的格式，其余视为无扩展数据。 */
export const readExtension = (value: unknown): ArchiveExtension | null => {
  const data = record(value)
  if (!data || data.format !== 'chatbrowser-ext' || data.version !== 1) {
    return null
  }
  const group = record(data.group)
  const sessions = Array.isArray(data.sessions)
    ? data.sessions
        .map(record)
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => ({
          id: typeof item.id === 'string' ? item.id : '',
          systemPrompt: typeof item.systemPrompt === 'string' ? item.systemPrompt : undefined,
          summary: typeof item.summary === 'string' ? item.summary : undefined,
          messages: Array.isArray(item.messages)
            ? item.messages
                .map(record)
                .filter((entry): entry is Record<string, unknown> => entry !== null)
                .map((entry) => ({
                  id: typeof entry.id === 'string' ? entry.id : String(entry.id ?? ''),
                  citations: Array.isArray(entry.citations)
                    ? entry.citations
                        .map(record)
                        .filter((value): value is Record<string, unknown> => value !== null)
                        .map((value) => ({
                          textIndex: typeof value.textIndex === 'number' ? value.textIndex : 0,
                          citations: Array.isArray(value.citations)
                            ? (value.citations as TextCitation[])
                            : [],
                        }))
                    : undefined,
                  thinking: Array.isArray(entry.thinking)
                    ? entry.thinking
                        .map(record)
                        .filter((value): value is Record<string, unknown> => value !== null)
                        .map((value) => ({
                          thinkingIndex:
                            typeof value.thinkingIndex === 'number' ? value.thinkingIndex : 0,
                          signature:
                            typeof value.signature === 'string' ? value.signature : undefined,
                          truncated: value.truncated === true,
                          hidden: value.hidden === true,
                        }))
                    : undefined,
                }))
                .filter((entry) => entry.id !== '')
            : undefined,
        }))
        .filter((item) => item.id !== '')
    : undefined
  return {
    format: 'chatbrowser-ext',
    version: 1,
    group: group
      ? {
          name: typeof group.name === 'string' ? group.name : undefined,
          color: typeof group.color === 'string' ? group.color : null,
          extras: Array.isArray(group.extras)
            ? group.extras
                .map(record)
                .filter((item): item is Record<string, unknown> => item !== null)
                .map((item) => ({
                  title: typeof item.title === 'string' ? item.title : '',
                  content: typeof item.content === 'string' ? item.content : '',
                }))
                .filter((item) => item.title !== '' || item.content !== '')
            : undefined,
        }
      : undefined,
    sessions,
  }
}

/** 预读 ZIP 内的扩展数据；旧归档没有该文件时返回 null。 */
export const readArchiveExtension = async (file: File): Promise<ArchiveExtension | null> => {
  try {
    for await (const entry of readArchive(file)) {
      if (entry.path === EXT_PATH) {
        const parsed = JSON.parse(await (await readEntry(entry)).text()) as unknown
        return readExtension(parsed)
      }
      await skipEntry(entry)
    }
  } catch {
    return null
  }
  return null
}

/** 生成扩展数据文件内容（会话系统提示词 + 分组信息）。 */
export const toExtension = (
  group: SessionGroup | null,
  prompts: Map<string, string>,
  groupExtras?: { title: string; content: string }[],
  summaries: Map<string, string> = new Map(),
  messages: Map<string, MessageExtension[]> = new Map()
): ArchiveExtension => ({
  format: 'chatbrowser-ext',
  version: 1,
  group: group
    ? {
        name: group.name,
        color: group.color,
        extras: groupExtras && groupExtras.length > 0 ? groupExtras : undefined,
      }
    : undefined,
  sessions: [...new Set([...prompts.keys(), ...summaries.keys(), ...messages.keys()])].map(
    (id) => ({
      id,
      systemPrompt: prompts.get(id),
      summary: summaries.get(id),
      messages: messages.get(id),
    })
  ),
})

export const sessionMessages = (
  extension: ArchiveExtension | null
): Map<string, MessageExtension[]> =>
  new Map(
    (extension?.sessions ?? [])
      .filter((item) => item.messages && item.messages.length > 0)
      .map((item) => [item.id, item.messages as MessageExtension[]])
  )

/** 把消息级扩展（citations / thinking 状态）应用到已导入的本地会话。 */
export const applyMessageExtensions = (session: Session, entries: MessageExtension[]) => {
  const byId = new Map(session.messages.map((message) => [String(message.id), message]))
  for (const entry of entries) {
    const message = byId.get(entry.id)
    if (!message || message.role !== 'assistant') {
      continue
    }
    const reply = message as AssistantMessage
    const textBlocks = reply.blocks.filter((block) => block.type === 'text')
    for (const item of entry.citations ?? []) {
      const block = textBlocks[item.textIndex]
      if (block && block.type === 'text' && item.citations.length > 0) {
        block.citations = item.citations
      }
    }
    const thinkingBlocks = reply.blocks.filter((block) => block.type === 'thinking')
    for (const item of entry.thinking ?? []) {
      const block = thinkingBlocks[item.thinkingIndex]
      if (!block || block.type !== 'thinking') {
        continue
      }
      if (item.signature) {
        block.signature = item.signature
      }
      if (item.truncated) {
        block.truncated = true
      }
      if (item.hidden) {
        block.hidden = true
      }
    }
  }
}

export const sessionSummaries = (extension: ArchiveExtension | null): Map<string, string> =>
  new Map(
    (extension?.sessions ?? [])
      .filter((item) => item.summary && item.summary.trim() !== '')
      .map((item) => [item.id, item.summary as string])
  )

export const sessionPrompts = (extension: ArchiveExtension | null): Map<string, string> =>
  new Map(
    (extension?.sessions ?? [])
      .filter((item) => item.systemPrompt && item.systemPrompt.trim() !== '')
      .map((item) => [item.id, item.systemPrompt as string])
  )

/** 供导出器读取会话系统提示词；外部导入的 session 才有该字段。 */
export const promptOf = (session: Session): string | undefined =>
  session.systemPrompt && session.systemPrompt.trim() !== '' ? session.systemPrompt : undefined
