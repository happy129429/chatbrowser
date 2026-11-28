import { translate } from '../../../../i18n/index.js'
import { createId } from '../../../../utils/id.js'
import type { AssistantMessage, FileAttachment, Session } from '../../types.js'
import { record, safeId, toMs, toSession, type Loose, type Round } from './common.js'

const GENUI_MARKUP = /<(?:grid|grid-item|box|asyncimage)\b|GenUI\.issueNewTurn|\{#each\b/i

const stripRichMarkup = (value: string): string =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()

/** 只提取标题和说明文字；按钮、事件、远程图片和 SVG 不执行。 */
const staticGenUiText = (raw: string): string => {
  const values: string[] = []
  for (const tag of ['title', 'text']) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
    for (const match of raw.matchAll(re)) {
      const value = stripRichMarkup(match[1] ?? '')
      if (value) {
        values.push(value)
      }
    }
  }
  return values.join('\n\n')
}

const chatGptSearchBlocks = (message: Loose): AssistantMessage['blocks'] => {
  const metadata = record(message.metadata)
  const groups = Array.isArray(metadata?.search_result_groups) ? metadata.search_result_groups : []
  const entries = groups.flatMap((group) => {
    const item = record(group)
    const list = Array.isArray(item?.entries) ? item.entries : []
    return list.flatMap((entry) => {
      const result = record(entry)
      if (!result || typeof result.url !== 'string' || !result.url) {
        return []
      }
      return [
        {
          type: 'web_search_result' as const,
          title: typeof result.title === 'string' ? result.title : result.url,
          url: result.url,
          snippet: typeof result.snippet === 'string' ? result.snippet : '',
          site_name:
            typeof result.attribution === 'string'
              ? result.attribution
              : typeof item?.domain === 'string'
                ? item.domain
                : null,
          site_icon: null,
          encrypted_content: '',
          page_age: null,
        },
      ]
    })
  })
  if (entries.length === 0) {
    return []
  }
  const toolId = `${typeof message.id === 'string' ? safeId(message.id) : createId()}-search`
  return [
    {
      type: 'server_tool_use',
      id: toolId,
      name: 'chatgpt_web_search',
      input: { action: 'search', queries: [] },
      caller: { type: 'direct' },
      kind: 'search',
    },
    {
      type: 'web_search_tool_result',
      tool_use_id: toolId,
      kind: 'search',
      content: entries,
    },
  ]
}

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
      sizeKnown: typeof file.size === 'number' || typeof file.file_size_bytes === 'number',
      isImage: mime.startsWith('image/') || file.is_image === true,
      mimeType: mime,
    })
  }
  return files
}

