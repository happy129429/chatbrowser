import type { Session } from '../../types.js'
import { importExternalPayload } from './formats.js'

/** 兼容入口：只返回会话列表；新代码应使用 importExternalPayload 拿到格式和 warnings。 */
export const externalToSessions = (parsed: unknown, groupId: string): Session[] =>
  importExternalPayload('', parsed, groupId).sessions
