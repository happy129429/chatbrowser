import { formatDate } from '../../utils/format.js'
import { createId } from '../../utils/id.js'
import * as db from './db.js'
import { addHistoryGroup, clearAllHistory, useChatStore } from './store.js'
import { mergeGroupExtras } from './groupExtras.js'
import type { ExportFormat, ExportMode } from './exportTypes.js'
import type { Session, SessionGroup, SessionSummary } from './types.js'
import { BackupError } from './history/errors.js'
import { resolveArchiveBatches, type ArchiveBatch } from './history/external/batch.js'
import type {
  ExternalSource,
  ExternalZipResult,
  GroupExtra,
  ImportFormatId,
  ImportWarning,
} from './history/external.js'

export { BackupError } from './history/errors.js'

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个导入事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/** 逐条读取要导出的会话：已加载的用缓存快照，未打开的逐条读取，不填满详情缓存。 */
const sessionReader =
  (list: SessionSummary[]): (() => AsyncGenerator<Session>) =>
  () =>
    (async function* () {
      const { sessionCache } = useChatStore.getState()
      for (const summary of list) {
        const session = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (!session) {
          throw new Error(`History session disappeared during export: ${summary.id}`)
        }
        // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
        yield { ...session, ...summary }
      }
    })()

const downloadName = (name: string) => name.replace(/[/\\]/g, '_') || 'archive'

/** 导出全部会话为历史导出格式的 ZIP，可再次导入。 */
export const exportHistory = (): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    const { sessions } = useChatStore.getState()
    const { exportArchive } = await import('./history/exportArchive.js')
    const blob = await exportArchive(sessionReader(sessions)())
    return { name: backupFileName(new Date()), blob }
  })

/** 导出一个归档组为 ZIP；文件名取组名。extended=true 时附带 chatbrowser_ext.json。 */
export const exportGroupArchive = (
  groupId: string,
  options: { extended?: boolean; anonymize?: boolean } = {}
): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    const { sessions, groups } = useChatStore.getState()
    const group = groups.find((item) => item.id === groupId)
    const list = sessions.filter((session) => session.groupId === groupId)
    if (!group) {
      throw new Error(`Archive group is missing: ${groupId}`)
    }
    if (list.length === 0) {
      throw new Error(`Archive group is empty: ${groupId}`)
    }
    const { exportArchive } = await import('./history/exportArchive.js')
    const blob = await exportArchive(sessionReader(list)(), {
      extended: options.extended,
      anonymize: options.anonymize,
      group,
    })
    return {
      name: `${downloadName(group.name)}${options.extended ? '-ext' : ''}.zip`,
      blob,
    }
  })

/** 合并多个组为虚拟组后导出；不修改原组。 */
export const exportMergedGroupsArchive = (
  groupIds: string[],
  options: { name: string; extended?: boolean; anonymize?: boolean }
): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    const { sessions, groups } = useChatStore.getState()
    const idSet = new Set(groupIds)
    const selected = groups.filter((group) => idSet.has(group.id))
    const list = sessions.filter(
      (session) => session.groupId !== null && idSet.has(session.groupId)
    )
    if (selected.length === 0) {
      throw new Error('Archive groups are missing')
    }
    if (list.length === 0) {
      throw new Error('Archive groups are empty')
    }
    const extras = mergeGroupExtras(null, selected)
    const virtualGroup: SessionGroup = {
      id: 'merged-export',
      name: options.name.trim() || 'merged-export',
      color: null,
      sourceName: '',
      createdAt: Date.now(),
      ...(extras.length > 0 ? { extras } : {}),
    }
    const { exportArchive } = await import('./history/exportArchive.js')
    const blob = await exportArchive(sessionReader(list)(), {
      extended: options.extended,
      anonymize: options.anonymize,
      group: virtualGroup,
    })
    return {
      name: `${downloadName(virtualGroup.name)}${options.extended ? '-ext' : ''}.zip`,
      blob,
    }
  })

