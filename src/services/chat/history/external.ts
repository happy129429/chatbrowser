import { createId } from '../../../utils/id.js'
import { ArchiveError, isZipFile, readArchive, readEntry } from './zipReader.js'
import type { AssistantMessage, FileAttachment, Message, Session, UserMessage } from '../types.js'
import { getFileViewType, isImage } from '../../../utils/file.js'
import type { TextCitation } from '../../api/types.js'
import { translate } from '../../../i18n/index.js'
import { BackupError } from './errors.js'

/**
 * 第三方 AI 聊天记录导入：ChatGPT（conversations.json）与 Claude（conversations.json）。
 * 两者都转换为本应用的线性会话模型；会话 ID 带导入批次前缀，避免重复导入时互相覆盖。
 * DeepSeek 官方 ZIP 仍走 history/ 的完整管线（分支、工具步骤等）。
 */

export type ExternalSource = 'chatgpt' | 'claude' | 'generic' | 'openwebui' | 'turns'

type Loose = Record<string, unknown>

const record = (value: unknown): Loose | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : null

/** 秒级浮点、毫秒整数与 ISO 字符串都归一为毫秒时间戳。 */
const toMs = (value: unknown, fallback: number): number => {
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

const safeId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || createId()

/** 兼容「数组 / {conversations}/{data} 包装 / 单会话对象」三种外层形态。 */
const toConversationList = (parsed: unknown): unknown[] | null => {
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

/**
 * 识别外部导出格式：
 * - ChatGPT：会话带 mapping 消息树
 * - Claude：chat_messages 数组
 * - 通用（含 z.ai 等）：messages 数组，元素含 role + content/text
 */
export const detectExternalSource = (parsed: unknown): ExternalSource | null => {
  const list = toConversationList(parsed)
  if (!list || list.length === 0) {
    return null
  }
  const first = record(list[0])
  if (!first) {
    return null
  }
  const chat = record(first.chat)
  if (chat && record(record(chat.history)?.messages)) {
    return 'openwebui'
  }
  if (record(first.mapping)) {
    return 'chatgpt'
  }
  if (Array.isArray(first.chat_messages)) {
    return 'claude'
  }
  if (Array.isArray(first.turn_history)) {
    return 'turns'
  }
  for (const key of ['messages', 'chat_history', 'history', 'turns', 'records']) {
    const messages = first[key]
    if (Array.isArray(messages) && messages.length > 0) {
      const sample = record(messages[0])
      if (
        sample &&
        ('role' in sample || 'sender' in sample || 'from' in sample || 'is_user' in sample)
      ) {
        return 'generic'
      }
    }
  }
  return null
}

/** 通用消息内容：字符串、{parts:[...]}、[{text}] 都归并为纯文本。 */
const contentText = (value: unknown): string => {
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

const roleOf = (value: unknown): 'user' | 'assistant' | 'system' | null => {
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

/** OpenWebUI / z.ai 原生：chat.history.messages 对象树 + currentId（支持分支）。 */
const fromOpenWebUI = (parsed: unknown[], groupId: string): Session[] => {
  const sessions: Session[] = []
  for (const item of parsed) {
    const conversation = record(item)
    const chat = conversation ? record(conversation.chat) : null
    const history = chat ? record(chat.history) : null
    const map = history ? record(history.messages) : null
    if (!conversation || !chat || !history || !map) {
      continue
    }
    const entries = Object.entries(map)
      .map(([key, value]) => ({ key, message: record(value) }))
      .filter((entry): entry is { key: string; message: Loose } => entry.message !== null)
    if (entries.length === 0) {
      continue
    }
    // 先按 currentId 回溯父链；脱敏样本里 id/父链被破坏时退回时间顺序
    const path: Loose[] = []
    const seen = new Set<string>()
    let broken = false
    const exists = (id: string) =>
      entries.some((entry) => entry.key === id || entry.message.id === id)
    let cursor: string | undefined =
      typeof history.currentId === 'string' ? history.currentId : undefined
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const hit = entries.find((entry) => entry.key === cursor || entry.message.id === cursor)
      if (!hit) {
        broken = true
        break
      }
      path.push(hit.message)
      const parent = hit.message.parentId
      cursor = typeof parent === 'string' ? parent : undefined
      if (cursor && !exists(cursor)) {
        broken = true
      }
    }
    path.reverse()
    // 父链断裂（脱敏/字段缺失）时用全量时间顺序，避免只导入分支末端的一两轮
    const ordered =
      !broken && path.length >= 2
        ? path
        : entries
            .map((entry) => entry.message)
            .sort((a, b) => toMs(a.timestamp, 0) - toMs(b.timestamp, 0))
    const rounds: Round[] = []
    let pendingQuestion = ''
    let pendingAt = 0
    for (const message of ordered) {
      const role = roleOf(message.role)
      const text = contentText(message.content ?? message.text)
      if (!role || !text.trim()) {
        continue
      }
      const at = toMs(message.timestamp, Date.now())
      if (role === 'user') {
        if (pendingQuestion) {
          rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
        }
        pendingQuestion = text
        pendingAt = at
      } else if (role === 'assistant') {
        rounds.push({ question: pendingQuestion, answer: text, at: pendingAt || at })
        pendingQuestion = ''
      }
    }
    if (pendingQuestion) {
      rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
    }
    const rawId =
      (typeof conversation.id === 'string' && conversation.id) ||
      (typeof chat.id === 'string' && chat.id) ||
      createId()
    const session = toSession(
      'openwebui',
      groupId,
      rawId,
      (typeof conversation.title === 'string' && conversation.title.trim()) || '导入的对话',
      toMs(conversation.created_at ?? conversation.timestamp, Date.now()),
      toMs(conversation.updated_at ?? conversation.timestamp, Date.now()),
      rounds
    )
    if (session) {
      sessions.push(session)
    }
  }
  return sessions
}

/** 单会话 turn_history 封装：session_metadata + metadata.sender + global_context 系统指令。 */
const fromTurns = (parsed: unknown[], groupId: string): Session[] => {
  const sessions: Session[] = []
  for (const item of parsed) {
    const conversation = record(item)
    const entries =
      conversation && Array.isArray(conversation.turn_history) ? conversation.turn_history : null
    if (!conversation || !entries) {
      continue
    }
    const metadata = record(conversation.session_metadata)
    const context = record(conversation.global_context)
    const systemParts: string[] = []
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        if (
          typeof value === 'string' &&
          value.trim() &&
          /system.*(instruction|prompt)|prompt_template|^instructions?$/i.test(key)
        ) {
          systemParts.push(value.trim())
        }
      }
    }
    const rounds: Round[] = []
    let pendingQuestion = ''
    let pendingAt = 0
    let lastAt = 0
    for (const entry of entries) {
      const turn = record(entry)
      if (!turn) {
        continue
      }
      const turnMetadata = record(turn.metadata)
      const role = roleOf(turn.role) ?? roleOf(turnMetadata?.sender)
      const text = contentText(turn.content ?? turn.text)
      const at = toMs(turnMetadata?.created_at ?? turn.created_at ?? turn.timestamp, Date.now())
      if (!role || !text.trim()) {
        continue
      }
      lastAt = at
      if (role === 'system') {
        systemParts.push(text.trim())
        continue
      }
      if (role === 'user') {
        if (pendingQuestion) {
          rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
        }
        pendingQuestion = text
        pendingAt = at
      } else {
        rounds.push({ question: pendingQuestion, answer: text, at: pendingAt || at })
        pendingQuestion = ''
      }
    }
    if (pendingQuestion) {
      rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
    }
    const session = toSession(
      'turns',
      groupId,
      (typeof conversation.conversation_id === 'string' && conversation.conversation_id) ||
        (typeof conversation.id === 'string' && conversation.id) ||
        createId(),
      (typeof conversation.title === 'string' && conversation.title.trim()) ||
        (typeof metadata?.title === 'string' && metadata.title.trim()) ||
        '导入的对话',
      toMs(metadata?.timestamp_start, lastAt || Date.now()),
      toMs(metadata?.timestamp_end, lastAt || Date.now()),
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

/** 通用格式（z.ai 等）：按 messages 顺序配对提问与回答，system 归入系统提示。 */
const fromGeneric = (list: unknown[], groupId: string): Session[] => {
  const sessions: Session[] = []
  for (const item of list) {
    const conversation = record(item)
    if (!conversation) {
      continue
    }
    const messages = ['messages', 'chat_history', 'history', 'turns', 'records']
      .map((key) => conversation[key])
      .find((value): value is unknown[] => Array.isArray(value))
    if (!messages) {
      continue
    }
    const systemParts: string[] = []
    const rounds: Round[] = []
    let pendingQuestion = ''
    let pendingAt = 0
    messages.forEach((entry, index) => {
      const message = record(entry)
      if (!message) {
        return
      }
      const role =
        roleOf(message.role) ??
        roleOf(message.sender) ??
        roleOf(message.from) ??
        (message.is_user === true ? 'user' : message.is_user === false ? 'assistant' : null)
      const text = contentText(
        message.content ?? message.text ?? message.message ?? message.value ?? message.parts
      )
      const at = toMs(
        message.created_at ?? message.created_time ?? message.inserted_at ?? message.timestamp,
        Date.now() + index
      )
      if (!role || !text.trim()) {
        return
      }
      if (role === 'system') {
        systemParts.push(text.trim())
        return
      }
      if (role === 'user') {
        if (pendingQuestion) {
          rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
        }
        pendingQuestion = text
        pendingAt = at
      } else {
        rounds.push({ question: pendingQuestion, answer: text, at: pendingAt || at })
        pendingQuestion = ''
      }
    })
    if (pendingQuestion) {
      rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
    }
    const rawId =
      (typeof conversation.id === 'string' && conversation.id) ||
      (typeof conversation.uuid === 'string' && conversation.uuid) ||
      (typeof conversation.conversation_id === 'string' && conversation.conversation_id) ||
      createId()
    const session = toSession(
      'generic',
      groupId,
      rawId,
      (typeof conversation.title === 'string' && conversation.title.trim()) ||
        (typeof conversation.name === 'string' && conversation.name.trim()) ||
        '导入的对话',
      toMs(
        conversation.created_at ?? conversation.created_time ?? conversation.create_time,
        Date.now()
      ),
      toMs(
        conversation.updated_at ?? conversation.updated_time ?? conversation.update_time,
        Date.now()
      ),
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

type Round = {
  question: string
  answer: string
  at: number
  thinking?: string
  thinkingSeconds?: number
}

export type GroupExtra = { title: string; content: string }

/** 把轮次数组转为线性消息链（提问 + 回答），供查看/导出/搜索复用。 */
const toSession = (
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
        files: [],
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

/** ChatGPT：按 current_node 回溯父链还原当前分支。 */
const fromChatGpt = (parsed: unknown[], groupId: string): Session[] => {
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
          rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
        }
        pendingQuestion = text
        pendingAt = at
      } else {
        rounds.push({ question: pendingQuestion, answer: text, at: pendingAt || at })
        pendingQuestion = ''
      }
    }
    if (pendingQuestion) {
      rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
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

/** Claude content 块：正文与思考分离；text 是拼接全文，仅在缺少 content 时回退。 */
const claudeContent = (
  message: Loose
): {
  text: string
  blocks: AssistantMessage['blocks']
  unsupported: { type: string; count: number }[]
} => {
  const raw = Array.isArray(message.content)
    ? message.content.map(record).filter((block): block is Loose => block !== null)
    : []
  const texts: string[] = []
  const thinkings: string[] = []
  const unsupported = new Map<string, number>()
  const textCitations = new Map<number, TextCitation[]>()
  const thinkingFlags: { truncated?: boolean; hidden?: boolean; signature?: string } = {}
  let startedAt: number | undefined
  let endedAt: number | undefined
  let thinkingSeconds = 0
  for (const block of raw) {
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text)
      const citations = Array.isArray(block.citations)
        ? block.citations
            .map(record)
            .filter((citation): citation is Loose => citation !== null)
            .map((citation) => ({
              type: 'web_search_result_location' as const,
              url: typeof citation.url === 'string' ? citation.url : '',
              title: typeof citation.title === 'string' ? citation.title : null,
              cited_text: typeof citation.cited_text === 'string' ? citation.cited_text : '',
              encrypted_index:
                typeof citation.encrypted_index === 'string' ? citation.encrypted_index : '',
            }))
            .filter((citation) => citation.url !== '')
        : []
      if (citations.length > 0) {
        textCitations.set(texts.length - 1, citations)
      }
    } else if (block.type === 'thinking') {
      const summary = Array.isArray(block.summaries)
        ? block.summaries
            .map(record)
            .filter((item): item is Loose => item !== null)
            .map((item) => (typeof item.summary === 'string' ? item.summary : ''))
            .filter(Boolean)
            .join('\n')
        : ''
      const thinking =
        typeof block.thinking === 'string' && block.thinking.trim() && !block.thinking_hidden
          ? block.thinking
          : summary
      if (thinking.trim()) {
        thinkings.push(thinking)
      }
      const start =
        typeof block.start_timestamp === 'string' ? Date.parse(block.start_timestamp) : NaN
      const stop = typeof block.stop_timestamp === 'string' ? Date.parse(block.stop_timestamp) : NaN
      if (Number.isFinite(start) && Number.isFinite(stop) && stop > start) {
        thinkingSeconds += (stop - start) / 1000
        startedAt = startedAt === undefined ? start : Math.min(startedAt, start)
        endedAt = endedAt === undefined ? stop : Math.max(endedAt, stop)
      }
      if (block.truncated === true || block.cut_off === true) {
        thinkingFlags.truncated = true
      }
      if (block.hidden === true || block.thinking_hidden === true) {
        thinkingFlags.hidden = true
      }
      if (typeof block.signature === 'string' && block.signature.trim()) {
        thinkingFlags.signature = block.signature
      }
    } else if (typeof block.type === 'string') {
      unsupported.set(block.type, (unsupported.get(block.type) ?? 0) + 1)
    }
  }
  const text = texts.join('\n\n') || (raw.length === 0 ? contentText(message.text) : '')
  const blocks: AssistantMessage['blocks'] = []
  if (thinkings.length > 0) {
    blocks.push({
      type: 'thinking',
      thinking: thinkings.join('\n\n'),
      ...thinkingFlags,
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(endedAt !== undefined ? { endedAt } : {}),
      ...(thinkingSeconds > 0 ? { elapsedSeconds: thinkingSeconds } : {}),
    })
  }
  texts.forEach((blockText, index) => {
    if (!blockText.trim()) {
      return
    }
    const citations = textCitations.get(index)
    blocks.push({
      type: 'text',
      text: blockText,
      ...(citations ? { citations } : {}),
    })
  })
  return {
    text,
    blocks,
    unsupported: [...unsupported.entries()].map(([type, count]) => ({ type, count })),
  }
}

/** files / attachments 只保留元数据：Claude 导出不含原件。 */
const claudeFiles = (message: Loose): FileAttachment[] => {
  const files: FileAttachment[] = []
  const seen = new Set<string>()
  const add = (value: unknown, index: number) => {
    const item = record(value)
    const name =
      (typeof item?.file_name === 'string' && item.file_name) ||
      (typeof item?.name === 'string' && item.name) ||
      (typeof item?.filename === 'string' && item.filename) ||
      (typeof value === 'string' ? value : '')
    if (!name.trim()) {
      return
    }
    const id =
      (typeof item?.file_uuid === 'string' && item.file_uuid) ||
      (typeof item?.uuid === 'string' && item.uuid) ||
      `${name}-${index}`
    if (seen.has(id)) {
      return
    }
    seen.add(id)
    const type = getFileViewType(name)
    files.push({ id, name, size: 0, isImage: isImage(type), mimeType: '' })
  }
  for (const key of ['files', 'attachments'] as const) {
    const list = Array.isArray(message[key]) ? message[key] : []
    list.forEach(add)
  }
  return files
}

const CLAUDE_ROOT_UUID = '00000000-0000-4000-8000-000000000000'

/** Claude：保留原始 uuid / parent_message_uuid，还原当前可见分支。 */
const fromClaude = (parsed: unknown[], groupId: string): Session[] => {
  const sessions: Session[] = []
  for (const item of parsed) {
    const conversation = record(item)
    const list =
      conversation && Array.isArray(conversation.chat_messages) ? conversation.chat_messages : null
    if (!conversation || !list) {
      continue
    }
    const raw = list.map(record).filter((message): message is Loose => message !== null)
    const title =
      typeof conversation.name === 'string' && conversation.name.trim()
        ? conversation.name
        : 'Claude 对话'
    const createdAt = toMs(conversation.created_at, Date.now())
    const updatedAt = toMs(conversation.updated_at, Date.now())
    const summary =
      typeof conversation.summary === 'string' && conversation.summary.trim()
        ? conversation.summary
        : undefined
    const rawId = typeof conversation.uuid === 'string' ? conversation.uuid : createId()
    const sessionId = `${groupId}-claude-${safeId(rawId)}`

    // 旧样本没有消息 uuid：退回顺序轮次解析。
    if (raw.length === 0 || !raw.every((message) => typeof message.uuid === 'string')) {
      const rounds: Round[] = []
      let pendingQuestion = ''
      let pendingAt = 0
      for (const message of raw) {
        const { text } = claudeContent(message)
        const at = toMs(message.created_at, Date.now())
        const sender = message.sender ?? message.role
        if (sender === 'human' || sender === 'user') {
          if (pendingQuestion) {
            rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
          }
          pendingQuestion = text
          pendingAt = at
        } else if (sender === 'assistant') {
          rounds.push({ question: pendingQuestion, answer: text, at: pendingAt || at })
          pendingQuestion = ''
        }
      }
      if (pendingQuestion) {
        rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
      }
      const session = toSession('claude', groupId, rawId, title, createdAt, updatedAt, rounds)
      if (session) {
        if (summary) {
          session.summary = summary
        }
        sessions.push(session)
      }
      continue
    }

    const nodes = new Map<string, { message: Loose; id: string; parentUuid: string | null }>()
    raw.forEach((message, index) => {
      const baseId = message.uuid as string
      const id = nodes.has(baseId) ? `${baseId}-${index}` : baseId
      const parentUuid =
        typeof message.parent_message_uuid === 'string' &&
        message.parent_message_uuid !== CLAUDE_ROOT_UUID
          ? message.parent_message_uuid
          : null
      nodes.set(id, { message, id, parentUuid })
    })
    const parentOf = (node: { parentUuid: string | null }) =>
      node.parentUuid && nodes.has(node.parentUuid) ? node.parentUuid : null

    // 从导出数组最后一条回溯当前分支，并为路径上的节点设置 selectedChildId。
    const path: string[] = []
    const seen = new Set<string>()
    let cursor: string | null = [...nodes.keys()].at(-1) ?? null
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      path.push(cursor)
      const node = nodes.get(cursor)
      cursor = node ? parentOf(node) : null
    }
    path.reverse()
    const nextOnPath = new Map<string, string>()
    for (let i = 0; i < path.length - 1; i++) {
      nextOnPath.set(path[i], path[i + 1])
    }

    const messages: Message[] = []
    for (const node of nodes.values()) {
      const at = toMs(node.message.created_at, createdAt)
      const parentId = parentOf(node)
      const selectedChildId = nextOnPath.get(node.id)
      const sender = roleOf(node.message.sender) ?? roleOf(node.message.role)
      const content = claudeContent(node.message)
      if (sender === 'user') {
        const unsupportedText =
          content.unsupported.length > 0
            ? translate('unsupportedBlocks', {
                types: content.unsupported.map((item) => `${item.type} ×${item.count}`).join(', '),
              })
            : ''
        messages.push({
          id: node.id,
          role: 'user',
          content: [content.text, unsupportedText].filter(Boolean).join('\n\n'),
          files: claudeFiles(node.message),
          createdAt: at,
          parentId,
          ...(selectedChildId ? { selectedChildId } : {}),
        })
      } else if (sender === 'assistant') {
        const blocks = [...content.blocks]
        if (content.unsupported.length > 0) {
          blocks.push({
            type: 'text',
            isTemplate: true,
            text: translate('unsupportedBlocks', {
              types: content.unsupported.map((item) => `${item.type} ×${item.count}`).join(', '),
            }),
          })
        }
        messages.push({
          id: node.id,
          role: 'assistant',
          createdAt: at,
          model: null,
          status: 'done',
          blocks,
          parentId,
          ...(selectedChildId ? { selectedChildId } : {}),
        })
      }
    }
    if (messages.length === 0) {
      continue
    }
    sessions.push({
      id: sessionId,
      title,
      createdAt,
      updatedAt,
      groupId,
      pinned: false,
      messages,
      rootMessageId: path[0] ?? messages[0].id,
      ...(summary ? { summary } : {}),
    })
  }
  return sessions
}

export type ExternalZipResult = { sessions: Session[]; extras: GroupExtra[] }

/** 从 ChatGPT 的 user.json / Claude 的 projects.json 中提取账号级附加信息。 */
const extrasFromJsonFile = (name: string, parsed: unknown): GroupExtra[] => {
  const lower = name.toLowerCase()
  const extras: GroupExtra[] = []
  if (lower.endsWith('user.json')) {
    const user = record(parsed)
    if (!user) {
      return extras
    }
    const memories = Array.isArray(user.memories)
      ? user.memories.filter(
          (item): item is string => typeof item === 'string' && item.trim() !== ''
        )
      : []
    if (memories.length > 0) {
      extras.push({ title: '记忆', content: memories.map((item) => `- ${item}`).join('\n') })
    }
    for (const [key, label] of [
      ['custom_instructions', '自定义指令'],
      ['instructions', '自定义指令'],
    ] as const) {
      const value = user[key]
      if (typeof value === 'string' && value.trim()) {
        extras.push({ title: label, content: value.trim() })
      }
    }
  }
  if (lower.endsWith('projects.json')) {
    // 兼容数组、{projects:[...]}、{data:[...]} 与单个项目对象
    const wrapper = record(parsed)
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(wrapper?.projects)
        ? wrapper.projects
        : Array.isArray(wrapper?.data)
          ? wrapper.data
          : wrapper
            ? [wrapper]
            : []
    for (const item of list) {
      const project = record(item)
      if (!project) {
        continue
      }
      const name =
        typeof project.name === 'string' && project.name.trim() ? project.name : '未命名项目'
      const prompt = [
        project.prompt_template,
        project.system_prompt,
        project.instructions,
        project.custom_instructions,
        project.prompt,
      ].find((value): value is string => typeof value === 'string' && value.trim() !== '')
      if (prompt) {
        extras.push({ title: `项目：${name}`, content: prompt.trim() })
      }
      const docs = Array.isArray(project.docs) ? project.docs : []
      const docNames = docs
        .map(record)
        .filter((doc): doc is Loose => doc !== null)
        .map((doc) =>
          typeof doc.filename === 'string'
            ? doc.filename
            : typeof doc.name === 'string'
              ? doc.name
              : typeof doc.file_name === 'string'
                ? doc.file_name
                : ''
        )
        .filter(Boolean)
      if (docNames.length > 0) {
        extras.push({
          title: `项目文件：${name}`,
          content: docNames.map((doc) => `- ${doc}`).join('\n'),
        })
      }
    }
  }
  if (lower.endsWith('users.json')) {
    const wrapper = record(parsed)
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(wrapper?.users)
        ? wrapper.users
        : wrapper
          ? [wrapper]
          : []
    const memories = new Set<string>()
    for (const item of list) {
      const user = record(item)
      if (!user) {
        continue
      }
      for (const value of [
        ...(Array.isArray(user.memories) ? user.memories : []),
        ...(Array.isArray(user.memory) ? user.memory : []),
      ]) {
        if (typeof value === 'string' && value.trim()) {
          memories.add(value.trim())
        }
      }
    }
    if (memories.size > 0) {
      extras.push({
        title: '记忆',
        content: [...memories].map((item) => `- ${item}`).join('\n'),
      })
    }
  }
  return extras
}

/** 从 ZIP 中寻找 ChatGPT / Claude 的 conversations JSON；找不到返回 null。 */
export const externalSessionsFromZip = async (
  file: File,
  groupId: string
): Promise<ExternalZipResult | null> => {
  if (!(await isZipFile(file))) {
    return null
  }
  let conversations: Session[] | null = null
  const extras: GroupExtra[] = []
  try {
    for await (const entry of readArchive(file)) {
      const lower = entry.path.toLowerCase()
      if (!lower.endsWith('.json')) {
        continue
      }
      // DeepSeek 归档的会话文件与索引不参与外部格式识别
      if (
        lower.startsWith('chat_sessions/') ||
        lower === 'manifest.json' ||
        lower === 'chat_session_index.json'
      ) {
        continue
      }
      // 单条 JSON 过大时跳过，避免内存风险
      if (entry.size > 256 * 1024 * 1024) {
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(await (await readEntry(entry)).text())
      } catch {
        continue
      }
      if (!conversations && detectExternalSource(parsed)) {
        try {
          conversations = externalToSessions(parsed, groupId)
          continue
        } catch (error) {
          if (error instanceof BackupError) {
            continue
          }
          throw error
        }
      }
      extras.push(...extrasFromJsonFile(entry.path, parsed))
    }
  } catch (error) {
    if (error instanceof ArchiveError) {
      return null
    }
    throw error
  }
  return conversations ? { sessions: conversations, extras } : null
}

/** 解析外部 JSON 为会话列表；无法识别时抛 backupUnrecognized。 */
export const externalToSessions = (parsed: unknown, groupId: string): Session[] => {
  const source = detectExternalSource(parsed)
  const list = toConversationList(parsed)
  if (source === null || list === null) {
    throw new BackupError('backupUnrecognized')
  }
  const sessions =
    source === 'chatgpt'
      ? fromChatGpt(list, groupId)
      : source === 'claude'
        ? fromClaude(list, groupId)
        : source === 'openwebui'
          ? fromOpenWebUI(list, groupId)
          : source === 'turns'
            ? fromTurns(list, groupId)
            : fromGeneric(list, groupId)
  if (sessions.length === 0) {
    throw new BackupError('backupIncomplete')
  }
  return sessions
}
