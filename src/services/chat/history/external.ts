import { createId } from '../../../utils/id.js'
import { ArchiveError, isZipFile, readArchive, readEntry } from './zipReader.js'
import type { AssistantMessage, Message, Session, UserMessage } from '../types.js'
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
    // 先按 currentId 回溯父链；脱敏样本里 id 被替换时退回时间顺序
    const path: Loose[] = []
    const seen = new Set<string>()
    let cursor: string | undefined =
      typeof history.currentId === 'string' ? history.currentId : undefined
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const hit = entries.find((entry) => entry.key === cursor || entry.message.id === cursor)
      if (!hit) {
        break
      }
      path.push(hit.message)
      cursor = typeof hit.message.parentId === 'string' ? hit.message.parentId : undefined
    }
    path.reverse()
    const ordered =
      path.length >= 2
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

type Round = { question: string; answer: string; at: number }

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
  const usable = rounds.filter((round) => round.question.trim() || round.answer.trim())
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
    if (round.answer.trim()) {
      const reply: AssistantMessage = {
        id: `${rawId}-a${index}`,
        role: 'assistant',
        createdAt: roundAt + 1,
        model: null,
        status: 'done',
        blocks: [{ type: 'text', text: round.answer.trim() }],
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

/** Claude：chat_messages 即有序轮次。 */
const fromClaude = (parsed: unknown[], groupId: string): Session[] => {
  const sessions: Session[] = []
  for (const item of parsed) {
    const conversation = record(item)
    const list =
      conversation && Array.isArray(conversation.chat_messages) ? conversation.chat_messages : null
    if (!conversation || !list) {
      continue
    }
    const rounds: Round[] = []
    let pendingQuestion = ''
    let pendingAt = 0
    for (const entry of list) {
      const message = record(entry)
      if (!message) {
        continue
      }
      // 真实导出里 text 可能是空字符串而正文在 content:[{type:'text',text}] 中
      const text = contentText(message.text) || contentText(message.content)
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
    const session = toSession(
      'claude',
      groupId,
      typeof conversation.uuid === 'string' ? conversation.uuid : createId(),
      typeof conversation.name === 'string' && conversation.name.trim()
        ? conversation.name
        : 'Claude 对话',
      toMs(conversation.created_at, Date.now()),
      toMs(conversation.updated_at, Date.now()),
      rounds
    )
    if (session) {
      sessions.push(session)
    }
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
  if (lower.endsWith('projects.json') && Array.isArray(parsed)) {
    for (const item of parsed) {
      const project = record(item)
      if (!project) {
        continue
      }
      const prompt = typeof project.prompt_template === 'string' ? project.prompt_template : ''
      if (prompt.trim()) {
        extras.push({
          title: `项目：${typeof project.name === 'string' ? project.name : '未命名项目'}`,
          content: prompt.trim(),
        })
      }
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
