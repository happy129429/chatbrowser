/**
 * Messages API（Anthropic 兼容格式）协议类型，只取展示导出数据所需的部分。
 * 文档：https://api-docs.deepseek.com/zh-cn/api/create-message
 */

export type ChatModel = 'deepseek-flash' | 'deepseek-v4-pro'

/** 正文引用：服务端把模型的引用标记还原为来源，挂在对应文本块上 */
export type TextCitation = {
  type: 'web_search_result_location'
  url: string
  /** 查不到标题时为 null */
  title: string | null
  /** 当前文本块截至该引用处的全部正文（去除首尾空白） */
  cited_text: string
  /** 恒为空串 */
  encrypted_index: string
}

/** 服务端识别调用所属联网能力用的 kind，区分文字搜索、图搜及边想边搜。 */
export type ServerToolKind =
  | 'search'
  | 'deep_search'
  | 'read_link'
  | 'image_search'
  | 'deep_image_search'

/** server_tool_use 的四种动作，input 结构由 action 决定 */
export type ServerToolInput =
  | { action: 'search'; query?: string; queries: string[] }
  | { action: 'open_page'; url: string }
  /** 找不到关联页面时 url 为空串 */
  | { action: 'find_in_page'; url: string; pattern: string }
  | { action: 'read_link'; url: string }

/** 服务端工具调用块：原子下发，content_block_start 即携带完整 input */
export type ServerToolUseBlock = {
  type: 'server_tool_use'
  /** srvtoolu_{s|ds|rl|is|dis}_{序号}_{32 位 hex} */
  id: string
  /** 文字搜索与图搜均为 deepseek_web_search；read_link 为 deepseek_read_url */
  name: 'deepseek_web_search' | 'deepseek_read_url'
  input: ServerToolInput
  caller: { type: 'direct' }
  kind: ServerToolKind
}

export type WebSearchResult = {
  type: 'web_search_result'
  title: string
  url: string
  /** 图搜召回的原站图片地址，可能缺省；仅保存，当前不展示图片。 */
  image_url?: string
  /** 可直接展示的网页摘要 */
  snippet: string
  /** 站点图标 URL；无法取得注册域名时为 null */
  site_icon: string | null
  /** 无站点名称时为 null */
  site_name: string | null
  /** 搜索摘要经 AES-256-GCM 加密后的 Base64，客户端无法解密展示 */
  encrypted_content: string
  /** RFC 3339 UTC 时间，没有发布时间时为 null */
  page_age: string | null
}

export type WebSearchToolResultError = {
  type: 'web_search_tool_result_error'
  error_code: 'unavailable'
}

export type WebSearchToolResultBlock = {
  type: 'web_search_tool_result'
  tool_use_id: string
  /** 成功且无可见结果时为 []；失败时为只含一个错误项的数组 */
  content: (WebSearchResult | WebSearchToolResultError)[]
  kind: 'search' | 'deep_search' | 'image_search' | 'deep_image_search'
}

export type WebFetchResult = {
  type: 'web_fetch_result'
  url: string
  content: {
    type: 'document'
    /** read_link / deep_search 均为空串；阅读链接的页面加密在结果块的 signature 中 */
    source: { type: 'text'; media_type: 'text/plain'; data: string }
    title: string | null
  }
  /** read_link 为网页解析出的原始日期字符串；deep_search 为 RFC 3339 */
  published_at: string | null
}

export type WebFetchToolResultError = {
  type: 'web_fetch_tool_result_error'
  /** url_not_accessible 抓取失败；url_not_allowed 被拦截；unavailable 服务异常或未完成就结束 */
  error_code: 'url_not_accessible' | 'url_not_allowed' | 'unavailable'
}

export type WebFetchToolResultBlock = {
  type: 'web_fetch_tool_result'
  tool_use_id: string
  content: WebFetchResult | WebFetchToolResultError
  kind: 'read_link' | 'deep_search'
  /** 仅 read_link 成功时返回的加密页面，多轮请求原样回传；失败及 deep_search 不返回 */
  signature?: string
}

export type ServerToolBlock =
  | ServerToolUseBlock
  | WebSearchToolResultBlock
  | WebFetchToolResultBlock

export type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'refusal'

export type StopDetails = { type: 'refusal'; category: null; explanation: null }

export type MessageUsage = {
  /** 未命中缓存的输入 Token */
  input_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  /** message_start 中为 0，message_delta 中为全轮累计值 */
  output_tokens: number
  /** 仅当 message_delta 中有对外输出的搜索结果块时出现 */
  server_tool_use?: { web_search_requests: number; tool_search: number }
}