/** 导出单个会话为归档 ZIP；扩展模式附带系统提示词。 */
export const exportSessionArchive = (
  sessionId: string,
  options: { extended?: boolean; anonymize?: boolean } = {}
): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    const state = useChatStore.getState()
    const summary = state.sessions.find((item) => item.id === sessionId)
    const session = Object.hasOwn(state.sessionCache, sessionId)
      ? state.sessionCache[sessionId]
      : await db.loadSession(sessionId)
    if (!summary || !session) {
      throw new Error(`History session is missing: ${sessionId}`)
    }
    const group = state.groups.find((item) => item.id === session.groupId) ?? null
    const { exportArchive } = await import('./history/exportArchive.js')
    const blob = await exportArchive([{ ...session, ...summary }], {
      extended: options.extended,
      anonymize: options.anonymize,
      group,
    })
    return {
      name: `${downloadName(session.title || 'session')}${options.extended ? '-ext' : ''}.zip`,
      blob,
    }
  })

/** 导出为 Claude conversations.json（有损：仅当前分支的文本内容）。 */
export const exportClaudeJson = (target: {
  groupId?: string
  groupIds?: string[]
  name?: string
  sessionId?: string
  anonymize?: boolean
}): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    const { sessions, groups, sessionCache } = useChatStore.getState()
    const { exportClaudeJson: toClaude } = await import('./converters/claude.js')
    if (target.groupIds && target.groupIds.length > 0) {
      const idSet = new Set(target.groupIds)
      const list = sessions.filter(
        (session) => session.groupId !== null && idSet.has(session.groupId)
      )
      if (list.length === 0) {
        throw new Error('Archive groups are empty')
      }
      const blob = await toClaude(sessionReader(list)(), { anonymize: target.anonymize })
      const name = target.name?.trim() || 'merged-export'
      return { name: `${downloadName(name)}-claude.json`, blob }
    }
    if (target.groupId) {
      const group = groups.find((item) => item.id === target.groupId)
      const list = sessions.filter((session) => session.groupId === target.groupId)
      if (!group || list.length === 0) {
        throw new Error(`Archive group is empty: ${target.groupId}`)
      }
      const blob = await toClaude(sessionReader(list)(), { anonymize: target.anonymize })
      return { name: `${downloadName(group.name)}-claude.json`, blob }
    }
    const sessionId = target.sessionId
    const summary = sessions.find((item) => item.id === sessionId)
    const session = sessionId
      ? Object.hasOwn(sessionCache, sessionId)
        ? sessionCache[sessionId]
        : await db.loadSession(sessionId)
      : undefined
    if (!sessionId || !summary || !session) {
      throw new Error(`History session is missing: ${sessionId ?? ''}`)
    }
    const blob = await toClaude([{ ...session, ...summary }], { anonymize: target.anonymize })
    return { name: `${downloadName(session.title || 'session')}-claude.json`, blob }
  })

/** 按“分别/合并 + 格式”执行组批量导出，返回待保存的文件。 */
export const exportGroupSelection = async (
  groupIds: string[],
  options: { mode: ExportMode; format: ExportFormat; name?: string; anonymize?: boolean }
): Promise<{ name: string; blob: Blob }[]> => {
  const ids = [...new Set(groupIds)]
  if (ids.length === 0) {
    return []
  }
  const { sessions, groups } = useChatStore.getState()
  const byId = new Map(groups.map((group) => [group.id, group]))
  const selected = ids.map((id) => byId.get(id)).filter((group) => group !== undefined)
  if (options.mode === 'merged') {
    const name = options.name?.trim() || 'merged-export'
    return [
      options.format === 'claude'
        ? await exportClaudeJson({
            groupIds: ids,
            name,
            anonymize: options.anonymize,
          })
        : await exportMergedGroupsArchive(ids, {
            name,
            extended: options.format === 'extended',
            anonymize: options.anonymize,
          }),
    ]
  }
  const counts = new Map<string, number>()
  for (const session of sessions) {
    if (session.groupId !== null) {
      counts.set(session.groupId, (counts.get(session.groupId) ?? 0) + 1)
    }
  }
  const result: { name: string; blob: Blob }[] = []
  for (const group of selected) {
    if ((counts.get(group.id) ?? 0) === 0) {
      continue
    }
    result.push(
      options.format === 'claude'
        ? await exportClaudeJson({ groupId: group.id, anonymize: options.anonymize })
        : await exportGroupArchive(group.id, {
            extended: options.format === 'extended',
            anonymize: options.anonymize,
          })
    )
  }
  if (result.length === 0) {
    throw new Error('No chats to export')
  }
  return result
}

