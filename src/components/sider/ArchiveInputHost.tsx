import { useEffect, useRef } from 'react'
import { importArchiveFiles } from '../../services/chat/backup.js'
import { showToast } from '../base/toastState.js'

let open: (() => void) | null = null
let busy = false

/** 任意入口（展开/收起侧栏等）打开归档文件选择器；input 需常驻挂载，动态创建的选择器不弹出。 */
export const openArchivePicker = () => {
  if (!busy) {
    open?.()
  }
}

/** 全局唯一的隐藏文件输入：选择后批量导入并用 toast 汇总结果。 */
export const ArchiveInputHost = () => {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    open = () => inputRef.current?.click()
    return () => {
      open = null
    }
  }, [])
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".zip,application/zip,application/x-zip-compressed"
      multiple
      hidden
      onChange={(event) => {
        const files = [...(event.target.files ?? [])]
        event.target.value = ''
        if (files.length === 0 || busy) {
          return
        }
        busy = true
        void importArchiveFiles(files)
          .then((outcomes) => {
            const imported = outcomes.reduce((count, outcome) => count + outcome.sessions, 0)
            const failed = outcomes.filter((outcome) => outcome.error).length
            if (failed === 0) {
              showToast({
                key: imported === 1 ? 'historyImportedOne' : 'historyImported',
                params: { count: imported },
              })
            } else {
              showToast({ key: 'archiveImportPartial', params: { failed, total: outcomes.length } })
            }
          })
          .finally(() => {
            busy = false
          })
      }}
    />
  )
}
