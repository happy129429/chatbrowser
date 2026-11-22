import clsx from 'clsx'
import { useEffect, useState } from 'react'
import type { UserMessage } from '../../services/chat/types.js'
import styles from './RoundNav.module.css'

/**
 * 一轮对话的导航条：右侧竖排小条，一条对应一轮「提问」。
 * 蓝色为滚动位置所在的当前轮；悬停变灰并显示该轮提问开头；点击跳转到提问位置。
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
  const [hover, setHover] = useState(-1)

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

  if (rounds.length < 2) {
    return null
  }

  const preview = (round: UserMessage) => {
    const text = round.content.replace(/\s+/g, ' ').trim()
    return text ? text.slice(0, 80) : '…'
  }

  return (
    <div className={clsx(styles.rail, rounds.length > 24 && styles.railCrowded)}>
      {rounds.map((round, index) => (
        <button
          key={round.id}
          type="button"
          className={clsx(
            styles.bar,
            index === current && styles.barCurrent,
            hover === index && styles.barHover
          )}
          onClick={() => onJump(round.id)}
          onMouseEnter={() => setHover(index)}
          onMouseLeave={() => setHover(-1)}
        >
          <span className={clsx(styles.label, index === current && styles.labelCurrent)}>
            {preview(round)}
          </span>
        </button>
      ))}
    </div>
  )
}
