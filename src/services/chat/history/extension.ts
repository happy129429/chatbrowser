import type { Session, SessionGroup } from '../types.js'
import { EXT_PATH } from './paths.js'
import { readArchive, readEntry, skipEntry } from './zipReader.js'

/** chatbrowser_ext.json：官方 schema 之外的应用扩展数据（可选旁路文件）。 */
export type ArchiveExtension = {
  format: 'chatbrowser-ext'
  version: 1
  group?: {
    name?: string
    color?: string | null
    extras?: { title: string; content: string }[]
  }
  sessions?: { id: string; systemPrompt?: string }[]
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
  groupExtras?: { title: string; content: string }[]
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
  sessions: [...prompts.entries()].map(([id, systemPrompt]) => ({ id, systemPrompt })),
})

export const sessionPrompts = (extension: ArchiveExtension | null): Map<string, string> =>
  new Map(
    (extension?.sessions ?? [])
      .filter((item) => item.systemPrompt && item.systemPrompt.trim() !== '')
      .map((item) => [item.id, item.systemPrompt as string])
  )

/** 供导出器读取会话系统提示词；外部导入的 session 才有该字段。 */
export const promptOf = (session: Session): string | undefined =>
  session.systemPrompt && session.systemPrompt.trim() !== '' ? session.systemPrompt : undefined
