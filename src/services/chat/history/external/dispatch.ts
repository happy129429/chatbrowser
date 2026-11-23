import type { Session } from '../../types.js'
import { BackupError } from '../errors.js'
import { detectExternalSource, toConversationList } from './common.js'
import { fromChatGpt } from './chatgpt.js'
import { fromClaude } from './claude.js'
import { fromGeneric } from './generic.js'
import { fromOpenWebUI } from './openwebui.js'
import { fromTurns } from './turns.js'

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
