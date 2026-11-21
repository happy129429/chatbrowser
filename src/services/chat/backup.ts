import { formatDate } from '../../utils/format.js'
import { createId } from '../../utils/id.js'
import * as db from './db.js'
import { addHistoryGroup, clearAllHistory, useChatStore } from './store.js'
import type { Session, SessionGroup } from './types.js'

export { BackupError } from './history/errors.js'

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个导入事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/** 导出为历史会话导出格式的 ZIP，可再次导入。 */
export const exportHistory = (): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
    const { sessions, sessionCache } = useChatStore.getState()
    async function* readSessions(): AsyncGenerator<Session> {
      for (const summary of sessions) {
        const session = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (!session) {
          throw new Error(`History session disappeared during export: ${summary.id}`)
        }
        // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
        yield { ...session, ...summary }
      }
    }
    const { exportArchive } = await import('./history/exportArchive.js')
    const now = new Date()
    const blob = await exportArchive(readSessions())
    return { name: backupFileName(now), blob }
  })

/** 组名取自 ZIP 文件名（去掉扩展名）。 */
const groupName = (fileName: string) => fileName.replace(/\.zip$/i, '') || fileName

/** 导入单个 ZIP 为一个新归档组；增量导入，失败时已有数据不变。 */
export const importArchiveFile = (file: File): Promise<number> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    const group: SessionGroup = {
      id: createId(),
      name: groupName(file.name),
      color: null,
      sourceName: file.name,
      createdAt: Date.now(),
    }
    return addHistoryGroup(group, () => importArchive(file, group.id))
  })

/** 依次导入多个 ZIP；单个失败不影响后续文件。返回逐个文件的结果。 */
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
      const sessions = await importArchiveFile(file)
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
