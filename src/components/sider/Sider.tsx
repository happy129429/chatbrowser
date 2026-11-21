import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCloseOutline16,
  IconFolderOutline16,
  IconManageOutline16,
  IconPanelLeftOutline16,
  IconPinFill16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import {
  createGroup,
  dissolveGroup,
  mergeGroups,
  moveSessionsToGroup,
  removeGroup,
  removeSession,
  removeSessions,
  renameGroup,
  setGroupColor,
  setSessionsPinned,
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
import { colorDotClass, GroupHeader } from './GroupHeader.js'
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
  /** 多选模式：groupId 为 null 表示未分组范围 */
  const [selecting, setSelecting] = useState<{ groupId: string | null } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [moveOpen, setMoveOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [pinConfirm, setPinConfirm] = useState<boolean | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [selectionBusy, setSelectionBusy] = useState(false)

  const ungrouped = useMemo(
    () => sessions.filter((session) => session.groupId === null),
    [sessions]
  )

  /** 多选范围内展示的分区：置顶小分组 + 日期小分组。 */
  const selectionSections = useMemo(() => {
    if (!selecting) {
      return []
    }
    const scope = sessions.filter((session) =>
      selecting.groupId === null ? session.groupId === null : session.groupId === selecting.groupId
    )
    const pinnedList = scope.filter((session) => session.pinned)
    const rest = scope.filter((session) => !session.pinned)
    const sections: { key: string; label: string; sessions: SessionSummary[] }[] = []
    if (pinnedList.length > 0) {
      sections.push({ key: 'pinned', label: t('pinnedSection'), sessions: pinnedList })
    }
    sections.push(...groupSessions(rest, now, t))
    return sections
  }, [selecting, sessions, now, t])

  const toggleSelected = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  const exitSelection = () => {
    setSelecting(null)
    setSelected(new Set())
  }

  const enterSelection = (groupId: string | null) => {
    setSelecting({ groupId })
    setSelected(new Set())
  }

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

  const renderSession = (session: SessionSummary) =>
    selecting &&
    (selecting.groupId === null
      ? session.groupId === null
      : session.groupId === selecting.groupId) ? (
      <SessionItem
        key={session.id}
        session={session}
        active={session.id === activeId}
        selection={{
          checked: selected.has(session.id),
          onToggle: () => toggleSelected(session.id),
        }}
        onDelete={() => setDeleting(session)}
      />
    ) : (
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
        {selecting ? (
          <div className={styles.selectionBar}>
            <span className={styles.selectionBarLabel}>
              {t('selectionCount', { count: selected.size })}
            </span>
            <IconButton
              icon={<IconCloseOutline16 />}
              aria-label={t('cancel')}
              onClick={exitSelection}
            />
          </div>
        ) : null}
        <div className={styles.list}>
          {sessions.length === 0 ? (
            <div className={styles.searchState}>{t('listEmpty')}</div>
          ) : selecting ? (
            selectionSections.map((section) => (
              <div key={section.key} className={styles.section}>
                <div className={styles.sectionHeader}>{section.label}</div>
                {section.sessions.map((session) => renderSession(session))}
              </div>
            ))
          ) : (
            <>
              {(() => {
                const pinnedList = ungrouped.filter((session) => session.pinned)
                const rest = ungrouped.filter((session) => !session.pinned)
                const groups = groupSessions(rest, now, t)
                return (
                  <>
                    {pinnedList.length > 0 ? (
                      <div className={styles.section}>
                        <div className={styles.sectionHeader}>{t('pinnedSection')}</div>
                        {pinnedList.map((session) => renderSession(session))}
                      </div>
                    ) : null}
                    {groups.map((group, index) => (
                      <div key={group.key} className={styles.section}>
                        <div
                          className={clsx(
                            styles.sectionHeader,
                            index === 0 && ungrouped.length > 0 && styles.headerRow
                          )}
                        >
                          {group.label}
                          {index === 0 && ungrouped.length > 0 ? (
                            <span className={styles.manageIcon}>
                              <IconButton
                                icon={<IconManageOutline16 />}
                                tooltip={t('multiSelect')}
                                tooltipPlacement="bottom"
                                onClick={() => enterSelection(null)}
                              />
                            </span>
                          ) : null}
                        </div>
                        {group.sessions.map((session) => renderSession(session))}
                      </div>
                    ))}
                  </>
                )
              })()}
              {archiveGroups.map((group) => {
                const list = sessions.filter((session) => session.groupId === group.id)
                const pinnedList = list.filter((session) => session.pinned)
                const rest = list.filter((session) => !session.pinned)
                const inner = groupSessions(rest, now, t)
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
                      onMultiSelect={() => enterSelection(group.id)}
                      onDelete={() => setDeletingGroup(group)}
                    />
                    {!collapsedIds.has(group.id) ? (
                      <>
                        {pinnedList.length > 0 ? (
                          <div className={styles.subSection}>
                            <div className={clsx(styles.sectionHeader, styles.groupSubHeader)}>
                              {t('pinnedSection')}
                            </div>
                            {pinnedList.map((session) => renderSession(session))}
                          </div>
                        ) : null}
                        {inner.map((sub) => (
                          <div key={sub.key} className={styles.subSection}>
                            <div className={clsx(styles.sectionHeader, styles.groupSubHeader)}>
                              {sub.label}
                            </div>
                            {sub.sessions.map((session) => renderSession(session))}
                          </div>
                        ))}
                      </>
                    ) : null}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
      {selecting ? (
        <div className={styles.selectionActions}>
          <button
            type="button"
            className={styles.selectionButton}
            disabled={selected.size === 0 || archiveGroups.length === 0}
            onClick={() => setMoveOpen(true)}
          >
            <IconFolderOutline16 />
            {t('moveToGroup')}
          </button>
          {(() => {
            const chosen = sessions.filter((session) => selected.has(session.id))
            const allPinned = chosen.length > 0 && chosen.every((session) => session.pinned)
            return (
              <button
                type="button"
                className={styles.selectionButton}
                disabled={selected.size === 0}
                onClick={() => setPinConfirm(!allPinned)}
              >
                <IconPinFill16 />
                {allPinned ? t('unpin') : t('pin')}
              </button>
            )
          })()}
          <button
            type="button"
            className={clsx(styles.selectionButton, styles.selectionButtonDanger)}
            disabled={selected.size === 0}
            onClick={() => setDeleteConfirm(true)}
          >
            <IconTrashOutline16 />
            {t('delete')}
          </button>
        </div>
      ) : null}
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
      {moveOpen ? (
        <Modal
          title={t('moveToGroup')}
          onClose={() => {
            if (!selectionBusy) {
              setMoveOpen(false)
              setNewGroupName('')
            }
          }}
        >
          <div className={styles.moveGroupList}>
            {archiveGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={styles.moveGroupItem}
                disabled={selectionBusy}
                onClick={async () => {
                  setSelectionBusy(true)
                  try {
                    await moveSessionsToGroup([...selected], group.id)
                    setMoveOpen(false)
                    setNewGroupName('')
                    exitSelection()
                  } catch {
                    showToast({ key: 'groupOperationFailed', type: 'error' })
                  } finally {
                    setSelectionBusy(false)
                  }
                }}
              >
                <span className={clsx(styles.groupDot, colorDotClass(group.color))} />
                <span className={styles.moveGroupName}>{group.name}</span>
              </button>
            ))}
            <div className={styles.moveGroupCreate}>
              <input
                type="text"
                className={styles.moveGroupInput}
                value={newGroupName}
                placeholder={t('groupNamePlaceholder')}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.currentTarget.blur()
                  }
                }}
              />
              <Button
                variant="outlined"
                size="s"
                disabled={selectionBusy || newGroupName.trim() === ''}
                onClick={async () => {
                  setSelectionBusy(true)
                  try {
                    const group = await createGroup(newGroupName.trim())
                    await moveSessionsToGroup([...selected], group.id)
                    setMoveOpen(false)
                    setNewGroupName('')
                    exitSelection()
                  } catch {
                    showToast({ key: 'groupOperationFailed', type: 'error' })
                  } finally {
                    setSelectionBusy(false)
                  }
                }}
              >
                {t('createGroup')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
      {pinConfirm !== null ? (
        <Modal
          title={
            pinConfirm
              ? t('pinConfirmTitle', { count: selected.size })
              : t('unpinConfirmTitle', { count: selected.size })
          }
          onClose={() => {
            if (!selectionBusy) {
              setPinConfirm(null)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={selectionBusy}
                onClick={() => setPinConfirm(null)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={selectionBusy}
                onClick={async () => {
                  setSelectionBusy(true)
                  const count = selected.size
                  try {
                    await setSessionsPinned([...selected], pinConfirm)
                    showToast({
                      key: pinConfirm ? 'pinnedToast' : 'unpinnedToast',
                      params: { count },
                    })
                    setPinConfirm(null)
                    exitSelection()
                  } catch {
                    showToast({ key: 'groupOperationFailed', type: 'error' })
                  } finally {
                    setSelectionBusy(false)
                  }
                }}
              >
                {pinConfirm ? t('pin') : t('unpin')}
              </Button>
            </>
          }
        />
      ) : null}
      {deleteConfirm ? (
        <Modal
          title={t('deleteSelectedTitle', { count: selected.size })}
          onClose={() => {
            if (!selectionBusy) {
              setDeleteConfirm(false)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={selectionBusy}
                onClick={() => setDeleteConfirm(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={selectionBusy}
                onClick={async () => {
                  setSelectionBusy(true)
                  try {
                    if (await removeSessions([...selected])) {
                      setDeleteConfirm(false)
                      exitSelection()
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setSelectionBusy(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSelectedDesc')}
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
