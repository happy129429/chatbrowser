import { createId } from '../../../../utils/id.js'
import type { FileAttachment, Session } from '../../types.js'
import { record, toMs, toSession, type Loose, type Round } from './common.js'

const chatGptAttachments = (message: Loose): FileAttachment[] => {
  const metadata = record(message.metadata)
  const list = Array.isArray(metadata?.attachments) ? metadata.attachments : []
  const files: FileAttachment[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const file = record(item)
    if (!file) {
      continue
    }
    const id =
      typeof file.id === 'string' && file.id.trim()
        ? file.id
        : typeof file.library_file_id === 'string' && file.library_file_id.trim()
          ? file.library_file_id
          : createId()
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    const name =
      typeof file.name === 'string' && file.name.trim()
        ? file.name
        : typeof file.file_name === 'string' && file.file_name.trim()
          ? file.file_name
          : '未命名附件'
    const mime =
      typeof file.mime_type === 'string'
        ? file.mime_type
        : typeof file.mimeType === 'string'
          ? file.mimeType
          : ''
    const size =
      typeof file.size === 'number'
        ? file.size
        : typeof file.file_size_bytes === 'number'
          ? file.file_size_bytes
          : 0
    files.push({
      id,
      name,
      size,
      isImage: mime.startsWith('image/') || file.is_image === true,
      mimeType: mime,
    })
  }
  return files
}

/** ChatGPT：按 current_node 回溯父链还原当前分支。 */
export const fromChatGpt = (parsed: unknown[], groupId: string): Session[] => {
  const sessions: Session[] = []
  for (const item of parsed) {
    const conversation = record(item)
    const mapping = conversation ? record(conversation.mapping) : null
    if (!conversation || !mapping) {
      continue
    }
    const startId =
      typeof conversation.current_node === 'string'
        ? conversation.current_node
        : Object.keys(mapping).at(-1)
    const path: Loose[] = []
    let cursor = startId
    const seen = new Set<string>()
    while (typeof cursor === 'string' && !seen.has(cursor)) {
      seen.add(cursor)
      const node = record(mapping[cursor])
      if (!node) {
        break
      }
      path.push(node)
      cursor = typeof node.parent === 'string' ? node.parent : undefined
    }
    path.reverse()
    const systemParts: string[] = []
    const rounds: Round[] = []
    let pendingQuestion = ''
    let pendingAt = 0
    let pendingFiles: FileAttachment[] = []
    for (const node of path) {
      const message = record(node.message)
      const author = message ? record(message.author) : null
      const role = author?.role
      if (!message) {
        continue
      }
      if (role === 'system' || role === 'developer') {
        const systemContent = record(message.content)
        const systemPartsRaw = Array.isArray(systemContent?.parts) ? systemContent.parts : []
        const systemText = systemPartsRaw
          .filter((part): part is string => typeof part === 'string')
          .join('\n')
        if (systemText.trim()) {
          systemParts.push(systemText.trim())
        }
        continue
      }
      if (role !== 'user' && role !== 'assistant') {
        continue
      }
      const content = record(message.content)
      const parts = Array.isArray(content?.parts) ? content.parts : []
      const text = parts.filter((part): part is string => typeof part === 'string').join('\n')
      const at = toMs(message.create_time, Date.now())
      if (role === 'user') {
        if (pendingQuestion) {
          rounds.push({ question: pendingQuestion, answer: '', at: pendingAt, files: pendingFiles })
        }
        pendingQuestion = text
        pendingAt = at
        pendingFiles = chatGptAttachments(message)
      } else {
        rounds.push({
          question: pendingQuestion,
          answer: text,
          at: pendingAt || at,
          files: pendingFiles,
        })
        pendingQuestion = ''
        pendingFiles = []
      }
    }
    if (pendingQuestion) {
      rounds.push({ question: pendingQuestion, answer: '', at: pendingAt, files: pendingFiles })
    }
    const session = toSession(
      'chatgpt',
      groupId,
      typeof conversation.id === 'string' ? conversation.id : createId(),
      typeof conversation.title === 'string' && conversation.title.trim()
        ? conversation.title
        : 'ChatGPT 对话',
      toMs(conversation.create_time, Date.now()),
      toMs(conversation.update_time, Date.now()),
      rounds
    )
    if (session) {
      if (systemParts.length > 0) {
        session.systemPrompt = systemParts.join('\n\n---\n\n')
      }
      sessions.push(session)
    }
  }
  return sessions
}
