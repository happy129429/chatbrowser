import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import {
  buildSearchIndex,
  searchIndexed,
  titleOnlySessions,
  type SearchHit,
  type SearchIndex,
} from '../../services/chat/search.js'
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

/** 按会话分组（命中按相关性排序；保留首次出现顺序）。 */
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
 * 全局搜索浮层：顶部圆角搜索框（放大镜 + 关闭），下方按会话分组、按相关性排序的命中列表。
 * 打开浮层时异步构建 MiniSearch 索引，之后每次查询即时返回。
 */
export const SearchOverlay = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const open = useSearchOverlay((state) => state.open)
  const sessions = useChatStore((state) => state.sessions)
  const dataVersion = useChatStore((state) => state.dataVersion)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searchIndex, setSearchIndex] = useState<SearchIndex | null>(null)
  const [building, setBuilding] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const buildAbortRef = useRef<AbortController | null>(null)
  const [now] = useState(Date.now)

  useEffect(() => {
    if (!open) {
      return
    }
    // 打开时聚焦输入框；数据版本变化（含首次）时按需重建索引，命中缓存则瞬时就绪。
    inputRef.current?.focus()
    setBuilding(true)
    setSearchIndex(null)
    const controller = new AbortController()
    buildAbortRef.current = controller
    void buildSearchIndex(useChatStore.getState().sessions, dataVersion, {
      signal: controller.signal,
      onProgress: ({ scanned, total }) => {
        if (!controller.signal.aborted) {
          setBuilding(scanned < total)
        }
      },
    }).then((index) => {
      if (!controller.signal.aborted) {
        setSearchIndex(index)
        setBuilding(false)
      }
    })
    return () => {
      controller.abort()
      buildAbortRef.current = null
    }
  }, [open, dataVersion])

  // 索引就绪后查询即时返回；无索引时保持空结果。
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed === '' || !searchIndex) {
      setHits([])
      setExpanded(new Set())
      return
    }
    const messageHits = searchIndexed(searchIndex, trimmed)
    const messageSessions = new Set(messageHits.map((hit) => hit.sessionId))
    const titleHits = titleOnlySessions(
      searchIndex,
      useChatStore.getState().sessions,
      trimmed,
      messageSessions
    )
    setHits([...messageHits, ...titleHits])
    setExpanded(new Set())
  }, [query, searchIndex])

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
              {building ? t('searchScanning') : t('searchNoResults')}
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
