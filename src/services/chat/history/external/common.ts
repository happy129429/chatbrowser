import { createId } from '../../../../utils/id.js'
import type {
  AssistantMessage,
  FileAttachment,
  Message,
  Session,
  UserMessage,
} from '../../types.js'
import type { ExternalSource } from './models.js'

export type { ExternalSource, GroupExtra } from './models.js'

export type Loose = Record<string, unknown>

export const record = (value: unknown): Loose | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : null

/** 秒级浮点、毫秒整数与 ISO 字符串都归一为毫秒时间戳。 */
export const toMs = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.round(value) : Math.round(value * 1000)
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

export const safeId = (value: string) =>
  value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || createId()

/** 兼容「数组 / {conversations}/{data} 包装 / 单会话对象」三种外层形态。 */
export const toConversationList = (parsed: unknown): unknown[] | null => {
  if (Array.isArray(parsed)) {
    return parsed
  }
  const wrapper = record(parsed)
  if (!wrapper) {
    return null
  }
  if (Array.isArray(wrapper.conversations)) {
    return wrapper.conversations
  }
  if (Array.isArray(wrapper.data)) {
    return wrapper.data
  }
  if (record(wrapper.data)) {
    return toConversationList(wrapper.data)
  }
  if (Array.isArray(wrapper.chats)) {
    return wrapper.chats
  }
  if (Array.isArray(wrapper.items)) {
    return wrapper.items
  }
  if (Array.isArray(wrapper.list)) {
    return wrapper.list
  }
  // OpenWebUI / z.ai 原生：单会话，消息树在 chat.history.messages（对象）
  const chat = record(wrapper.chat)
  if (chat && record(record(chat.history)?.messages)) {
    return [wrapper]
  }
  // 单会话 turn_history 封装（session_metadata / global_context）
  if (Array.isArray(wrapper.turn_history)) {
    return [wrapper]
  }
  // 单个 Claude 会话对象
  if (Array.isArray(wrapper.chat_messages)) {
    return [wrapper]
  }
  if (Array.isArray(wrapper.messages)) {
    return [wrapper]
  }
  return null
}

/** 通用消息内容：字符串、{parts:[...]}、[{text}] 都归并为纯文本。 */
export const contentText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'string'
          ? item
          : contentText(record(item)?.text) || contentText(record(item)?.content)
      )
      .filter(Boolean)
      .join('\n')
  }
  const wrapper = record(value)
  if (!wrapper) {
    return ''
  }
  if (Array.isArray(wrapper.parts)) {
    return wrapper.parts.filter((part): part is string => typeof part === 'string').join('\n')
  }
  if (typeof wrapper.content === 'string') {
    return wrapper.content
  }
  if (typeof wrapper.text === 'string') {
    return wrapper.text
  }
  return ''
}

export const roleOf = (value: unknown): 'user' | 'assistant' | 'system' | null => {
  const role = typeof value === 'string' ? value.toLowerCase() : ''
  if (['user', 'human', 'customer'].includes(role)) {
    return 'user'
  }
  if (['assistant', 'ai', 'model', 'bot', 'gpt', 'ai model', 'aimodel', 'chatbot'].includes(role)) {
    return 'assistant'
  }
  if (['system', 'developer', 'instructions'].includes(role)) {
    return 'system'
  }
  return null
}

export type Round = {
  question: string
  answer: string
  at: number
  thinking?: string
  thinkingSeconds?: number
  files?: FileAttachment[]
}

/** 把轮次数组转为线性消息链（提问 + 回答），供查看/导出/搜索复用。 */
export const toSession = (
  source: ExternalSource,
  groupId: string,
  rawId: string,
  title: string,
  createdAt: number,
  updatedAt: number,
  rounds: Round[]
): Session | null => {
  const usable = rounds.filter(
    (round) => round.question.trim() || round.answer.trim() || round.thinking?.trim()
  )
  if (usable.length === 0) {
    return null
  }
  const messages: Message[] = []
  let parentId: string | null = null
  usable.forEach((round, index) => {
    const roundAt = round.at || createdAt + index * 60_000
    if (round.question.trim()) {
      const user: UserMessage = {
        id: `${rawId}-u${index}`,
        role: 'user',
        content: round.question.trim(),
        files: round.files ?? [],
        createdAt: roundAt,
        parentId,
      }
      messages.push(user)
      parentId = user.id
    }
    if (round.answer.trim() || round.thinking?.trim()) {
      const blocks: AssistantMessage['blocks'] = []
      if (round.thinking?.trim()) {
        blocks.push({
          type: 'thinking',
          thinking: round.thinking.trim(),
          elapsedSeconds: round.thinkingSeconds,
        })
      }
      if (round.answer.trim()) {
        blocks.push({ type: 'text', text: round.answer.trim() })
      }
      const reply: AssistantMessage = {
        id: `${rawId}-a${index}`,
        role: 'assistant',
        createdAt: roundAt + 1,
        model: null,
        status: 'done',
        blocks,
        parentId,
      }
      messages.push(reply)
      parentId = reply.id
    }
  })
  for (let i = 0; i < messages.length - 1; i++) {
    messages[i].selectedChildId = messages[i + 1].id
  }
  return {
    id: `${groupId}-${source}-${safeId(rawId)}`,
    title,
    createdAt,
    updatedAt,
    groupId,
    pinned: false,
    messages,
    rootMessageId: messages[0].id,
  }
}
