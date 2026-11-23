import type { Session } from '../../types.js'
import { BackupError } from '../errors.js'
import { ArchiveError, isZipFile, readArchive, readEntry } from '../zipReader.js'
import { detectExternalSource, type GroupExtra } from './common.js'
import { externalToSessions } from './dispatch.js'
import { extrasFromJsonFile } from './extras.js'

export type ExternalZipResult = { sessions: Session[]; extras: GroupExtra[] }

/** 从 ZIP 中寻找 ChatGPT / Claude 的 conversations JSON；找不到返回 null。 */
export const externalSessionsFromZip = async (
  file: File,
  groupId: string
): Promise<ExternalZipResult | null> => {
  if (!(await isZipFile(file))) {
    return null
  }
  const conversations: Session[] = []
  const extras: GroupExtra[] = []
  try {
    for await (const entry of readArchive(file)) {
      const lower = entry.path.toLowerCase()
      if (!lower.endsWith('.json')) {
        continue
      }
      // DeepSeek 归档的会话文件与索引不参与外部格式识别
      if (
        lower.startsWith('chat_sessions/') ||
        lower === 'manifest.json' ||
        lower === 'chat_session_index.json'
      ) {
        continue
      }
      // 单条 JSON 过大时跳过，避免内存风险
      if (entry.size > 256 * 1024 * 1024) {
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(await (await readEntry(entry)).text())
      } catch {
        continue
      }
      if (detectExternalSource(parsed)) {
        try {
          // 分卷导出会有 conversations-000.json、conversations-001.json…全部合并
          conversations.push(...externalToSessions(parsed, groupId))
          continue
        } catch (error) {
          if (error instanceof BackupError) {
            continue
          }
          throw error
        }
      }
      extras.push(...extrasFromJsonFile(entry.path, parsed))
    }
  } catch (error) {
    if (error instanceof ArchiveError) {
      return null
    }
    throw error
  }
  return conversations.length > 0 || extras.length > 0 ? { sessions: conversations, extras } : null
}
