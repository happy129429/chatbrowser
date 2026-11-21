import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCloseOutline16,
  IconPanelLeftOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { searchSessions, type SearchHit } from '../../services/chat/search.js'
import {
  dissolveGroup,
  mergeGroups,
  moveSessionsToGroup,
  openSessionMessage,
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

/** 高亮片段：\x00 包裹的命中词渲染为 mark。 */
const Snippet = ({ text }: { text: string }) => {
  const [before, marked, after] = text.split('\x00')
  return (
    <span className={styles.searchHitSnippet}>
      {before}
      {marked !== undefined ? <mark>{marked}</mark> : null}
      {after}
    </span>
  )
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

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [scanning, setScanning] = useState(false)
  const searchAbortRef = useRef<AbortController | null>(null)

  // 搜索防抖；新查询中止上一轮扫描。
  useEffect(() => {
    const trimmed = query.trim()
    searchAbortRef.current?.abort()
    if (trimmed === '') {
      setHits([])
      setScanning(false)
      return
    }
    setScanning(true)
    setHits([])
    const controller = new AbortController()
    searchAbortRef.current = controller
    const timer = setTimeout(() => {
      void searchSessions(useChatStore.getState().sessions, trimmed, {
        signal: controller.signal,
        onProgress: ({ hits: progressHits, scanned, total }) => {
          if (!controller.signal.aborted) {
            setHits([...progressHits])
            setScanning(scanned < total)
          }
        },
      }).finally(() => {
        if (!controller.signal.aborted) {
          setScanning(false)
        }
      })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

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

  const renderSession = (session: SessionSummary) => (
    <SessionItem
      key={session.id}
      session={session}
      active={session.id === activeId}
      moveTargets={archiveGroups.filter((item) => item.id !== session.groupId)}
      onMove={
        archiveGroups.length > 0 ? (groupId) => moveSessions([session.id], groupId) : undefined
      }
      onDelete={() => setDeleting(session)}
    />
  )

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
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
      <div className={styles.searchBox}>
        <span className={styles.searchBoxIcon}>
          <IconSearchOutline16 />
        </span>
        <input
          type="text"
          className={styles.searchInput}
          value={query}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('')
            }
          }}
        />
        {query ? (
          <span className={styles.searchClear}>
            <IconButton
              icon={<IconCloseOutline16 />}
              aria-label={t('searchClear')}
              onClick={() => setQuery('')}
            />
          </span>
        ) : null}
      </div>
      <div className={styles.listWrap}>
        {query.trim() !== '' ? (
          <div className={styles.list}>
            {hits.length === 0 ? (
              <div className={styles.searchState}>
                {scanning ? t('searchScanning') : t('searchNoResults')}
              </div>
            ) : (
              <div className={styles.searchResults}>
                {hits.map((hit) => {
                  const summary = sessions.find((session) => session.id === hit.sessionId)
                  return (
                    <button
                      key={`${hit.sessionId}-${hit.messageId}`}
                      type="button"
                      className={styles.searchHit}
                      onClick={() => {
                        openSessionMessage(hit.sessionId, hit.messageId)
                        closeMobileSider()
                      }}
                    >
                      <span className={styles.searchHitTitle}>
                        {summary?.title || t('untitledChat')}
                      </span>
                      <Snippet text={hit.snippet} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
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
                  return (
                    <div key={group.id} className={styles.section}>
                      <GroupHeader
                        group={group}
                        count={list.length}
                        collapsed={collapsedIds.has(group.id)}
                        otherGroups={archiveGroups.filter((item) => item.id !== group.id)}
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
                        ? list.map((session) => renderSession(session))
                        : null}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
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