/** ChatGPT：按 current_node 回溯父链还原当前分支。 */
export const fromChatGpt = (parsed: unknown[], groupId: string): Session[] => {
  const sessions: Session[] = []
  type ConversationInfo = {
    conversationId: string
    title: string
    sessionId: string
    defaultModel?: string
    pathIds: string[]
    firstMessageIds: string[]
    lastMessageId?: string
    createdAt: number
    updatedAt: number
  }
  const infoByItem = new Map<Loose, ConversationInfo>()
  const infos: ConversationInfo[] = []
  for (const item of parsed) {
    const conversation = record(item)
    const mapping = conversation ? record(conversation.mapping) : null
    if (!conversation || !mapping) {
      continue
    }
    const conversationId = typeof conversation.id === 'string' ? conversation.id : ''
    const title =
      typeof conversation.title === 'string' && conversation.title.trim()
        ? conversation.title.trim()
        : 'ChatGPT 对话'
    const startId =
      typeof conversation.current_node === 'string'
        ? conversation.current_node
        : Object.keys(mapping).at(-1)
    const pathIds: string[] = []
    let cursor = startId
    const seen = new Set<string>()
    while (typeof cursor === 'string' && !seen.has(cursor)) {
      seen.add(cursor)
      const node = record(mapping[cursor])
      if (!node) {
        break
      }
      pathIds.push(cursor)
      cursor = typeof node.parent === 'string' ? node.parent : undefined
    }
    pathIds.reverse()
    const firstMessageIds: string[] = []
    let lastMessageId: string | undefined
    for (const nodeId of pathIds) {
      const role = record(record(record(mapping[nodeId])?.message)?.author)?.role
      if (role !== 'user' && role !== 'assistant') {
        continue
      }
      if (firstMessageIds.length < 5) {
        firstMessageIds.push(nodeId)
      }
      lastMessageId = nodeId
    }
    const info = {
      conversationId,
      title,
      sessionId: `${groupId}-chatgpt-${safeId(conversationId || createId())}`,
      defaultModel:
        typeof conversation.default_model_slug === 'string'
          ? conversation.default_model_slug
          : undefined,
      pathIds,
      firstMessageIds,
      lastMessageId,
      createdAt: toMs(conversation.create_time, 0),
      updatedAt: toMs(conversation.update_time, 0),
    }
    infoByItem.set(conversation, info)
    infos.push(info)
  }

  /** 从源会话最后一条消息续写：源的最后消息作为子会话开头的一条可见消息。 */
  const findTailSource = (child: ConversationInfo) => {
    let best: ConversationInfo | undefined
    for (const candidate of infos) {
      if (
        candidate === child ||
        !candidate.lastMessageId ||
        candidate.updatedAt > child.updatedAt ||
        !child.firstMessageIds.includes(candidate.lastMessageId) ||
        (best && candidate.updatedAt <= best.updatedAt)
      ) {
        continue
      }
      best = candidate
    }
    return best
  }

  for (const item of parsed) {
    const conversation = record(item)
    const mapping = conversation ? record(conversation.mapping) : null
    if (!conversation || !mapping) {
      continue
    }
    const info = infoByItem.get(conversation)
    if (!info) {
      continue
    }
    const startId =
      typeof conversation.current_node === 'string'
        ? conversation.current_node
        : Object.keys(mapping).at(-1)
    // 老对话的分支复制与新版 continued-from 可能是两代结构；暂时只保留有方向证据的源尾接续。
    const tailSource = findTailSource(info)
    const sourceInfo = tailSource
    const skipIds = new Set(tailSource?.lastMessageId ? [tailSource.lastMessageId] : [])
    const path: { id: string; node: Loose }[] = []
    let continuedFrom: Session['continuedFrom'] | undefined = sourceInfo
      ? {
          title: sourceInfo.title,
          conversationId: sourceInfo.conversationId,
          sourceMessageId: sourceInfo.lastMessageId ?? sourceInfo.pathIds.at(-1),
          sessionId: sourceInfo.sessionId,
        }
      : undefined
    let cursor = startId
    const seen = new Set<string>()
    while (typeof cursor === 'string' && !seen.has(cursor)) {
      seen.add(cursor)
      const node = record(mapping[cursor])
      if (!node) {
        break
      }
      path.push({ id: cursor, node })
      if (typeof node.parent === 'string') {
        cursor = node.parent
        continue
      }
      cursor = undefined
    }
    path.reverse()
    const systemParts: string[] = []
    const rounds: Round[] = []
    let pendingQuestion = ''
    let pendingAt = 0
    let pendingFiles: FileAttachment[] = []
    let pendingQuestionExternalId: string | undefined
    for (const { id: externalMessageId, node } of path) {
      if (skipIds.has(externalMessageId)) {
        continue
      }
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
      const metadata = record(message.metadata)
      const requestedModel =
        typeof metadata?.model_slug === 'string'
          ? metadata.model_slug
          : typeof metadata?.model === 'string'
            ? metadata.model
            : info.defaultModel
      const resolvedModel =
        typeof metadata?.resolved_model_slug === 'string' ? metadata.resolved_model_slug : undefined
      const richRaw = parts
        .filter((part) => typeof part !== 'string' || GENUI_MARKUP.test(part))
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
        .join('\n')
      const rich = Boolean(richRaw)
      const at = toMs(message.create_time, Date.now())
      if (role === 'user') {
        if (pendingQuestion) {
          rounds.push({
            question: pendingQuestion,
            answer: '',
            at: pendingAt,
            files: pendingFiles,
            questionExternalId: pendingQuestionExternalId,
          })
        }
        pendingQuestion = text
        pendingAt = at
        pendingFiles = chatGptAttachments(message)
        pendingQuestionExternalId = externalMessageId
      } else {
        rounds.push({
          question: pendingQuestion,
          answer: rich ? staticGenUiText(richRaw) : text,
          at: pendingAt || at,
          files: pendingFiles,
          questionExternalId: pendingQuestionExternalId,
          answerExternalId: externalMessageId,
          ...(requestedModel ? { requestedModel } : {}),
          ...(resolvedModel ? { resolvedModel } : {}),
          ...(chatGptSearchBlocks(message).length > 0
            ? { extraBlocks: chatGptSearchBlocks(message) }
            : {}),
          ...(rich
            ? {
                answerNotice: translate('genuiStaticOnly'),
                rawAnswer: richRaw,
              }
            : {}),
        })
        pendingQuestion = ''
        pendingFiles = []
        pendingQuestionExternalId = undefined
      }
    }
    if (pendingQuestion) {
      rounds.push({
        question: pendingQuestion,
        answer: '',
        at: pendingAt,
        files: pendingFiles,
        questionExternalId: pendingQuestionExternalId,
      })
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
      if (continuedFrom) {
        session.continuedFrom = continuedFrom
      }
      sessions.push(session)
    }
  }
  return sessions
}
