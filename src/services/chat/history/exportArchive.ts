import * as db from '../db.js'
import type { Session } from '../types.js'
import { EXPORT_FORMAT_VERSION, type Manifest, type SessionIndexEntry } from './format.js'
import { EXT_PATH, INDEX_PATH, MANIFEST_PATH, imagePath, sessionPath } from './paths.js'
import { promptOf, toExtension, type MessageExtension } from './extension.js'
import { anonymizeSession } from '../converters/anonymize.js'
import type { SessionGroup } from '../types.js'
import { orderedMessages, toIndexEntry, toSessionFile } from './toArchive.js'
import { writeArchive } from './zipWriter.js'

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

/**
 * 按导出格式生成 ZIP：manifest → 全部会话 JSON → index → 全部图片。没有账号信息，不写 user.json。
 * 只写出本地有原件的图片，每个会话目录各写一份；其他附件只有元数据。
 */
export const exportArchive = async (
  sessions: Iterable<Session> | AsyncIterable<Session>,
  options: { extended?: boolean; anonymize?: boolean; group?: SessionGroup | null } = {}
): Promise<Blob> => {
  const manifest: Manifest = { export_format_version: EXPORT_FORMAT_VERSION }
  const entries = [{ name: MANIFEST_PATH, blob: json(manifest) }]
  const imageEntries: { name: string; blob: Blob }[] = []
  const index: SessionIndexEntry[] = []
  const originals = new Map<string, Blob | undefined>()
  const prompts = new Map<string, string>()
  const summaries = new Map<string, string>()
  const messagesExt = new Map<string, MessageExtension[]>()
  for await (const original of sessions) {
    const anonymized = options.anonymize ? anonymizeSession(original) : null
    const session = anonymized?.session ?? original
    const prompt = promptOf(original)
    if (prompt) {
      prompts.set(session.id, prompt)
    }
    if (session.summary?.trim()) {
      summaries.set(session.id, session.summary)
    }
    for (const message of session.messages) {
      if (message.role === 'user') {
        for (const file of message.files) {
          if (file.isImage && !originals.has(file.id)) {
            const sourceId = anonymized?.fileIds.get(file.id) ?? file.id
            originals.set(file.id, await db.loadFile(sourceId))
          }
        }
      }
    }
    if (options.extended) {
      const extras: MessageExtension[] = []
      orderedMessages(session).forEach((message, index) => {
        if (message.role !== 'assistant') {
          return
        }
        const citations: MessageExtension['citations'] = []
        const thinking: MessageExtension['thinking'] = []
        let textIndex = 0
        let thinkingIndex = 0
        for (const block of message.blocks) {
          if (block.type === 'text') {
            if (block.citations && block.citations.length > 0) {
              citations.push({ textIndex, citations: block.citations })
            }
            textIndex += 1
          } else if (block.type === 'thinking') {
            if (block.signature || block.truncated || block.hidden) {
              thinking.push({
                thinkingIndex,
                signature: block.signature,
                truncated: block.truncated,
                hidden: block.hidden,
              })
            }
            thinkingIndex += 1
          }
        }
        if (citations.length > 0 || thinking.length > 0) {
          extras.push({
            id: String(index + 1),
            ...(citations.length > 0 ? { citations } : {}),
            ...(thinking.length > 0 ? { thinking } : {}),
          })
        }
      })
      if (extras.length > 0) {
        messagesExt.set(session.id, extras)
      }
    }
    const images = new Map<string, Blob>()
    const data = toSessionFile(session, ({ id, name, isImage }) => {
      const blob = originals.get(id)
      if (!blob || !isImage) {
        return null
      }
      const path = imagePath(session.id, id, name)
      images.set(path, blob)
      return path
    })
    entries.push({ name: sessionPath(session.id), blob: json(data) })
    for (const [name, blob] of images) {
      imageEntries.push({ name, blob })
    }
    index.push(toIndexEntry(data))
  }
  entries.push({ name: INDEX_PATH, blob: json(index) })
  if (options.extended) {
    const extension = toExtension(
      options.group ?? null,
      prompts,
      options.group?.extras,
      summaries,
      messagesExt
    )
    entries.push({ name: EXT_PATH, blob: json(extension) })
  }
  return writeArchive(entries.concat(imageEntries))
}
