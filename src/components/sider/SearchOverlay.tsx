import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { searchSessions, type SearchHit } from '../../services/chat/search.js'
import { openSessionMessage, useChatStore } from '../../services/chat/store.js'
import { IconChatBubbleOutline16, IconCloseOutline16, IconSearchOutline16 } from '../base/icons.js'
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
 * 全局搜索浮层：顶部圆角搜索框（放大镜 + 关闭），下方按会话更新时间排列的命中列表。
 * 每行：会话气泡图标、标题、右侧日期、单行摘录（命中词加粗）。
 */
export const SearchOverlay = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const open = useSearchOverlay((state) => state.open)
  const sessions = useChatStore((state) => state.sessions)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [scanning, setScanning] = useState(false)
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

  // 搜索防抖；新查询中止上一轮扫描。
  useEffect(() => {
    const trimmed = query.trim()
    abortRef.current?.abort()
    if (trimmed === '') {
      setHits([])
      setScanning(false)
      return
    }
    setScanning(true)
    setHits([])
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

  if (!open) {
    return null
  }

  const close = () => {
    setQuery('')
    closeSearchOverlay()
  }

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
          {query.trim() !== '' && hits.length === 0 ? (
            <div className={styles.state}>
              {scanning ? t('searchScanning') : t('searchNoResults')}
            </div>
          ) : null}
          {hits.map((hit) => {
            const summary = sessions.find((session) => session.id === hit.sessionId)
            return (
              <button
                key={`${hit.sessionId}-${hit.messageId}`}
                type="button"
                className={styles.hit}
                onClick={() => {
                  openSessionMessage(hit.sessionId, hit.messageId)
                  close()
                }}
              >
                <span className={styles.hitIcon}>
                  <IconChatBubbleOutline16 />
                </span>
                <span className={styles.hitBody}>
                  <span className={styles.hitTitleRow}>
                    <span className={styles.hitTitle}>{summary?.title || t('untitledChat')}</span>
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
                  <Snippet text={hit.snippet} />
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
