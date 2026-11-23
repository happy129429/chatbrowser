import { useEffect, useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { groupArchiveFiles, importArchiveFiles } from '../../services/chat/backup.js'
import { importFormatKey } from '../../services/chat/importFormat.js'
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
  const t = useTranslate()
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
      accept=".zip,.json"
      multiple
      hidden
      onChange={(event) => {
        const files = [...(event.target.files ?? [])]
        event.target.value = ''
        if (files.length === 0 || busy) {
          return
        }
        busy = true
        const batches = groupArchiveFiles(files)
        const merged = batches.find((batch) => batch.length > 1)
        void importArchiveFiles(files)
          .then((outcomes) => {
            const imported = outcomes.reduce((count, outcome) => count + outcome.sessions, 0)
            const failed = outcomes.filter((outcome) => outcome.error).length
            const empty = outcomes.some((outcome) => outcome.empty)
            if (failed === 0 && imported === 0 && empty) {
              showToast({ key: 'archiveNoContent' })
            } else if (failed === 0) {
              const formats = [
                ...new Set(outcomes.flatMap((outcome) => (outcome.format ? [outcome.format] : []))),
              ]
              const format = formats.map((item) => t(importFormatKey(item))).join(' / ')
              const lossy = outcomes.some((outcome) =>
                outcome.warnings.some((warning) => warning.code === 'lossyImport')
              )
              if (merged) {
                showToast(
                  format
                    ? {
                        key: 'archiveBatchMergedFormat',
                        params: {
                          files: merged.length,
                          count: imported,
                          format,
                          lossy: lossy ? t('historyImportLossySuffix') : '',
                        },
                      }
                    : {
                        key: 'archiveBatchMerged',
                        params: { files: merged.length, count: imported },
                      }
                )
              } else {
                showToast(
                  format
                    ? {
                        key: imported === 1 ? 'historyImportedFormatOne' : 'historyImportedFormat',
                        params: {
                          count: imported,
                          format,
                          lossy: lossy ? t('historyImportLossySuffix') : '',
                        },
                      }
                    : {
                        key: imported === 1 ? 'historyImportedOne' : 'historyImported',
                        params: { count: imported },
                      }
                )
              }
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
