import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useState } from 'react'
import { IconShareOutline16, IconWarningOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { describeReply } from '../../services/chat/describe.js'
import type { AssistantMessage as AssistantMessageType } from '../../services/chat/types.js'
import { Markdown } from '../markdown/Markdown.js'
import { SiteThumbnails } from '../search/SiteLogo.js'
import { toggleSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import { CopyButton } from './CopyButton.js'
import { ReadAloudButton } from './ReadAloudButton.js'
import { ReplyArea } from './ReplyArea.js'
import { useReplyView } from './useReplyView.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import styles from './AssistantMessage.module.css'

export const AssistantMessage = memo(function AssistantMessage({
  message,
  isLast,
  versions,
  onSelectVersion,
  onShareRound,
  stats,
}: {
  message: AssistantMessageType
  isLast: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
  /** 分享按钮：把这一轮加入导出选择 */
  onShareRound?: () => void
  /** 轮次小字：第 N 轮与该轮 token 用量 */
  stats?: { round: number; tokens: number | null }
}) {
  const t = useTranslate()
  const view = useReplyView(message)
  const panelEntry = useSearchPanel((state) => state.entry)
  const notice = describeReply(message)
  // 安全拒绝：默认只显示模板答复，归档浏览时可展开查看原始内容。
  const [showRefused, setShowRefused] = useState(false)
  const refused = message.stopReason === 'refusal'
  const hiddenRefused = refused && !showRefused
  const answer = hiddenRefused ? null : view.answer
  const responseText = [answer?.text, notice?.presentation === 'response' ? notice.text : null]
    .filter(Boolean)
    .join('\n\n')
  const copyText = responseText || notice?.text
  const summaryEntry = `${message.id}-summary`
  return (
    <div className={styles.message} data-message-id={message.id}>
      {hiddenRefused ? null : (
        <ReplyArea message={message} view={view} hasResponse={!!responseText} />
      )}
      {answer ? (
        <Markdown
          className="ds-assistant-message-main-content"
          content={answer.markdown}
          loading={false}
          cacheKey={message.id}
          disableLink={false}
          sources={view.sources}
        />
      ) : null}
      {notice?.presentation === 'response' ? (
        <Markdown
          className="ds-assistant-message-main-content"
          content={notice.text}
          loading={false}
          cacheKey={`${message.id}-template`}
          disableLink={false}
        />
      ) : notice ? (
        <div className={styles.notice}>
          <IconWarningOutline16 />
          <span>{notice.text}</span>
        </div>
      ) : null}
      {refused && !showRefused ? (
        <button type="button" className={styles.refusedToggle} onClick={() => setShowRefused(true)}>
          {t('showRefusedContent')}
        </button>
      ) : null}
      {refused && showRefused ? (
        <div className={styles.refusedHint}>{t('refusedContentHint')}</div>
      ) : null}
      {!refused && view.searchResults.length > 0 ? (
        <div
          className={clsx(styles.summary, panelEntry === summaryEntry && styles.summaryActive)}
          onClick={() => toggleSearchPanel(summaryEntry, view.searchResults)}
        >
          <SiteThumbnails sources={view.searchResults} />
          <span>
            {t(
              view.searchResults.length === 1 ? 'messageSearchSummary' : 'messageSearchSummaries',
              { count: view.searchResults.length }
            )}
          </span>
        </div>
      ) : null}
      <div className={styles.bottom}>
        <BranchSwitcher versions={versions} disabled={false} onSelect={onSelectVersion} />
        <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
          {copyText ? <CopyButton text={copyText} /> : null}
          {responseText && (!refused || showRefused) ? (
            <ReadAloudButton messageId={message.id} text={responseText} />
          ) : null}
          {onShareRound ? (
            <IconButton
              icon={<IconShareOutline16 />}
              tooltip={t('share')}
              tooltipPlacement="bottom"
              onClick={onShareRound}
            />
          ) : null}
        </div>
        {stats ? (
          <span className={styles.roundStats}>
            {t('roundPrefix', { round: stats.round })}
            {stats.tokens !== null
              ? ` · ${t('tokensShort', { tokens: stats.tokens.toLocaleString('en-US') })}`
              : ''}
          </span>
        ) : null}
      </div>
    </div>
  )
})
