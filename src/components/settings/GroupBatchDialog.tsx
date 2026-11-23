import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { exportGroupSelection } from '../../services/chat/backup.js'
import { isDefaultGroup } from '../../services/chat/defaultGroup.js'
import {
  createGroup,
  mergeGroupsInto,
  mergeGroupsIntoNew,
  removeGroups,
  setGroupsColor,
  useChatStore,
} from '../../services/chat/store.js'
import type { ExportFormat, ExportMode } from '../../services/chat/exportTypes.js'
import { ExportFormatPicker } from '../export/ExportFormatPicker.js'
import { GROUP_COLORS, type GroupColor } from '../sider/groupColors.js'
import { colorDotClass } from '../sider/GroupHeader.js'
import { saveBlob } from '../../utils/saveFile.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './GroupBatch.module.css'

const COLOR_LABELS: Record<GroupColor, TranslationKey> = {
  blue: 'colorBlue',
  green: 'colorGreen',
  yellow: 'colorYellow',
  red: 'colorRed',
  purple: 'colorPurple',
  cyan: 'colorCyan',
}

const timestampName = () => {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export const GroupBatchDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const t = useTranslate()
  const groups = useChatStore((state) => state.groups)
  const sessions = useChatStore((state) => state.sessions)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeName, setMergeName] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportMode, setExportMode] = useState<ExportMode>('merged')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('deepseek')
  const [exportName, setExportName] = useState('')
  const [anonymize, setAnonymize] = useState(false)
  const [busy, setBusy] = useState(false)

  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const session of sessions) {
      if (session.groupId !== null) {
        result.set(session.groupId, (result.get(session.groupId) ?? 0) + 1)
      }
    }
    return result
  }, [sessions])

  useEffect(() => {
    if (!open) {
      return
    }
    setSelected(new Set())
    setCreating(false)
    setNewName('')
    setMergeOpen(false)
    setMergeName('')
    setDeleteOpen(false)
    setColorOpen(false)
    setExportOpen(false)
    setBusy(false)
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => groups.some((group) => group.id === id)))
      return next.size === previous.size ? previous : next
    })
  }, [groups, open])

  if (!open) {
    return null
  }

  const selectedGroups = groups.filter((group) => selected.has(group.id))
  const selectedIds = selectedGroups.map((group) => group.id)
  const selectedSessions = selectedIds.reduce((total, id) => total + (counts.get(id) ?? 0), 0)
  const selectedExtras = selectedGroups.reduce(
    (total, group) => total + (group.extras?.length ?? 0),
    0
  )
  const defaultSelected = selectedGroups.some((group) => isDefaultGroup(group.id))
  const destinationGroups = groups.filter((group) => !selected.has(group.id))
  const allSelected = groups.length > 0 && selectedGroups.length === groups.length
  const blocked = defaultSelected
  const actionDisabled = (empty: boolean) => empty || busy
  const softDisabled = blocked && selectedGroups.length > 0
  const showDefaultHint = () => {
    if (!blocked) {
      return false
    }
    showToast({ key: 'defaultGroupLockedHint' })
    return true
  }

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(groups.map((group) => group.id)))
  }

  const selectNormal = () => {
    setSelected(
      new Set(groups.filter((group) => !isDefaultGroup(group.id)).map((group) => group.id))
    )
  }

  const createBlank = async () => {
    const name = newName.trim()
    if (!name || busy) {
      return
    }
    setBusy(true)
    try {
      await createGroup(name)
      setCreating(false)
      setNewName('')
      showToast({ key: 'groupBatchCreated' })
    } catch {
      showToast({ key: 'groupOperationFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const openMerge = () => {
    if (showDefaultHint() || selectedGroups.length === 0) {
      return
    }
    setMergeOpen(true)
  }

  const openDelete = () => {
    if (showDefaultHint() || selectedGroups.length === 0) {
      return
    }
    setDeleteOpen(true)
  }

  const openExport = () => {
    if (selectedGroups.length === 0) {
      return
    }
    setExportMode('merged')
    setExportFormat('deepseek')
    setExportName(`${t('groupBatchMergedExport')} ${timestampName()}`)
    setAnonymize(false)
    setExportOpen(true)
  }

  const runMerge = async (targetId: string) => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      await mergeGroupsInto(selectedIds, targetId)
      showToast({ key: 'groupBatchMerged', params: { count: selectedIds.length } })
      setMergeOpen(false)
      setSelected(new Set())
    } catch {
      showToast({ key: 'groupOperationFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const runMergeNew = async () => {
    const name = mergeName.trim()
    if (!name || busy) {
      return
    }
    setBusy(true)
    try {
      const group = await mergeGroupsIntoNew(selectedIds, name)
      if (!group) {
        throw new Error('merge target is invalid')
      }
      showToast({ key: 'groupBatchMerged', params: { count: selectedIds.length } })
      setMergeOpen(false)
      setSelected(new Set())
    } catch {
      showToast({ key: 'groupOperationFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const runDelete = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const count = selectedIds.length
      if (!(await removeGroups(selectedIds))) {
        throw new Error('delete groups failed')
      }
      showToast({ key: 'groupBatchDeleted', params: { count } })
      setDeleteOpen(false)
      setSelected(new Set())
    } catch {
      showToast({ key: 'groupOperationFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const runColor = async (color: string | null) => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      await setGroupsColor(selectedIds, color)
      showToast({ key: 'groupBatchColored' })
      setColorOpen(false)
    } catch {
      showToast({ key: 'groupOperationFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const runExport = async () => {
    if (busy || selectedIds.length === 0) {
      return
    }
    setBusy(true)
    try {
      const results = await exportGroupSelection(selectedIds, {
        mode: exportMode,
        format: exportFormat,
        name: exportName,
        anonymize,
      })
      for (const result of results) {
        await saveBlob(result.name, result.blob)
      }
      showToast({ key: 'exportSaved' })
      setExportOpen(false)
    } catch {
      showToast({ key: 'exportFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        title={t('groupBatchTitle')}
        closable
        className={styles.dialog}
        mainClassName={styles.main}
        onClose={() => {
          if (!busy) {
            onClose()
          }
        }}
        footer={
          <Button variant="outlined" disabled={busy} onClick={onClose}>
            {t('close')}
          </Button>
        }
      >
        <div className={styles.content}>
          <div className={styles.toolbar}>
            <span className={styles.summary}>
              {t('groupBatchSummary', {
                groups: selectedGroups.length,
                sessions: selectedSessions,
              })}
            </span>
            <Button
              variant="outlined"
              size="s"
              disabled={busy}
              onClick={allSelected ? () => setSelected(new Set()) : selectAll}
            >
              {t(allSelected ? 'deselectAll' : 'selectAll')}
            </Button>
            <Button variant="outlined" size="s" disabled={busy} onClick={selectNormal}>
              {t('groupBatchOnlyNormal')}
            </Button>
            <Button
              variant="outlined"
              size="s"
              disabled={busy}
              onClick={() => setCreating((value) => !value)}
            >
              {t('groupBatchNewBlank')}
            </Button>
          </div>
          {creating ? (
            <div className={styles.createRow}>
              <input
                autoFocus
                className={styles.input}
                value={newName}
                placeholder={t('groupNamePlaceholder')}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    void createBlank()
                  }
                }}
              />
              <Button
                size="s"
                disabled={busy || newName.trim() === ''}
                onClick={() => void createBlank()}
              >
                {t('groupBatchCreate')}
              </Button>
              <Button
                variant="outlined"
                size="s"
                disabled={busy}
                onClick={() => {
                  setCreating(false)
                  setNewName('')
                }}
              >
                {t('cancel')}
              </Button>
            </div>
          ) : null}
          <div className={styles.groupList}>
            {groups.map((group) => (
              <label
                key={group.id}
                className={clsx(styles.groupRow, selected.has(group.id) && styles.groupRowSelected)}
              >
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={selected.has(group.id)}
                  onChange={() => toggle(group.id)}
                />
                <span
                  className={clsx(
                    styles.colorDot,
                    group.color ? colorDotClass(group.color) : styles.colorDotNone
                  )}
                />
                <span className={styles.groupName}>{group.name}</span>
                <span className={styles.groupMeta}>
                  {t('groupBatchRowMeta', {
                    sessions: counts.get(group.id) ?? 0,
                    extras: group.extras?.length ?? 0,
                  })}
                </span>
              </label>
            ))}
          </div>
          <div className={styles.actions}>
            <Button
              variant="outlined"
              size="m"
              disabled={actionDisabled(selectedGroups.length === 0)}
              aria-disabled={softDisabled || undefined}
              className={clsx(softDisabled && styles.softDisabled)}
              onClick={openMerge}
            >
              {t('groupBatchMerge')}
            </Button>
            <Button
              variant="outlined"
              size="m"
              disabled={actionDisabled(selectedGroups.length === 0)}
              onClick={openExport}
            >
              {t('groupBatchExport')}
            </Button>
            <Button
              variant="outlined"
              size="m"
              disabled={actionDisabled(selectedGroups.length === 0)}
              onClick={() => setColorOpen(true)}
            >
              {t('groupBatchColor')}
            </Button>
            <Button
              variant="dangerOutlined"
              size="m"
              disabled={actionDisabled(selectedGroups.length === 0)}
              aria-disabled={softDisabled || undefined}
              className={clsx(softDisabled && styles.softDisabled)}
              onClick={openDelete}
            >
              {t('groupBatchDelete')}
            </Button>
          </div>
        </div>
      </Modal>

      {mergeOpen ? (
        <Modal
          title={t('groupBatchMergeTitle')}
          closable
          className={styles.subDialog}
          onClose={() => {
            if (!busy) {
              setMergeOpen(false)
            }
          }}
          footer={
            <Button variant="outlined" disabled={busy} onClick={() => setMergeOpen(false)}>
              {t('cancel')}
            </Button>
          }
        >
          <p className={styles.hint}>{t('groupBatchMergeDescription')}</p>
          <div className={styles.targetList}>
            {destinationGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={styles.targetRow}
                disabled={busy}
                onClick={() => void runMerge(group.id)}
              >
                <span
                  className={clsx(
                    styles.colorDot,
                    group.color ? colorDotClass(group.color) : styles.colorDotNone
                  )}
                />
                <span className={styles.groupName}>{group.name}</span>
                <span className={styles.groupMeta}>
                  {t('groupBatchRowMeta', {
                    sessions: counts.get(group.id) ?? 0,
                    extras: group.extras?.length ?? 0,
                  })}
                </span>
              </button>
            ))}
            <div className={styles.createRow}>
              <input
                className={styles.input}
                value={mergeName}
                placeholder={t('groupNamePlaceholder')}
                onChange={(event) => setMergeName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    void runMergeNew()
                  }
                }}
              />
              <Button
                size="s"
                disabled={busy || mergeName.trim() === ''}
                onClick={() => void runMergeNew()}
              >
                {t('createGroup')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {deleteOpen ? (
        <Modal
          title={t('groupBatchDeleteTitle')}
          className={styles.subDialog}
          onClose={() => {
            if (!busy) {
              setDeleteOpen(false)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={busy} onClick={() => setDeleteOpen(false)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void runDelete()}>
                {t('groupBatchDelete')}
              </Button>
            </>
          }
        >
          <p className={styles.hint}>
            {t('groupBatchDeleteDescription', {
              groups: selectedGroups.length,
              sessions: selectedSessions,
              extras: selectedExtras,
            })}
          </p>
        </Modal>
      ) : null}

      {colorOpen ? (
        <Modal
          title={t('groupBatchColor')}
          closable
          className={styles.subDialog}
          onClose={() => {
            if (!busy) {
              setColorOpen(false)
            }
          }}
          footer={
            <Button variant="outlined" disabled={busy} onClick={() => setColorOpen(false)}>
              {t('cancel')}
            </Button>
          }
        >
          <div className={styles.colorGrid}>
            {GROUP_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={styles.colorOption}
                disabled={busy}
                onClick={() => void runColor(color)}
              >
                <span className={clsx(styles.colorDot, colorDotClass(color))} />
                {t(COLOR_LABELS[color])}
              </button>
            ))}
            <button
              type="button"
              className={styles.colorOption}
              disabled={busy}
              onClick={() => void runColor(null)}
            >
              <span className={clsx(styles.colorDot, styles.colorDotNone)} />
              {t('colorNone')}
            </button>
          </div>
        </Modal>
      ) : null}

      {exportOpen ? (
        <Modal
          title={t('groupBatchExportTitle')}
          closable
          className={styles.exportDialog}
          onClose={() => {
            if (!busy) {
              setExportOpen(false)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={busy} onClick={() => setExportOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                disabled={busy || (exportMode === 'merged' && exportName.trim() === '')}
                onClick={() => void runExport()}
              >
                {t(busy ? 'exporting' : 'exportRun')}
              </Button>
            </>
          }
        >
          <div className={styles.exportSummary}>
            {t('groupBatchSummary', {
              groups: selectedGroups.length,
              sessions: selectedSessions,
            })}
          </div>
          <div className={styles.sectionLabel}>{t('groupBatchExportTitle')}</div>
          <div role="radiogroup" className={styles.modeOptions}>
            {(['separate', 'merged'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={exportMode === mode}
                className={clsx(styles.modeOption, exportMode === mode && styles.modeOptionActive)}
                onClick={() => setExportMode(mode)}
              >
                {t(mode === 'separate' ? 'groupBatchExportSeparate' : 'groupBatchExportMerged')}
              </button>
            ))}
          </div>
          <div className={styles.hint}>
            {t(
              exportMode === 'merged'
                ? 'groupBatchExportMergedHint'
                : 'groupBatchExportSeparateHint'
            )}
          </div>
          {exportMode === 'merged' ? (
            <label className={styles.field}>
              <span>{t('groupBatchExportName')}</span>
              <input
                className={styles.input}
                value={exportName}
                onChange={(event) => setExportName(event.target.value)}
              />
            </label>
          ) : null}
          <div className={styles.sectionLabel}>{t('exportAs')}</div>
          <ExportFormatPicker
            format={exportFormat}
            onChange={setExportFormat}
            anonymize={anonymize}
            onAnonymizeChange={setAnonymize}
          />
        </Modal>
      ) : null}
    </>
  )
}
