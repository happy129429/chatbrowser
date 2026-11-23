import { createId } from '../../../../utils/id.js'
import type { Session } from '../../types.js'
import { contentText, record, roleOf, toMs, toSession, type Round } from './common.js'

/** 通用格式（z.ai 等）：按 messages 顺序配对提问与回答，system 归入系统提示。 */
export const fromGeneric = (list: unknown[], groupId: string): Session[] => {
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
