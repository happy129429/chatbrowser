import { createId } from '../../../../utils/id.js'
import { translate } from '../../../../i18n/index.js'
import { getFileViewType, isImage } from '../../../../utils/file.js'
import type { TextCitation } from '../../../api/types.js'
import type { AssistantMessage, FileAttachment, Message, Session } from '../../types.js'
import {
  contentText,
  record,
  roleOf,
  safeId,
  toMs,
  toSession,
  type Loose,
  type Round,
} from './common.js'

/** Claude content 块：正文与思考分离；text 是拼接全文，仅在缺少 content 时回退。 */
export const claudeContent = (
  message: Loose
): {
  text: string
  blocks: AssistantMessage['blocks']
  unsupported: { type: string; count: number }[]
  injected: string[]
} => {
  const raw = Array.isArray(message.content)
    ? message.content.map(record).filter((block): block is Loose => block !== null)
    : []
  const texts: string[] = []
  const thinkings: string[] = []
  const unsupported = new Map<string, number>()
  const injected: string[] = []
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
    } else if (block.type === 'injected_prompt_block') {
      // Claude 的系统提示注入（记忆快照 / system-reminder），属于会话级系统提示
      const prompt = [block.prompt, block.text, block.content].find(
        (value): value is string => typeof value === 'string' && value.trim() !== ''
      )
      if (prompt) {
        injected.push(prompt.trim())
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
    injected,
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
export const fromClaude = (parsed: unknown[], groupId: string): Session[] => {
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
      const fallbackPrompt: string[] = []
      let pendingQuestion = ''
      let pendingAt = 0
      for (const message of raw) {
        const parsed = claudeContent(message)
        const { text } = parsed
        fallbackPrompt.push(...parsed.injected)
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
        if (fallbackPrompt.length > 0) {
          session.systemPrompt = [...new Set(fallbackPrompt)].join('\n\n---\n\n')
        }
        sessions.push(session)
      }
      continue
    }

    type ClaudeNode = {
      message: Loose
      id: string
      parentUuid: string | null
      order: number
      at: number
    }
    const nodes = new Map<string, ClaudeNode>()
    raw.forEach((message, index) => {
      const baseId = message.uuid as string
      const id = nodes.has(baseId) ? `${baseId}-${index}` : baseId
      const parentUuid =
        typeof message.parent_message_uuid === 'string' &&
        message.parent_message_uuid !== CLAUDE_ROOT_UUID
          ? message.parent_message_uuid
          : null
      nodes.set(id, {
        message,
        id,
        parentUuid,
        order: index,
        at: toMs(message.created_at, createdAt),
      })
    })
    // 同一个 Claude 导出的 uuid 可能只在“前 16 个字符”内可比较：
    // 部分导出会把 parent_message_uuid 截断，或者尾部与消息 uuid 不一致。
    const UUID_MATCH_LENGTH = 16
    const normalizeId = (value: string) => value.trim().toLowerCase()
    const matchKey = (value: string) => normalizeId(value).slice(0, UUID_MATCH_LENGTH)
    const compactId = (value: string) => normalizeId(value).replace(/[^a-z0-9]/g, '')
    const byNormalized = new Map<string, string>()
    const byMatchKey = new Map<string, string[]>()
    for (const node of nodes.values()) {
      byNormalized.set(normalizeId(node.id), node.id)
      const key = matchKey(node.id)
      const list = byMatchKey.get(key)
      if (list) {
        list.push(node.id)
      } else {
        byMatchKey.set(key, [node.id])
      }
    }
    const resolveId = (reference: string | null, child?: ClaudeNode): string | null => {
      if (!reference) {
        return null
      }
      const normalized = normalizeId(reference)
      const exact = byNormalized.get(normalized)
      if (exact) {
        return exact
      }
      const keyMatches = byMatchKey.get(matchKey(reference))
      if (keyMatches && keyMatches.length === 1) {
        return keyMatches[0]
      }
      if (normalized.length >= 8) {
        const matches = [...nodes.values()]
          .filter((node) => {
            const id = normalizeId(node.id)
            const compact = compactId(node.id)
            return (
              id.startsWith(normalized) ||
              normalized.startsWith(id) ||
              compact.startsWith(compactId(reference)) ||
              compactId(reference).startsWith(compact)
            )
          })
          .map((node) => node.id)
        if (matches.length === 1) {
          return matches[0]
        }
      }
      if (keyMatches && keyMatches.length > 1) {
        // 前 16 位碰撞：优先取时间上最近、且在子消息之前的候选
        const candidates = keyMatches
          .map((id) => nodes.get(id))
          .filter((node): node is ClaudeNode => node !== undefined)
          .filter((node) => !child || node.at <= child.at)
          .sort((a, b) => b.at - a.at || b.order - a.order)
        return candidates[0]?.id ?? null
      }
      return null
    }
    const parentOf = (node: ClaudeNode) => resolveId(node.parentUuid, node)
    const parentById = new Map<string, string | null>()
    for (const node of nodes.values()) {
      parentById.set(node.id, parentOf(node))
    }
    // 个别父节点缺失时按数组顺序接到前一条消息，避免出现多个并列根节点；
    // 完全正常的父链不会进入这里。
    const ordered = [...nodes.values()].sort((a, b) => a.order - b.order)
    ordered.forEach((node, index) => {
      if (node.parentUuid !== null && parentById.get(node.id) === null) {
        parentById.set(node.id, index > 0 ? ordered[index - 1].id : null)
      }
    })

    // 从导出数组最后一条回溯当前分支，并为路径上的节点设置 selectedChildId。
    const path: string[] = []
    const seen = new Set<string>()
    let cursor: string | null = [...nodes.keys()].at(-1) ?? null
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      path.push(cursor)
      const node = nodes.get(cursor)
      cursor = node ? (parentById.get(node.id) ?? null) : null
    }
    path.reverse()
    const nextOnPath = new Map<string, string>()
    for (let i = 0; i < path.length - 1; i++) {
      nextOnPath.set(path[i], path[i + 1])
    }

    const messages: Message[] = []
    const injectedPrompts = new Set<string>()
    for (const node of nodes.values()) {
      const at = node.at
      const parentId = parentById.get(node.id) ?? null
      const selectedChildId = nextOnPath.get(node.id)
      const sender = roleOf(node.message.sender) ?? roleOf(node.message.role)
      const content = claudeContent(node.message)
      for (const prompt of content.injected) {
        injectedPrompts.add(prompt)
      }
      const unsupportedText =
        content.unsupported.length > 0
          ? translate('unsupportedBlocks', {
              types: content.unsupported.map((item) => `${item.type} ×${item.count}`).join(', '),
            })
          : ''
      if (sender === 'user') {
        messages.push({
          id: node.id,
          role: 'user',
          content: content.text,
          ...(unsupportedText ? { notice: unsupportedText } : {}),
          files: claudeFiles(node.message),
          createdAt: at,
          parentId,
          ...(selectedChildId ? { selectedChildId } : {}),
        })
      } else if (sender === 'assistant') {
        messages.push({
          id: node.id,
          role: 'assistant',
          createdAt: at,
          model: null,
          status: 'done',
          blocks: content.blocks,
          ...(unsupportedText ? { notice: unsupportedText } : {}),
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
      ...(injectedPrompts.size > 0
        ? { systemPrompt: [...injectedPrompts].join('\n\n---\n\n') }
        : {}),
    })
  }
  return sessions
}
