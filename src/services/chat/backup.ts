import { formatDate } from '../../utils/format.js'
import { createId } from '../../utils/id.js'
import * as db from './db.js'
import { addHistoryGroup, clearAllHistory, useChatStore } from './store.js'
import type { Session, SessionGroup, SessionSummary } from './types.js'
import { BackupError } from './history/errors.js'

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

/** 导出一个归档组为 ZIP；文件名取组名。 */
export const exportGroupArchive = (groupId: string): Promise<{ name: string; blob: Blob }> =>
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
    const blob = await exportArchive(sessionReader(list)())
    return { name: `${downloadName(group.name)}.zip`, blob }
  })

/** 组名取自 ZIP 文件名（去掉扩展名）。 */
const groupName = (fileName: string) => fileName.replace(/\.zip$/i, '') || fileName

/** 导入单个 ZIP 为一个新归档组；支持 DeepSeek 归档与「ZIP 包里装 JSON」的 ChatGPT / Claude 导出。 */
export const importArchiveFile = (file: File): Promise<number> =>
  enqueueBackup(async () => {
    const group: SessionGroup = {
      id: createId(),
      name: groupName(file.name),
      color: null,
      sourceName: file.name,
      createdAt: Date.now(),
    }
    // 先探测 ZIP 内是否含 ChatGPT / Claude 的 conversations JSON
    const { externalSessionsFromZip } = await import('./history/external.js')
    const external = await externalSessionsFromZip(file, group.id)
    if (external && external.sessions.length > 0) {
      if (external.extras.length > 0) {
        group.extras = external.extras
      }
      return addHistoryGroup(group, async () => {
        for (const session of external.sessions) {
          await db.addStagingSession(session)
        }
      })
    }
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    return addHistoryGroup(group, () => importArchive(file, group.id))
  })

/** 是否外部格式（ChatGPT / Claude 的 JSON 导出） */
const isExternalJson = (file: File) =>
  /\.json$/i.test(file.name) || file.type === 'application/json'

/** 导入 ChatGPT / Claude 导出的 JSON 为一个归档组。返回导入的会话数。 */
export const importExternalFile = (file: File): Promise<number> =>
  enqueueBackup(async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      throw new BackupError('backupInvalidJson')
    }
    const { externalToSessions } = await import('./history/external.js')
    const group: SessionGroup = {
      id: createId(),
      name: groupName(file.name.replace(/\.json$/i, '') || file.name),
      color: null,
      sourceName: file.name,
      createdAt: Date.now(),
    }
    return addHistoryGroup(group, async () => {
      const sessions = externalToSessions(parsed, group.id)
      for (const session of sessions) {
        await db.addStagingSession(session)
      }
    })
  })

/** 依次导入多个文件（ZIP 或外部 JSON）；单个失败不影响后续文件。返回逐个文件的结果。 */
export type ArchiveImportOutcome = {
  file: File
  /** 成功导入的会话数；失败为 0 */
  sessions: number
  error?: unknown
}

export const importArchiveFiles = async (files: File[]): Promise<ArchiveImportOutcome[]> => {
  const outcomes: ArchiveImportOutcome[] = []
  for (const file of files) {
    try {
      const sessions = isExternalJson(file)
        ? await importExternalFile(file)
        : await importArchiveFile(file)
      outcomes.push({ file, sessions })
    } catch (error) {
      outcomes.push({ file, sessions: 0, error })
    }
  }
  return outcomes
}

/** 确认删除后调用：原子清空全部会话、归档组与附件，保留语言主题等设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await clearAllHistory()
  })
