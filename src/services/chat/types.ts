import type { TranslationMessage } from '../../i18n/index.js'
import type {
  ChatModel,
  MessageUsage,
  ServerToolBlock,
  StopDetails,
  StopReason,
  TextCitation,
} from '../api/types.js'

/**
 * 消息附件。id 是本地标识（IndexedDB files 表的主键，原件按它存储，所有引用同一 id 的消息共用一份），
 * 导入的附件沿用导出产物里的文件 ID；本地没有原件的附件只展示文件名。
 */
export type FileAttachment = {
  id: string
  name: string
  size: number
  /** 附件类别；导入时沿用归档的 is_image，不由 MIME 识别结果决定。 */
  isImage: boolean
  /** 具体 MIME；导入时没有原件或无法识别的为空字符串，不影响图片身份。 */
  mimeType: string
}

/** 本地消息的分支关系；字段缺省时按线性消息列表处理。 */
type MessageBranch = {
  parentId?: string | null
  /** 当前选中的下一条消息；切换版本时保留每条分支原有的选择。 */
  selectedChildId?: string
}

export type UserMessage = MessageBranch & {
  id: string
  role: 'user'
  content: string
  files: FileAttachment[]
  createdAt: number
}

/** 思考块：thinking_delta 累积，签名随 signature_delta 到达；历史轮次的思考服务端会丢弃，不回传 */
export type ThinkingPart = {
  type: 'thinking'
  thinking: string
  signature?: string
  /** content_block_start 的时间；没有事件时间的历史块缺省 */
  startedAt?: number
  /** content_block_stop（或回复结束）的时间 */
  endedAt?: number
  /** 仅有耗时、没有事件时间时保存秒数。 */
  elapsedSeconds?: number
}

/** 文本块：text_delta 累积，citations_delta 追加引用 */
export type TextPart = {
  type: 'text'
  text: string
  citations?: TextCitation[]
  /** 服务端提示文案，仅用于展示，不作为模型回答参与上下文或续写。 */
  isTemplate?: boolean
}

/** 服务端工具调用与结果块按协议原样保存；历史请求只回传 read_link 调用与结果 */
export type ReplyBlock = ThinkingPart | TextPart | ServerToolBlock

/**
 * done：正常结束；stopped：未完成的回复；error：请求出错。
 * pending / streaming 只会出现在旧客户端留下的本地数据里，读取时按 stopped 收尾。
 */
export type ReplyStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

export type AssistantMessage = MessageBranch & {
  id: string
  role: 'assistant'
  createdAt: number
  /** 未记录模型时为 null。 */
  model: ChatModel | null
  /** 请求时是否开启深度思考 */
  thinking?: boolean
  /** 请求时是否声明 deepseek_web_search；关闭时仍声明 deepseek_read_url */
  search?: boolean
  status: ReplyStatus
  /** 可识别的内容块按接收顺序排列 */
  blocks: ReplyBlock[]
  stopReason?: StopReason
  stopDetails?: StopDetails
  /** 最近一次请求的用量 */
  usage?: MessageUsage
  /** 旧客户端留下的请求错误；归档导入的数据不含此字段 */
  error?: {
    kind: string
    message: string
    status?: number
    localMessage?: TranslationMessage
  }
}

export type Message = UserMessage | AssistantMessage

/**
 * 归档组：一次导入的导出 ZIP 对应一个组，会话通过 groupId 归入组下。
 * 本地整理（改名、删除、移动会话）只影响本地库，不改变源文件。
 */
export type SessionGroup = {
  id: string
  name: string
  /** 标签页组风格的颜色标识；null 表示未配色 */
  color: string | null
  /** 导入时的 ZIP 文件名 */
  sourceName: string
  createdAt: number
}

export type Session = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 所属归档组；null 表示未分组 */
  groupId: string | null
  /** 置顶：在所在范围（归档组 / 未分组）顶部的小分组优先展示，可随归档迁移 */
  pinned: boolean
  /** 包含所有分支的消息，按创建顺序存储。 */
  messages: Message[]
  /** undefined 表示线性消息列表；null 表示空会话。 */
  rootMessageId?: string | null
}

/** 会话列表元数据；消息只在打开会话时加载。 */
export type SessionSummary = Pick<
  Session,
  'id' | 'title' | 'createdAt' | 'updatedAt' | 'groupId' | 'pinned'
>

/** 显式提取字段，避免将完整会话的消息带进列表。 */
export const toSessionSummary = (session: SessionSummary): SessionSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  groupId: session.groupId,
  pinned: session.pinned,
})
