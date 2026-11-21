import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconPanelLeftOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import {
  dissolveGroup,
  mergeGroups,
  moveSessionsToGroup,
  removeGroup,
  removeSession,
  renameGroup,
  setGroupColor,
  useChatStore,
} from '../../services/chat/store.js'
import { exportGroupArchive, importArchiveFiles } from '../../services/chat/backup.js'
import type { SessionGroup, SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { GroupHeader } from './GroupHeader.js'
import { openSearchOverlay } from './searchOverlayState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

const downloadBlob = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 展开的侧边栏：名称与收起按钮、打开归档、未分组会话（按时间）+ 归档组（标签页组风格）；移动端放在抽屉里 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const archiveGroups = useChatStore((state) => state.groups)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState<SessionGroup | null>(null)
  const [deleteGroupPending, setDeleteGroupPending] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  /** 正在拖拽的会话 id；组头成为放下目标 */
  const [draggingSession, setDraggingSession] = useState<string | null>(null)

  const ungrouped = useMemo(
    () => sessions.filter((session) => session.groupId === null),
    [sessions]
  )
  const timeGroups = useMemo(() => groupSessions(ungrouped, now, t), [ungrouped, now, t])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const importFiles = async (files: File[]) => {
    if (files.length === 0 || importBusy) {
      return
    }
    setImportBusy(true)
    try {
      const outcomes = await importArchiveFiles(files)
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
    } finally {
      setImportBusy(false)
    }
  }

  const exportGroup = async (group: SessionGroup) => {
    try {
      const { name, blob } = await exportGroupArchive(group.id)
      downloadBlob(name, blob)
    } catch {
      showToast({ key: 'groupOperationFailed', type: 'error' })
    }
  }

  const moveSessions = (ids: string[], groupId: string | null) => {
    void moveSessionsToGroup(ids, groupId).catch(() =>
      showToast({ key: 'groupOperationFailed', type: 'error' })
    )
  }

  const toggleCollapsed = (id: string) =>
    setCollapsedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  // Ctrl / Cmd + K 打开搜索浮层
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openSearchOverlay()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const renderSession = (session: SessionSummary) => (
    <SessionItem
      key={session.id}
      session={session}
      active={session.id === activeId}
      moveTargets={archiveGroups.filter((item) => item.id !== session.groupId)}
      onMove={
        archiveGroups.length > 0 ? (groupId) => moveSessions([session.id], groupId) : undefined
      }
      onDragStart={() => setDraggingSession(session.id)}
      onDragEnd={() => setDraggingSession(null)}
      onDelete={() => setDeleting(session)}
    />
  )

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <div className={styles.topActions}>
          <IconButton
            size="m"
            icon={<IconSearchOutline16 />}
            tooltip={t('openSearch')}
            tooltipPlacement="bottom"
            onClick={() => {
              openSearchOverlay()
              closeMobileSider()
            }}
          />
          <IconButton
            size="m"
            icon={<IconPanelLeftOutline16 />}
            tooltip={t('collapseSiderbarButton')}
            tooltipPlacement="bottom"
            onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
          />
        </div>
      </div>
      <button
        type="button"
        className={styles.newChat}
        disabled={importBusy}
        onClick={() => inputRef.current?.click()}
      >
        <span className={styles.newChatIcon}>
          <IconUploadOutline14 />
        </span>
        {t('openArchive')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          closeMobileSider()
          void importFiles(files)
        }}
      />
      <div className={styles.listWrap}>
        {' '}
        <div className={styles.list}>
          {sessions.length === 0 ? (
            <div className={styles.searchState}>{t('listEmpty')}</div>
          ) : (
            <>
              {timeGroups.map((group) => (
                <div key={group.key} className={styles.section}>
                  <div className={styles.sectionHeader}>{group.label}</div>
                  {group.sessions.map((session) => renderSession(session))}
                </div>
              ))}
              {archiveGroups.map((group) => {
                const list = sessions.filter((session) => session.groupId === group.id)
                const inner = groupSessions(list, now, t)
                return (
                  <div key={group.id} className={styles.section}>
                    <GroupHeader
                      group={group}
                      count={list.length}
                      collapsed={collapsedIds.has(group.id)}
                      otherGroups={archiveGroups.filter((item) => item.id !== group.id)}
                      droppable={draggingSession !== null}
                      onDropSession={() => {
                        if (draggingSession !== null) {
                          moveSessions([draggingSession], group.id)
                          setDraggingSession(null)
                        }
                      }}
                      onToggle={() => toggleCollapsed(group.id)}
                      onRename={(name) => renameGroup(group.id, name)}
                      onSetColor={(color) => setGroupColor(group.id, color)}
                      onMerge={(targetId) => {
                        void mergeGroups(group.id, targetId).catch(() =>
                          showToast({ key: 'groupOperationFailed', type: 'error' })
                        )
                      }}
                      onDissolve={() => {
                        void dissolveGroup(group.id).catch(() =>
                          showToast({ key: 'groupOperationFailed', type: 'error' })
                        )
                      }}
                      onExport={() => void exportGroup(group)}
                      onDelete={() => setDeletingGroup(group)}
                    />
                    {!collapsedIds.has(group.id)
                      ? inner.map((sub) => (
                          <div key={sub.key} className={styles.subSection}>
                            <div className={clsx(styles.sectionHeader, styles.groupSubHeader)}>
                              {sub.label}
                            </div>
                            {sub.sessions.map((session) => renderSession(session))}
                          </div>
                        ))
                      : null}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
      {deletingGroup ? (
        <Modal
          title={t('deleteGroupModalTitle', { name: deletingGroup.name })}
          onClose={() => {
            if (!deleteGroupPending) {
              setDeletingGroup(null)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={deleteGroupPending}
                onClick={() => setDeletingGroup(null)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deleteGroupPending}
                onClick={async () => {
                  setDeleteGroupPending(true)
                  try {
                    if (await removeGroup(deletingGroup.id)) {
                      setDeletingGroup(null)
                    } else {
                      showToast({ key: 'groupOperationFailed', type: 'error' })
                    }
                  } finally {
                    setDeleteGroupPending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteGroupModalDescription', {
            count: sessions.filter((session) => session.groupId === deletingGroup.id).length,
          })}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