/** 组名取自 ZIP 文件名（去掉扩展名）。 */
const groupName = (fileName: string) => fileName.replace(/\.zip$/i, '') || fileName

type ImportOperationResult = {
  sessions: number
  format: ImportFormatId | null
  warnings: ImportWarning[]
  extras: number
  empty?: boolean
}

const emptyImport = (warnings: ImportWarning[]): ImportOperationResult => ({
  sessions: 0,
  format: null,
  warnings,
  extras: 0,
  empty: true,
})

const commitExternalGroup = async (
  group: SessionGroup,
  external: ExternalZipResult
): Promise<ImportOperationResult> => {
  if (external.extras.length > 0) {
    group.extras = external.extras
  }
  const sessions = await addHistoryGroup(group, async () => {
    for (const session of external.sessions) {
      await db.addStagingSession(session)
    }
  })
  return {
    sessions,
    format: external.format,
    warnings: external.warnings,
    extras: external.extras.length,
  }
}

/** 导入单个 ZIP 为一个新归档组；支持 DeepSeek 归档与「ZIP 包里装 JSON」的外部导出。 */
export const importArchiveFile = (file: File): Promise<ImportOperationResult> =>
  enqueueBackup(async () => {
    const group: SessionGroup = {
      id: createId(),
      name: groupName(file.name),
      color: null,
      sourceName: file.name,
      createdAt: Date.now(),
    }
    const { externalSessionsFromZip } = await import('./history/external.js')
    const external = await externalSessionsFromZip(file, group.id)
    if (external?.ignoredOnly) {
      return emptyImport(external.warnings)
    }
    if (external && (external.sessions.length > 0 || external.extras.length > 0)) {
      return commitExternalGroup(group, external)
    }
    const { readArchiveExtension } = await import('./history/extension.js')
    const extension = await readArchiveExtension(file)
    if (extension?.group) {
      if (extension.group.name && extension.group.name.trim()) {
        group.name = extension.group.name
      }
      if (extension.group.color !== undefined) {
        group.color = extension.group.color
      }
      if (extension.group.extras && extension.group.extras.length > 0) {
        group.extras = extension.group.extras
      }
    }
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    const sessions = await addHistoryGroup(group, () => importArchive(file, group.id, extension))
    return {
      sessions,
      format: 'deepseek',
      warnings: [],
      extras: group.extras?.length ?? 0,
    }
  })

/** 是否外部格式（ChatGPT / Claude / z.ai 的 JSON 导出） */
const isExternalJson = (file: File) =>
  /\.json$/i.test(file.name) || file.type === 'application/json'

/** 导入外部 JSON 为一个归档组；个人数据文件返回 empty。 */
export const importExternalFile = (file: File): Promise<ImportOperationResult> =>
  enqueueBackup(async () => {
    const { importExternalPayload, isPersonalExternalFile } = await import('./history/external.js')
    if (isPersonalExternalFile(file.name)) {
      return emptyImport([{ code: 'noContent', severity: 'info' }])
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      throw new BackupError('backupInvalidJson')
    }
    const group: SessionGroup = {
      id: createId(),
      name: groupName(file.name.replace(/\.json$/i, '') || file.name),
      color: null,
      sourceName: file.name,
      createdAt: Date.now(),
    }
    const bundle = importExternalPayload(file.name, parsed, group.id)
    return commitExternalGroup(group, {
      sessions: bundle.sessions,
      extras: bundle.extras,
      warnings: bundle.warnings,
      format:
        bundle.format && bundle.format !== 'deepseek' && bundle.format !== 'privacy'
          ? bundle.format
          : null,
    })
  })

/** 当用户一次选中同一导出的多个分卷时，合并为一个组；其它情况一个文件一个组。 */
export const groupArchiveFiles = (files: File[]): File[][] =>
  resolveArchiveBatches(files).map((batch) => batch.files)

