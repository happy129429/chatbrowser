import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo } from 'react'
import { IconWarningOutline16 } from '../base/icons.js'
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
}: {
  message: AssistantMessageType
  isLast: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  const t = useTranslate()
  const view = useReplyView(message)
  const panelEntry = useSearchPanel((state) => state.entry)
  const notice = describeReply(message)
  // 安全拒绝：已下发的思考与正文按协议丢弃，只显示模板答复。
  const refused = message.stopReason === 'refusal'
  const answer = refused ? null : view.answer
  const responseText = [answer?.text, notice?.presentation === 'response' ? notice.text : null]
    .filter(Boolean)
    .join('\n\n')
  const copyText = responseText || notice?.text
  const summaryEntry = `${message.id}-summary`
  return (
    <div className={styles.message} data-message-id={message.id}>
      {refused ? null : <ReplyArea message={message} view={view} hasResponse={!!responseText} />}
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
          {responseText && !refused ? (
            <ReadAloudButton messageId={message.id} text={responseText} />
          ) : null}
        </div>
      </div>
    </div>
  )
})
