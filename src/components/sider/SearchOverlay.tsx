import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { searchSessions, type SearchHit } from '../../services/chat/search.js'
import { openSessionMessage, useChatStore } from '../../services/chat/store.js'
import {
  IconChatBubbleOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconSearchOutline16,
} from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { closeSearchOverlay, useSearchOverlay } from './searchOverlayState.js'
import styles from './SearchOverlay.module.css'

/** 结果行右侧的日期：今天 / 昨天 / M月D日（英文为 Nov 19 样式）。 */
const hitDate = (
  timestamp: number,
  now: number,
  locale: 'zh-CN' | 'en-US',
  todayLabel: string,
  yesterdayLabel: string
) => {
  const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)
  const diff = Math.floor((startOfDay(now) - startOfDay(timestamp)) / 86_400_000)
  if (diff <= 0) {
    return todayLabel
  }
  if (diff === 1) {
    return yesterdayLabel
  }
  const date = new Date(timestamp)
  if (locale === 'zh-CN') {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** 按会话分组（扫描顺序即会话按更新时间降序）；保留首次出现顺序。 */
type HitGroup = { sessionId: string; hits: SearchHit[] }

const groupHits = (hits: SearchHit[]): HitGroup[] => {
  const groups: HitGroup[] = []
  const bySession = new Map<string, HitGroup>()
  for (const hit of hits) {
    let group = bySession.get(hit.sessionId)
    if (!group) {
      group = { sessionId: hit.sessionId, hits: [] }
      bySession.set(hit.sessionId, group)
      groups.push(group)
    }
    group.hits.push(hit)
  }
  return groups
}

/** 高亮片段：\x00 包裹的命中词加粗显示。 */
const Snippet = ({ text }: { text: string }) => {
  const [before, marked, after] = text.split('\x00')
  return (
    <span className={styles.snippet}>
      {before}
      {marked !== undefined ? <mark>{marked}</mark> : null}
      {after}
    </span>
  )
}

/**
 * 全局搜索浮层：顶部圆角搜索框（放大镜 + 关闭），下方按会话更新的时间排列的命中列表。
 * 同一会话折叠为一行，带「N 个匹配」徽标；展开后逐条命中摘录，点击跳转到对应消息。
 */
export const SearchOverlay = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const open = useSearchOverlay((state) => state.open)
  const sessions = useChatStore((state) => state.sessions)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [scanning, setScanning] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [now] = useState(Date.now)

  useEffect(() => {
    if (!open) {
      return
    }
    // 打开时聚焦输入框；关闭后清理进行中的扫描。
    inputRef.current?.focus()
    return () => {
      abortRef.current?.abort()
    }
  }, [open])

  // 搜索防抖；新查询中止上一轮扫描，展开状态随之重置。
  useEffect(() => {
    const trimmed = query.trim()
    abortRef.current?.abort()
    if (trimmed === '') {
      setHits([])
      setScanning(false)
      setExpanded(new Set())
      return
    }
    setScanning(true)
    setHits([])
    setExpanded(new Set())
    const controller = new AbortController()
    abortRef.current = controller
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
  }, [query, open])

  const groups = useMemo(() => groupHits(hits), [hits])

  if (!open) {
    return null
  }

  const close = () => {
    setQuery('')
    closeSearchOverlay()
  }

  const toggleGroup = (sessionId: string) =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })

  return (
    <>
      <div className={styles.mask} onClick={close} />
      <div className={styles.overlay} role="dialog" aria-label={t('searchPlaceholder')}>
        <div className={styles.searchBar}>
          <span className={styles.searchIcon}>
            <IconSearchOutline16 />
          </span>
          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            value={query}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                close()
              }
            }}
          />
          <span className={styles.searchClose}>
            <IconButton
              icon={<IconCloseOutline16 />}
              aria-label={t('searchClear')}
              onClick={close}
            />
          </span>
        </div>
        <div className={styles.results}>
          {query.trim() !== '' && groups.length === 0 ? (
            <div className={styles.state}>
              {scanning ? t('searchScanning') : t('searchNoResults')}
            </div>
          ) : null}
          {groups.map(({ sessionId, hits: sessionHits }) => {
            const summary = sessions.find((session) => session.id === sessionId)
            const expandedGroup = expanded.has(sessionId)
            return (
              <div key={sessionId} className={styles.group}>
                <button
                  type="button"
                  className={styles.groupRow}
                  onClick={() => toggleGroup(sessionId)}
                >
                  <span className={styles.groupChevron}>
                    {expandedGroup ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                  </span>
                  <span className={styles.hitIcon}>
                    <IconChatBubbleOutline16 />
                  </span>
                  <span className={styles.hitBody}>
                    <span className={styles.hitTitleRow}>
                      <span className={styles.hitTitle}>{summary?.title || t('untitledChat')}</span>
                      <span className={styles.hitBadge}>
                        {sessionHits.length === 1
                          ? t('searchMatchOne')
                          : t('searchMatchCount', { count: sessionHits.length })}
                      </span>
                      <span className={styles.hitDate}>
                        {summary
                          ? hitDate(
                              summary.updatedAt,
                              now,
                              locale,
                              t('sessionHistoryTimelineLabelToday'),
                              t('sessionHistoryTimelineLabelYesterday')
                            )
                          : ''}
                      </span>
                    </span>
                  </span>
                </button>
                {expandedGroup ? (
                  <div className={styles.subHits}>
                    {sessionHits.map((hit) => (
                      <button
                        key={hit.messageId}
                        type="button"
                        className={styles.subHit}
                        onClick={() => {
                          openSessionMessage(sessionId, hit.messageId)
                          close()
                        }}
                      >
                        <Snippet text={hit.snippet} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
