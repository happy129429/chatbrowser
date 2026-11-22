import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  exportClaudeJson,
  exportGroupArchive,
  exportSessionArchive,
} from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
import { saveBlob } from '../../utils/saveFile.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { closeExport, useExportDialog, type ExportTarget } from './exportDialogState.js'
import styles from './Export.module.css'

type ExportFormat = 'deepseek' | 'extended' | 'claude'

const formats: {
  value: ExportFormat
  label: TranslationKey
  description: TranslationKey
  lossy?: boolean
}[] = [
  { value: 'deepseek', label: 'exportFormatDeepseek', description: 'exportFormatDeepseekDesc' },
  {
    value: 'extended',
    label: 'exportFormatExtended',
    description: 'exportFormatExtendedDesc',
  },
  {
    value: 'claude',
    label: 'exportFormatClaude',
    description: 'exportFormatClaudeDesc',
    lossy: true,
  },
]

export const ExportDialog = () => {
  const target = useExportDialog((state) => state.target)
  return target ? <ExportContent target={target} /> : null
}

const ExportContent = ({ target }: { target: ExportTarget }) => {
  const t = useTranslate()
  const [format, setFormat] = useState<ExportFormat>('deepseek')
  const [anonymize, setAnonymize] = useState(false)
  const [busy, setBusy] = useState(false)
  const group = useChatStore((state) =>
    target.kind === 'group'
      ? state.groups.find((item) => item.id === target.id)
      : state.sessions.find((item) => item.id === target.id)
  )
  const title = group && 'title' in group ? group.title : group?.name

  const run = async () => {
    setBusy(true)
    try {
      const result =
        target.kind === 'group'
          ? format === 'claude'
            ? await exportClaudeJson({ groupId: target.id, anonymize })
            : await exportGroupArchive(target.id, {
                extended: format === 'extended',
                anonymize,
              })
          : format === 'claude'
            ? await exportClaudeJson({ sessionId: target.id, anonymize })
            : await exportSessionArchive(target.id, {
                extended: format === 'extended',
                anonymize,
              })
      const saved = await saveBlob(result.name, result.blob)
      if (saved === 'saved') {
        showToast({ key: 'exportSaved' })
      }
      closeExport()
    } catch {
      showToast({ key: 'exportFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('exportAs')}
      closable
      className={styles.dialog}
      onClose={closeExport}
      footer={
        <>
          <Button variant="outlined" disabled={busy} onClick={closeExport}>
            {t('cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void run()}>
            {t(busy ? 'exporting' : 'exportRun')}
          </Button>
        </>
      }
    >
      <div className={styles.target}>
        <span className={styles.targetLabel}>
          {t(target.kind === 'group' ? 'exportTargetGroup' : 'exportTargetSession')}
        </span>
        <span className={styles.targetName}>{title ?? '—'}</span>
      </div>
      <div role="radiogroup" className={styles.options}>
        {formats.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={format === item.value}
            className={clsx(styles.option, format === item.value && styles.optionActive)}
            onClick={() => setFormat(item.value)}
          >
            <span className={styles.optionText}>
              <span className={styles.optionLabel}>
                {t(item.label)}
                {item.lossy ? <span className={styles.lossy}>{t('exportLossy')}</span> : null}
              </span>
              <span className={styles.optionDescription}>{t(item.description)}</span>
            </span>
            <span className={styles.radio} aria-hidden />
          </button>
        ))}
      </div>
      <label className={styles.anonymize}>
        <input
          type="checkbox"
          checked={anonymize}
          onChange={(event) => setAnonymize(event.target.checked)}
        />
        <span className={styles.optionText}>
          <span className={styles.optionLabel}>{t('exportAnonymize')}</span>
          <span className={styles.optionDescription}>{t('exportAnonymizeDesc')}</span>
        </span>
      </label>
    </Modal>
  )
}
