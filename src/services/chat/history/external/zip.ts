import type { Session } from '../../types.js'
import { BackupError } from '../errors.js'
import { ArchiveError, isZipFile, readArchive, readEntry, skipEntry } from '../zipReader.js'
import { importExternalPayload } from './formats.js'
import { isPersonalExternalFile } from './extras.js'
import type { ExternalSource, GroupExtra, ImportWarning } from './models.js'

export type ExternalZipResult = {
  sessions: Session[]
  extras: GroupExtra[]
  warnings: ImportWarning[]
  format: ExternalSource | null
  /** 只包含被跳过的个人数据文件，没有可导入内容。 */
  ignoredOnly?: boolean
}

/** 从 ZIP 中寻找 ChatGPT / Claude / OpenWebUI 的 JSON；找不到返回 null。 */
export const externalSessionsFromZip = async (
  file: File,
  groupId: string
): Promise<ExternalZipResult | null> => {
  if (!(await isZipFile(file))) {
    return null
  }
  const sessions: Session[] = []
  const extras: GroupExtra[] = []
  const warnings = new Map<string, ImportWarning>()
  const formats: ExternalSource[] = []
  let sawPersonal = false
  let sawDeepSeek = false
  try {
    for await (const entry of readArchive(file)) {
      const lower = entry.path.toLowerCase()
      if (!lower.endsWith('.json')) {
        await skipEntry(entry)
        continue
      }
      if (isPersonalExternalFile(entry.path)) {
        sawPersonal = true
        await skipEntry(entry)
        continue
      }
      // DeepSeek 归档的会话文件与索引不参与外部格式识别。
      // 仅凭 manifest.json 不能判定为 DeepSeek：ChatGPT 导出也可能包含 manifest。
      if (lower.startsWith('chat_sessions/') || lower === 'chat_session_index.json') {
        sawDeepSeek = true
        await skipEntry(entry)
        continue
      }
      if (lower === 'manifest.json') {
        await skipEntry(entry)
        continue
      }
      // 单条 JSON 过大时跳过，避免内存风险
      if (entry.size > 256 * 1024 * 1024) {
        await skipEntry(entry)
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(await (await readEntry(entry)).text())
      } catch {
        continue
      }
      try {
        const bundle = importExternalPayload(entry.path, parsed, groupId)
        sessions.push(...bundle.sessions)
        extras.push(...bundle.extras)
        for (const warning of bundle.warnings) {
          warnings.set(`${warning.code}:${JSON.stringify(warning.params ?? {})}`, warning)
        }
        if (
          bundle.format &&
          bundle.format !== 'deepseek' &&
          bundle.format !== 'privacy' &&
          !formats.includes(bundle.format)
        ) {
          formats.push(bundle.format)
        }
      } catch (error) {
        if (error instanceof BackupError) {
          continue
        }
        throw error
      }
    }
  } catch (error) {
    if (error instanceof ArchiveError) {
      return null
    }
    throw error
  }
  // 命中 DeepSeek 归档标记时交给专用导入器，避免账号/元数据 JSON 抢占格式识别。
  if (sawDeepSeek) {
    return null
  }
  if (sessions.length > 0 || extras.length > 0) {
    return {
      sessions,
      extras,
      warnings: [...warnings.values()],
      format: formats[0] ?? null,
    }
  }
  if (sawPersonal) {
    return {
      sessions: [],
      extras: [],
      warnings: [{ code: 'noContent', severity: 'info' }],
      format: null,
      ignoredOnly: true,
    }
  }
  return null
}
