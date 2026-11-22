import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import type { UserMessage } from '../../services/chat/types.js'
import styles from './RoundNav.module.css'

/**
 * 一轮对话的导航条（官方样式）：
 * - 收起时右侧只显示每轮一根小短线，当前轮蓝色加宽；
 * - 悬停导航区域展开浮层，纵向列出全部轮的提问开头（右对齐），
 *   当前轮文字与短线为蓝色，点击任意一行跳到该轮；
 * - 展开时自动把当前轮滚到可见位置。
 */
export const RoundNav = ({
  rounds,
  scrollRef,
  contentRef,
  onJump,
}: {
  /** 当前分支上的提问列表（按对话顺序，来自可见消息） */
  rounds: UserMessage[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  onJump: (messageId: string) => void
}) => {
  const [current, setCurrent] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const activeRowRef = useRef<HTMLButtonElement>(null)

  // 滚动与内容高度变化时，以视口纵向中点所在轮次为当前轮。
  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) {
      return
    }
    const update = () => {
      const center = el.clientHeight / 2
      let index = 0
      rounds.forEach((round, i) => {
        const target = content.querySelector(`[data-message-id="${CSS.escape(round.id)}"]`)
        if (target && target.getBoundingClientRect().top <= center) {
          index = i
        }
      })
      setCurrent(index)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(content)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [rounds, scrollRef, contentRef])

  // 展开时把当前轮滚到浮层可视区域。
  useEffect(() => {
    if (expanded) {
      activeRowRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [expanded])

  if (rounds.length < 2) {
    return null
  }

  const preview = (round: UserMessage) => {
    const text = round.content.replace(/\s+/g, ' ').trim()
    return text || '…'
  }

  return (
    <div
      className={styles.rail}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {expanded ? (
        <div className={styles.card} role="list">
          {rounds.map((round, index) => (
            <button
              key={round.id}
              ref={index === current ? activeRowRef : undefined}
              type="button"
              role="listitem"
              className={clsx(styles.row, index === current && styles.rowActive)}
              onClick={() => onJump(round.id)}
            >
              <span className={styles.rowText}>{preview(round)}</span>
              <span className={styles.dash} />
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.bars}>
          {rounds.map((round, index) => (
            <button
              key={round.id}
              type="button"
              className={clsx(styles.bar, index === current && styles.barCurrent)}
              aria-label={preview(round)}
              onClick={() => onJump(round.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
