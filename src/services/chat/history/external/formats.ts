import type { Session } from '../../types.js'
import { BackupError } from '../errors.js'
import { fromChatGpt } from './chatgpt.js'
import { fromClaude } from './claude.js'
import { fromGemini } from './gemini.js'
import { record, toConversationList, type Loose } from './common.js'
import { fromGeneric } from './generic.js'
import { extrasFromJsonFile } from './extras.js'
import type {
  ExternalSource,
  FormatDescriptor,
  ImportBundle,
  ImportCapabilities,
  ImportWarning,
} from './models.js'
import { fromOpenWebUI } from './openwebui.js'
import { fromTurns } from './turns.js'

type Adapter = {
  source: ExternalSource
  detect: (list: unknown[]) => boolean
  parse: (list: unknown[], groupId: string) => Session[]
}

const first = (list: unknown[]): Loose | null => record(list[0])

const capabilities = {
  chatgpt: {
    branches: false,
    thinking: false,
    citations: false,
    tools: false,
    attachmentsMetadata: false,
    attachmentBytes: false,
    systemPrompt: true,
    projects: false,
    memories: true,
    splitParts: false,
  },
  gemini: {
    branches: false,
    thinking: false,
    citations: false,
    tools: false,
    attachmentsMetadata: true,
    attachmentBytes: false,
    systemPrompt: false,
    projects: false,
    memories: false,
    splitParts: false,
  },
  claude: {
    branches: true,
    thinking: true,
    citations: true,
    tools: false,
    attachmentsMetadata: true,
    attachmentBytes: false,
    systemPrompt: true,
    projects: true,
    memories: true,
    splitParts: true,
  },
  openwebui: {
    branches: true,
    thinking: false,
    citations: false,
    tools: false,
    attachmentsMetadata: false,
    attachmentBytes: false,
    systemPrompt: false,
    projects: false,
    memories: false,
    splitParts: false,
  },
  turns: {
    branches: false,
    thinking: false,
    citations: false,
    tools: false,
    attachmentsMetadata: false,
    attachmentBytes: false,
    systemPrompt: true,
    projects: false,
    memories: false,
    splitParts: false,
  },
  generic: {
    branches: false,
    thinking: false,
    citations: false,
    tools: false,
    attachmentsMetadata: false,
    attachmentBytes: false,
    systemPrompt: false,
    projects: false,
    memories: false,
    splitParts: false,
  },
} satisfies Record<ExternalSource, ImportCapabilities>

const adapters: Adapter[] = [
  {
    source: 'openwebui',
    detect: (list) => {
      const chat = record(first(list)?.chat)
      return Boolean(chat && record(record(chat.history)?.messages))
    },
    parse: (list, groupId) => fromOpenWebUI(list, groupId),
  },
  {
    source: 'chatgpt',
    detect: (list) => Boolean(record(first(list)?.mapping)),
    parse: (list, groupId) => fromChatGpt(list, groupId),
  },
  {
    source: 'claude',
    detect: (list) => Array.isArray(first(list)?.chat_messages),
    parse: (list, groupId) => fromClaude(list, groupId),
  },
  {
    source: 'gemini',
    detect: (list) => {
      const sample = first(list)
      return Boolean(
        sample &&
        (sample.header === 'Gemini Apps' ||
          ('safeHtmlItem' in sample && 'details' in sample && 'title' in sample))
      )
    },
    parse: (list, groupId) => fromGemini(list as Loose[], groupId),
  },
  {
    source: 'turns',
    detect: (list) => Array.isArray(first(list)?.turn_history),
    parse: (list, groupId) => fromTurns(list, groupId),
  },
  {
    source: 'generic',
    detect: (list) => {
      for (const key of ['messages', 'chat_history', 'history', 'turns', 'records']) {
        const messages = first(list)?.[key]
        if (Array.isArray(messages) && messages.length > 0) {
          const sample = record(messages[0])
          if (
            sample &&
            ('role' in sample || 'sender' in sample || 'from' in sample || 'is_user' in sample)
          ) {
            return true
          }
        }
      }
      return false
    },
    parse: (list, groupId) => fromGeneric(list, groupId),
  },
]

export const FORMAT_DESCRIPTORS: Record<ExternalSource, FormatDescriptor> = {
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    capabilities: capabilities.chatgpt,
    lossy: true,
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    capabilities: capabilities.claude,
    lossy: true,
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    capabilities: capabilities.gemini,
    lossy: true,
  },
  openwebui: {
    id: 'openwebui',
    label: 'Open WebUI / z.ai',
    capabilities: capabilities.openwebui,
    lossy: true,
  },
  turns: {
    id: 'turns',
    label: 'turn_history',
    capabilities: capabilities.turns,
    lossy: true,
  },
  generic: {
    id: 'generic',
    label: 'Generic JSON',
    capabilities: capabilities.generic,
    lossy: true,
  },
}

export const detectExternalSource = (parsed: unknown): ExternalSource | null => {
  const list = toConversationList(parsed)
  if (!list || list.length === 0) {
    return null
  }
  return adapters.find((adapter) => adapter.detect(list))?.source ?? null
}

const lossyWarnings = (source: ExternalSource): ImportWarning[] =>
  FORMAT_DESCRIPTORS[source].lossy
    ? [{ code: 'lossyImport', severity: 'warning', params: { format: source } }]
    : []

/** 解析一个已读取的 JSON；识别失败但存在 extras 时返回仅有附加信息的结果。 */
export const importExternalPayload = (
  name: string,
  parsed: unknown,
  groupId: string
): ImportBundle => {
  const source = detectExternalSource(parsed)
  const extras = extrasFromJsonFile(name, parsed)
  if (!source) {
    if (extras.length > 0) {
      return { format: null, sessions: [], extras, warnings: [] }
    }
    throw new BackupError('backupUnrecognized')
  }
  const list = toConversationList(parsed)
  const adapter = adapters.find((item) => item.source === source)
  if (!list || !adapter) {
    throw new BackupError('backupUnrecognized')
  }
  const sessions = adapter.parse(list, groupId)
  if (sessions.length === 0) {
    throw new BackupError('backupIncomplete')
  }
  return {
    format: source,
    sessions,
    extras,
    warnings: lossyWarnings(source),
  }
}
