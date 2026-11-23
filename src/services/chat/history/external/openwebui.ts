import { createId } from '../../../../utils/id.js'
import type { Session } from '../../types.js'
import { contentText, record, roleOf, toMs, toSession, type Loose, type Round } from './common.js'

/** OpenWebUI / z.ai 原生：chat.history.messages 对象树 + currentId（支持分支）。 */
export const fromOpenWebUI = (parsed: unknown[], groupId: string): Session[] => {
  const sessions: Session[] = []
  for (const item of parsed) {
    const conversation = record(item)
    const chat = conversation ? record(conversation.chat) : null
    const history = chat ? record(chat.history) : null
    const map = history ? record(history.messages) : null
    if (!conversation || !chat || !history || !map) {
      continue
    }
    const entries = Object.entries(map)
      .map(([key, value]) => ({ key, message: record(value) }))
      .filter((entry): entry is { key: string; message: Loose } => entry.message !== null)
    if (entries.length === 0) {
      continue
    }
    // 先按 currentId 回溯父链；脱敏样本里 id/父链被破坏时退回时间顺序
    const path: Loose[] = []
    const seen = new Set<string>()
    let broken = false
    const exists = (id: string) =>
      entries.some((entry) => entry.key === id || entry.message.id === id)
    let cursor: string | undefined =
      typeof history.currentId === 'string' ? history.currentId : undefined
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const hit = entries.find((entry) => entry.key === cursor || entry.message.id === cursor)
      if (!hit) {
        broken = true
        break
      }
      path.push(hit.message)
      const parent = hit.message.parentId
      cursor = typeof parent === 'string' ? parent : undefined
      if (cursor && !exists(cursor)) {
        broken = true
      }
    }
    path.reverse()
    // 父链断裂（脱敏/字段缺失）时用全量时间顺序，避免只导入分支末端的一两轮
    const ordered =
      !broken && path.length >= 2
        ? path
        : entries
            .map((entry) => entry.message)
            .sort((a, b) => toMs(a.timestamp, 0) - toMs(b.timestamp, 0))
    const rounds: Round[] = []
    let pendingQuestion = ''
    let pendingAt = 0
    for (const message of ordered) {
      const role = roleOf(message.role)
      const text = contentText(message.content ?? message.text)
      if (!role || !text.trim()) {
        continue
      }
      const at = toMs(message.timestamp, Date.now())
      if (role === 'user') {
        if (pendingQuestion) {
          rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
        }
        pendingQuestion = text
        pendingAt = at
      } else if (role === 'assistant') {
        rounds.push({ question: pendingQuestion, answer: text, at: pendingAt || at })
        pendingQuestion = ''
      }
    }
    if (pendingQuestion) {
      rounds.push({ question: pendingQuestion, answer: '', at: pendingAt })
    }
    const rawId =
      (typeof conversation.id === 'string' && conversation.id) ||
      (typeof chat.id === 'string' && chat.id) ||
      createId()
    const session = toSession(
      'openwebui',
      groupId,
      rawId,
      (typeof conversation.title === 'string' && conversation.title.trim()) || '导入的对话',
      toMs(conversation.created_at ?? conversation.timestamp, Date.now()),
      toMs(conversation.updated_at ?? conversation.timestamp, Date.now()),
      rounds
    )
    if (session) {
      sessions.push(session)
    }
  }
  return sessions
}
