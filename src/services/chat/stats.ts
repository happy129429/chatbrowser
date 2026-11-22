import { getVisibleMessages } from './branches.js'
import * as db from './db.js'

export type ChatStats = {
  groups: number
  sessions: number
  rounds: number
  /** 各回答（含缓存）输入与输出 token 之和；全部缺失时为 null */
  tokens: number | null
  /** 思考总秒数；没有任何可计量的思考块时为 null */
  thinkSeconds: number | null
}

/** 遍历全部会话汇总统计；仅统计当前可见分支。 */
export const collectChatStats = async (): Promise<ChatStats> => {
  const [summaries, groups] = await Promise.all([db.loadSessionSummaries(), db.loadGroups()])
  let sessions = 0
  let rounds = 0
  let tokens: number | null = null
  let thinkSeconds: number | null = null
  for (const summary of summaries) {
    const session = await db.loadSession(summary.id)
    if (!session) {
      continue
    }
    sessions += 1
    for (const message of getVisibleMessages(session)) {
      if (message.role === 'user') {
        rounds += 1
        continue
      }
      const { usage } = message
      if (usage) {
        tokens =
          (tokens ?? 0) +
          usage.input_tokens +
          usage.cache_creation_input_tokens +
          usage.cache_read_input_tokens +
          usage.output_tokens
      }
      for (const block of message.blocks) {
        if (block.type !== 'thinking') {
          continue
        }
        let seconds: number | null = null
        if (block.elapsedSeconds !== undefined) {
          seconds = block.elapsedSeconds
        } else if (block.startedAt !== undefined) {
          seconds = Math.max(
            1,
            Math.round(((block.endedAt ?? message.createdAt) - block.startedAt) / 1000)
          )
        }
        if (seconds !== null) {
          thinkSeconds = (thinkSeconds ?? 0) + seconds
        }
      }
    }
  }
  return { groups: groups.length, sessions, rounds, tokens, thinkSeconds }
}

/** 思考时长的展示文案：不足 90 秒按秒，否则按分钟。 */
export const formatThinking = (
  seconds: number,
  translate: (key: 'statsSeconds' | 'statsMinutes', params?: { count: number }) => string
) =>
  seconds < 90
    ? translate('statsSeconds', { count: seconds })
    : translate('statsMinutes', { count: Math.round(seconds / 60) })
