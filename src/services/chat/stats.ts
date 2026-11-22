import { getVisibleMessages } from './branches.js'
import * as db from './db.js'

export type ChatStats = {
  groups: number
  sessions: number
  rounds: number
  /** 所有会话最终上下文 token 之和；全部缺失时为 null */
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
    const visible = getVisibleMessages(session)
    const usageOf = (message: (typeof visible)[number]) =>
      message.role === 'assistant'
        ? (message.accumulatedTokens ??
          (message.usage
            ? message.usage.input_tokens +
              message.usage.cache_creation_input_tokens +
              message.usage.cache_read_input_tokens +
              message.usage.output_tokens
            : null))
        : null
    for (const message of visible) {
      if (message.role === 'user') {
        rounds += 1
        continue
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
    // 会话的 token 总量：归档的分支累计值以最后一个回答为准（即整段上下文）；
    // 没有累计值时退回逐条求和。
    const sessionTokens =
      [...visible]
        .reverse()
        .map(usageOf)
        .find((value) => value !== null) ?? null
    if (sessionTokens !== null) {
      tokens = (tokens ?? 0) + sessionTokens
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
