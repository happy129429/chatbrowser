import type { AssistantMessage, Session } from '../types.js'
import { getVisibleMessages } from '../branches.js'
import { anonymizeForClaude } from './anonymize.js'

const iso = (ms: number) => new Date(ms).toISOString()
const CLAUDE_ROOT_UUID = '00000000-0000-4000-8000-000000000000'

const assistantContent = (message: AssistantMessage) => {
  const content: unknown[] = []
  let flattened = ''
  for (const block of message.blocks) {
    if (block.type === 'thinking') {
      flattened += `${block.thinking}\n\n`
      content.push({
        type: 'thinking',
        thinking: block.thinking,
        summaries: block.hidden ? [{ summary: block.thinking }] : [],
        start_timestamp:
          block.startedAt !== undefined ? iso(block.startedAt) : iso(message.createdAt),
        stop_timestamp: block.endedAt !== undefined ? iso(block.endedAt) : iso(message.createdAt),
        flags: null,
        cut_off: block.truncated === true,
        truncated: block.truncated === true,
        hidden: block.hidden === true,
        thinking_hidden: block.hidden === true,
        alternative_display_type: null,
        signature: block.signature ?? null,
      })
    } else if (block.type === 'text') {
      flattened += block.text
      content.push({
        type: 'text',
        text: block.text,
        citations: block.citations ?? [],
      })
    }
  }
  return { content, flattened: flattened.trim() }
}

export const sessionsToClaude = (sessions: Session[]) =>
  sessions.map((session) => {
    const visible = getVisibleMessages(session)
    return {
      uuid: session.id,
      name: session.title,
      ...(session.summary ? { summary: session.summary } : {}),
      created_at: iso(session.createdAt),
      updated_at: iso(session.updatedAt),
      account: { uuid: 'exported' },
      chat_messages: visible.map((message, index) => {
        const parent = index > 0 ? visible[index - 1].id : CLAUDE_ROOT_UUID
        if (message.role === 'user') {
          return {
            uuid: message.id,
            text: message.content,
            content: [{ type: 'text', text: message.content, citations: [] }],
            sender: 'human',
            created_at: iso(message.createdAt),
            updated_at: iso(message.createdAt),
            attachments: [],
            files: message.files.map((file) => ({
              file_uuid: file.id,
              file_name: file.name,
            })),
            parent_message_uuid: parent,
          }
        }
        const { content, flattened } = assistantContent(message)
        return {
          uuid: message.id,
          text: flattened,
          content,
          sender: 'assistant',
          created_at: iso(message.createdAt),
          updated_at: iso(message.createdAt),
          attachments: [],
          files: [],
          parent_message_uuid: parent,
        }
      }),
    }
  })

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
