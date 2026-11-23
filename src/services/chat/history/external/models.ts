import type { Session } from '../../types.js'

/** 外部归档来源；新增来源时同时更新格式描述和测试样例。 */
export type ExternalSource = 'chatgpt' | 'claude' | 'gemini' | 'generic' | 'openwebui' | 'turns'

/** 导入结果里的格式标识，包含工具自有格式与隐私占位。 */
export type ImportFormatId = ExternalSource | 'deepseek' | 'privacy'

export type GroupExtra = { title: string; content: string }

export type ImportWarning = {
  code:
    | 'lossyImport'
    | 'personalFileSkipped'
    | 'noContent'
    | 'unrecognizedContent'
    | 'partialFailure'
  severity: 'info' | 'warning' | 'error'
  params?: Record<string, string | number>
}

/** 导入格式能力声明；用于结果展示和后续 CLI，不参与字段转换。 */
export type ImportCapabilities = {
  branches: boolean
  thinking: boolean
  citations: boolean
  tools: boolean
  attachmentsMetadata: boolean
  attachmentBytes: boolean
  systemPrompt: boolean
  projects: boolean
  memories: boolean
  splitParts: boolean
}

export type FormatDescriptor = {
  id: ImportFormatId
  label: string
  capabilities: ImportCapabilities
  lossy: boolean
}

export type ImportBundle = {
  format: ImportFormatId | null
  sessions: Session[]
  extras: GroupExtra[]
  warnings: ImportWarning[]
  ignoredOnly?: boolean
  sourceName?: string
}

export type ImportContext = {
  groupId: string
  sourceName?: string
  batchId?: string
}
