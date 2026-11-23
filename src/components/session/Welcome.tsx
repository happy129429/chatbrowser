import clsx from 'clsx'
import { useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { importArchiveFiles } from '../../services/chat/backup.js'
import { BackupError } from '../../services/chat/backup.js'
import { importFormatKey } from '../../services/chat/importFormat.js'
import type { ImportFormatId, ImportWarning } from '../../services/chat/history/external/index.js'
import {
  IconCheckedOutline14,
  IconCloseFill14,
  IconInfoOutline16,
  IconUploadOutline14,
  IconWarningOutline16,
} from '../base/icons.js'
import { Button } from '../base/Button.js'
import { useIsMobile } from '../../app/viewport.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 单个归档文件的导入状态 */
type ItemState = {
  name: string
  status: 'importing' | 'done' | 'warning' | 'empty' | 'error'
  sessions: number
  format?: ImportFormatId | null
  warnings: ImportWarning[]
  empty?: boolean
  /** 失败原因；预期的导入错误为对应文案 key，其余为通用失败 */
  reason?: TranslationKey
}

const ACCEPT = '.zip,.json'
const isArchive = (file: File) =>
  /\.(zip|json)$/i.test(file.name) ||
  ['application/zip', 'application/x-zip-compressed', 'application/json'].includes(file.type)

/** 欢迎页：问候语 + 归档导入入口（拖放或多选）。桌面端居中；移动端吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [items, setItems] = useState<ItemState[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = items.some((item) => item.status === 'importing')

  const importFiles = async (files: File[]) => {
    const archives = files.filter(isArchive)
    if (archives.length === 0) {
      return
    }
    setItems(
      archives.map((file) => ({
        name: file.name,
        status: 'importing',
        sessions: 0,
        warnings: [],
      }))
    )
    const outcomes = await importArchiveFiles(archives)
    setItems(
      outcomes.map(({ file, sessions, error, format, warnings, empty }) => ({
        name: file.name,
        status: error ? 'error' : empty ? 'empty' : warnings.length > 0 ? 'warning' : 'done',
        sessions,
        format,
        warnings,
        empty,
        reason:
          error instanceof BackupError ? error.key : error ? 'historyImportFailed' : undefined,
      }))
    )
  }

  return (
    <div
      className={styles.container}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        if (!busy) {
          void importFiles([...event.dataTransfer.files])
        }
      }}
    >
      {isMobile ? <MobileHeader /> : null}
      <div className={clsx(styles.welcome, dragging && styles.dragging)}>
        <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        <div className={styles.dropzone}>
          <span className={styles.dropzoneIcon}>
            <IconUploadOutline14 />
          </span>
          <span className={styles.dropzoneText}>{t('archiveDropHint')}</span>
          <Button
            variant="outlined"
            size="m"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {t('openArchive')}
          </Button>
        </div>
        {items.length > 0 ? (
          <ul className={styles.statusList}>
            {items.map((item) => (
              <li key={item.name} className={styles.statusItem}>
                <span
                  className={clsx(
                    styles.statusMark,
                    (item.status === 'done' || item.status === 'empty') && styles.statusDone,
                    item.status === 'error' && styles.statusError
                  )}
                >
                  {item.status === 'importing' ? (
                    <span className={styles.spinner} />
                  ) : item.status === 'error' ? (
                    <IconCloseFill14 />
                  ) : item.status === 'empty' ? (
                    <IconInfoOutline16 />
                  ) : item.status === 'warning' ? (
                    <IconWarningOutline16 />
                  ) : (
                    <IconCheckedOutline14 />
                  )}
                </span>
                <span className={styles.statusName} title={item.name}>
                  {item.name}
                </span>
                <span className={styles.statusDetail}>
                  {item.status === 'error'
                    ? t(item.reason ?? 'historyImportFailed')
                    : item.status === 'importing'
                      ? t('archiveImporting')
                      : [
                          item.format ? t(importFormatKey(item.format)) : '',
                          item.empty
                            ? t('historyImportEmpty')
                            : t(item.sessions === 1 ? 'historyImportedOne' : 'historyImported', {
                                count: item.sessions,
                              }) +
                              (item.warnings.some((warning) => warning.code === 'lossyImport')
                                ? t('historyImportLossySuffix')
                                : ''),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            void importFiles(files)
          }}
        />
      </div>
    </div>
  )
}