/** 多个分卷导入为同一个归档组；会话按 ID 去重，附加信息合并。 */
const importArchiveBatch = (batch: ArchiveBatch): Promise<ImportOperationResult> =>
  enqueueBackup(async () => {
    const group: SessionGroup = {
      id: createId(),
      name: batch.name ?? groupName(batch.files[0].name),
      color: null,
      sourceName: batch.context.sourceName,
      createdAt: Date.now(),
    }
    const { externalSessionsFromZip, importExternalPayload, isPersonalExternalFile } =
      await import('./history/external.js')
    const sessions = new Map<string, Session>()
    const extras: GroupExtra[] = []
    const warnings = new Map<string, ImportWarning>()
    const formats: ExternalSource[] = []
    let sawPersonal = false

    const addBundle = (bundle: ExternalZipResult) => {
      for (const session of bundle.sessions) {
        sessions.set(session.id, session)
      }
      extras.push(...bundle.extras)
      for (const warning of bundle.warnings) {
        warnings.set(`${warning.code}:${JSON.stringify(warning.params ?? {})}`, warning)
      }
      if (bundle.format && !formats.includes(bundle.format)) {
        formats.push(bundle.format)
      }
    }

    for (const file of batch.files) {
      if (isPersonalExternalFile(file.name)) {
        sawPersonal = true
        continue
      }
      try {
        if (/\.json$/i.test(file.name)) {
          const parsed = JSON.parse(await file.text()) as unknown
          const bundle = importExternalPayload(file.name, parsed, group.id)
          addBundle({
            sessions: bundle.sessions,
            extras: bundle.extras,
            warnings: bundle.warnings,
            format: null,
          })
        } else {
          const external = await externalSessionsFromZip(file, group.id)
          if (external?.ignoredOnly) {
            sawPersonal = true
          } else if (external) {
            addBundle(external)
          }
        }
      } catch {
        // 单个分卷失败不阻止其它分卷
      }
    }
    const uniqueExtras = [
      ...new Map(extras.map((extra) => [extra.title + '\u0000' + extra.content, extra])).values(),
    ]
    if (sessions.size === 0 && uniqueExtras.length === 0) {
      if (sawPersonal) {
        return emptyImport([{ code: 'noContent', severity: 'info' }])
      }
      throw new BackupError('backupIncomplete')
    }
    if (uniqueExtras.length > 0) {
      group.extras = uniqueExtras
    }
    const count = await addHistoryGroup(group, async () => {
      for (const session of sessions.values()) {
        await db.addStagingSession(session)
      }
    })
    return {
      sessions: count,
      format: formats[0] ?? null,
      warnings: [...warnings.values()],
      extras: uniqueExtras.length,
    }
  })

/** 依次导入多个文件（ZIP 或外部 JSON）；单个失败不影响后续文件。返回逐个文件的结果。 */
export type ArchiveImportOutcome = ImportOperationResult & {
  file: File
  error?: unknown
  /** 合并导入的分卷文件（单个文件导入时缺省） */
  batch?: File[]
}

export const importArchiveFiles = async (files: File[]): Promise<ArchiveImportOutcome[]> => {
  const outcomes: ArchiveImportOutcome[] = []
  for (const batch of resolveArchiveBatches(files)) {
    if (batch.files.length > 1) {
      try {
        outcomes.push({
          file: batch.files[0],
          ...(await importArchiveBatch(batch)),
          batch: batch.files,
        })
      } catch (error) {
        outcomes.push({
          file: batch.files[0],
          sessions: 0,
          format: null,
          warnings: [],
          extras: 0,
          error,
          batch: batch.files,
        })
      }
      continue
    }
    const file = batch.files[0]
    try {
      const result = isExternalJson(file)
        ? await importExternalFile(file)
        : await importArchiveFile(file)
      outcomes.push({ file, ...result })
    } catch (error) {
      outcomes.push({ file, sessions: 0, format: null, warnings: [], extras: 0, error })
    }
  }
  return outcomes
}

/** 确认删除后调用：原子清空全部会话、归档组与附件，保留语言主题等设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await clearAllHistory()
  })
