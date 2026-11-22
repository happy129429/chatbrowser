import clsx from 'clsx'
import { useMemo } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { startShareSelect } from '../../services/chat/store.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import type { Session } from '../../services/chat/types.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import { IconButton } from '../base/IconButton.js'
import { IconShareOutline16 } from '../base/icons.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏，含分享入口）+ 消息列表 */
export const SessionView = ({
  session,
  siderCollapsed,
}: {
  session: Session
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  const { rounds, tokens } = useMemo(() => {
    const visible = getVisibleMessages(session)
    let roundCount = 0
    for (const message of visible) {
      if (message.role === 'user') {
        roundCount += 1
      }
    }
    // 归档带分支累计 token：最后一个回答的累计值即整段会话用量；旧数据回退用量求和。
    const usageOf = (message: (typeof visible)[number]) =>
      message.role === 'assistant'
        ? (message.accumulatedTokens ??
          (message.usage
            ? message.usage.input_tokens +
              message.usage.cache_creation_input_tokens +
              message.usage.cache_read_input_tokens +
              message.usage.output_tokens
            : null))
        : null
    const lastUsage =
      [...visible]
        .reverse()
        .map(usageOf)
        .find((value) => value !== null) ?? null
    return { rounds: roundCount, tokens: lastUsage }
  }, [session])
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} sessionId={session.id} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.titleRow, siderCollapsed && styles.withCollapsedSider)}>
            <div className={styles.title}>{title}</div>
            <span className={styles.sessionStats}>
              {t('sessionStatsLine', {
                rounds,
                tokens: tokens === null ? '—' : tokens.toLocaleString('en-US'),
              })}
            </span>
            <IconButton
              icon={<IconShareOutline16 />}
              tooltip={t('share')}
              tooltipPlacement="bottom"
              onClick={() => startShareSelect(session.id, 'all')}
            />
          </div>
        </div>
      )}
      <MessageList session={session} />
    </div>
  )
}
