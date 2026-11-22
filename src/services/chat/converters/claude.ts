import type { Message, Session } from '../types.js'
import { getVisibleMessages } from '../branches.js'
import { anonymizeForClaude } from './anonymize.js'

const iso = (ms: number) => new Date(ms).toISOString()

/** 仅导出当前可见分支；Claude 导出格式为线性消息数组。 */
const textOf = (message: Message): string =>
  message.role === 'user'
    ? message.content
    : message.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n\n')

export const sessionsToClaude = (sessions: Session[]) =>
  sessions.map((session) => ({
    uuid: session.id,
    name: session.title,
    created_at: iso(session.createdAt),
    updated_at: iso(session.updatedAt),
    chat_messages: getVisibleMessages(session).map((message) => {
      const text = textOf(message)
      return {
        uuid: message.id,
        sender: message.role === 'user' ? 'human' : 'assistant',
        text,
        content: text ? [{ type: 'text', text }] : [],
        created_at: iso(message.createdAt),
      }
    }),
  }))

export const exportClaudeJson = async (
  sessions: Iterable<Session> | AsyncIterable<Session>,
  options: { anonymize?: boolean } = {}
): Promise<Blob> => {
  const list: unknown[] = []
  for await (const session of sessions) {
    list.push(...sessionsToClaude([options.anonymize ? anonymizeForClaude(session) : session]))
  }
  return new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' })
}
