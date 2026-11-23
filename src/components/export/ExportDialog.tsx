import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
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
import { ExportFormatPicker } from './ExportFormatPicker.js'
import type { ExportFormat } from '../../services/chat/exportTypes.js'
import styles from './Export.module.css'

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
      <ExportFormatPicker
        format={format}
        onChange={setFormat}
        anonymize={anonymize}
        onAnonymizeChange={setAnonymize}
      />
    </Modal>
  )
}
