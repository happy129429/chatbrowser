import { createId } from '../../../../utils/id.js'
import type { Session } from '../../types.js'
import { contentText, record, roleOf, toMs, toSession, type Round } from './common.js'

/** 单会话 turn_history 封装：session_metadata + metadata.sender + global_context 系统指令。 */
export const fromTurns = (parsed: unknown[], groupId: string): Session[] => {
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
