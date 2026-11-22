import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import {
  selectMessageVersion,
  clearPendingJump,
  exitShareSelect,
  startShareSelect,
  useChatStore,
} from '../../services/chat/store.js'
import { exportRounds, type ExportRound } from '../../services/chat/export.js'
import type { Message, Session, UserMessage as UserMessageType } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { showToast } from '../base/toastState.js'
import { Button } from '../base/Button.js'
import { IconCheckedOutline14 } from '../base/icons.js'
import { AssistantMessage } from './AssistantMessage.js'
import { RoundNav } from './RoundNav.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，内容增长时跟随 */
const STICKY_THRESHOLD = 40
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

export const MessageList = ({
  session,
  footer,
}: {
  session: Session
  footer?: React.ReactNode
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = getVisibleMessages(session)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  /** 跳转定位进行中：吸底跟随暂停，内容懒渲染长高时持续重新对准目标。 */
  const jumpActiveRef = useRef(false)
  const jumpTargetRef = useRef<string | null>(null)
  const jumpStableRef = useRef({ height: 0, count: 0 })
  const jumpReleaseRef = useRef(0)

  const releaseJump = useCallback(() => {
    jumpActiveRef.current = false
    jumpTargetRef.current = null
    window.clearTimeout(jumpReleaseRef.current)
  }, [])

  const jumpToMessage = useCallback(
    (messageId: string) => {
      const el = scrollRef.current
      const target = contentRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(messageId)}"]`
      )
      if (!el || !target) {
        return
      }
      stickyRef.current = false
      jumpActiveRef.current = true
      jumpTargetRef.current = messageId
      jumpStableRef.current = { height: 0, count: 0 }
      window.clearTimeout(jumpReleaseRef.current)
      // 内容迟迟不再变化（如目标本就渲染完毕）时兜底释放，避免跟随永久失效。
      jumpReleaseRef.current = window.setTimeout(releaseJump, 1500)
      target.scrollIntoView({ block: 'center' })
      target.classList.add('ds-jump-flash')
      setTimeout(() => target.classList.remove('ds-jump-flash'), 1200)
      scrollTopRef.current = el.scrollTop
    },
    [releaseJump]
  )

  // 内容变化时，继续遵循当前跟随状态；跳转期间改为持续对准目标，渲染稳定后释放。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(() => {
      if (!jumpActiveRef.current) {
        scrollToBottom()
        return
      }
      const targetId = jumpTargetRef.current
      const target = targetId
        ? content.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(targetId)}"]`)
        : null
      if (!target) {
        releaseJump()
        return
      }
      const height = content.scrollHeight
      const stable = jumpStableRef.current.height === height ? jumpStableRef.current.count + 1 : 0
      jumpStableRef.current = { height, count: stable }
      if (stable >= 2) {
        releaseJump()
        return
      }
      const delta =
        target.getBoundingClientRect().top + target.clientHeight / 2 - scroll.clientHeight / 2
      if (Math.abs(delta) > 1) {
        scroll.scrollTop += delta
        scrollTopRef.current = scroll.scrollTop
      }
    })
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, releaseJump, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  // 搜索结果的跳转定位：滚动到命中消息并短暂闪烁。
  const pendingJump = useChatStore((state) => state.pendingJump)
  useEffect(() => {
    if (!pendingJump || pendingJump.sessionId !== session.id) {
      return
    }
    clearPendingJump()
    requestAnimationFrame(() => jumpToMessage(pendingJump.messageId))
  }, [pendingJump, session.id, jumpToMessage])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id]
  )

  // 跨移动端断点时切换滚动层，并保持当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // 用户主动滚动立即接管，终止跳转锁定
    const onUserScrollIntent = () => releaseJump()
    el.addEventListener('wheel', onUserScrollIntent, { passive: true })
    el.addEventListener('touchstart', onUserScrollIntent, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onUserScrollIntent)
      el.removeEventListener('touchstart', onUserScrollIntent)
    }
  }, [isMobile, releaseJump, scrollToBottom])

  const lastIndex = messages.length - 1
  const rounds = useMemo(
    () => messages.filter((message): message is UserMessageType => message.role === 'user'),
    [messages]
  )

  // 轮次导出选择模式
  const shareSelect = useChatStore((state) => state.shareSelect)
  const shareActive = shareSelect?.sessionId === session.id
  const [shareSelected, setShareSelected] = useState<Set<string>>(() => new Set())
  const [exporting, setExporting] = useState<'html' | 'markdown' | null>(null)

  useEffect(() => {
    if (!shareActive || !shareSelect) {
      return
    }
    const roundIds = rounds.map((round) => round.id)
    setShareSelected(
      shareSelect.initial === 'all'
        ? new Set(roundIds)
        : new Set(shareSelect.initial.filter((id) => roundIds.includes(id)))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareActive])

  const assistantByParent = useMemo(() => {
    const map = new Map<string, Message>()
    for (const message of messages) {
      if (message.role === 'assistant' && message.parentId) {
        map.set(message.parentId, message)
      }
    }
    return map
  }, [messages])

  const doExport = async (format: 'html' | 'markdown') => {
    const chosen = rounds.filter((round) => shareSelected.has(round.id))
    if (chosen.length === 0) {
      return
    }
    setExporting(format)
    try {
      const chosenRounds: ExportRound[] = chosen.map((user) => ({
        user,
        assistant:
          assistantByParent.get(user.id)?.role === 'assistant'
            ? (assistantByParent.get(user.id) as Extract<Message, { role: 'assistant' }>)
            : null,
      }))
      const { name, blob } = await exportRounds(session, chosenRounds, format)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      exitShareSelect()
    } catch {
      showToast({ key: 'exportFailed', type: 'error' })
    } finally {
      setExporting(null)
    }
  }

  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            {messages.map((message, index) =>
              message.role === 'user' ? (
                <UserMessage
                  key={message.id}
                  message={message}
                  isFirst={index === 0}
                  isLast={index === lastIndex || index === lastIndex - 1}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                  share={
                    shareActive
                      ? {
                          checked: shareSelected.has(message.id),
                          onToggle: () => {
                            const id = message.id
                            setShareSelected((previous) => {
                              const next = new Set(previous)
                              if (next.has(id)) {
                                next.delete(id)
                              } else {
                                next.add(id)
                              }
                              return next
                            })
                          },
                        }
                      : undefined
                  }
                />
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  isLast={index === lastIndex}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                  onShareRound={
                    shareActive || !message.parentId
                      ? undefined
                      : () => startShareSelect(session.id, [message.parentId as string])
                  }
                  stats={(() => {
                    const roundIndex = rounds.findIndex((round) => round.id === message.parentId)
                    if (roundIndex === -1) {
                      return undefined
                    }
                    const tokens = message.usage
                      ? message.usage.input_tokens +
                        message.usage.cache_creation_input_tokens +
                        message.usage.cache_read_input_tokens +
                        message.usage.output_tokens
                      : null
                    return {
                      round: roundIndex + 1,
                      tokens,
                    }
                  })()}
                />
              )
            )}
          </div>
        </div>
        {footer}
      </div>
      {shareActive ? (
        <div className={styles.shareBar}>
          <button
            type="button"
            className={styles.shareSelectAll}
            onClick={() => {
              const all = rounds.map((round) => round.id)
              const allSelected = all.every((id) => shareSelected.has(id))
              setShareSelected(allSelected ? new Set() : new Set(all))
            }}
          >
            <span
              className={clsx(
                styles.shareCheck,
                rounds.length > 0 &&
                  rounds.every((round) => shareSelected.has(round.id)) &&
                  styles.shareCheckOn
              )}
              role="checkbox"
              aria-checked={
                rounds.length > 0 && rounds.every((round) => shareSelected.has(round.id))
              }
            >
              {rounds.length > 0 && rounds.every((round) => shareSelected.has(round.id)) ? (
                <IconCheckedOutline14 />
              ) : null}
            </span>
            {t('selectAll')}
          </button>
          <span className={styles.shareCount}>
            {t('roundsSelected', { count: shareSelected.size })}
          </span>
          <div className={styles.shareActions}>
            <Button variant="outlined" size="s" onClick={exitShareSelect}>
              {t('cancel')}
            </Button>
            <Button
              variant="outlined"
              size="s"
              disabled={exporting !== null || shareSelected.size === 0}
              onClick={() => void doExport('markdown')}
            >
              {t('exportMarkdown')}
            </Button>
            <Button
              size="s"
              disabled={exporting !== null || shareSelected.size === 0}
              onClick={() => void doExport('html')}
            >
              {t('exportHtml')}
            </Button>
          </div>
        </div>
      ) : null}
      {!isMobile && !shareActive ? (
        <RoundNav
          rounds={rounds}
          scrollRef={scrollRef}
          contentRef={contentRef}
          onJump={jumpToMessage}
        />
      ) : null}
    </ScrollToBottomContext.Provider>
  )
}
