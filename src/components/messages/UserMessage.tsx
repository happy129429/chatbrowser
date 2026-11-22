import clsx from 'clsx'
import { memo } from 'react'
import { getFileViewType, isImage } from '../../utils/file.js'
import type { UserMessage as UserMessageType } from '../../services/chat/types.js'
import { IconCheckedOutline14 } from '../base/icons.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import { MessageFile } from './MessageFile.js'
import { CopyButton } from './CopyButton.js'
import styles from './UserMessage.module.css'

export const UserMessage = memo(function UserMessage({
  message,
  isFirst,
  isLast,
  versions,
  onSelectVersion,
  share,
}: {
  message: UserMessageType
  isFirst: boolean
  isLast: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
  /** 轮次导出选择模式：勾选框控制整轮 */
  share?: { checked: boolean; onToggle: () => void }
}) {
  return (
    <div
      className={clsx(styles.container, isFirst && styles.isFirst)}
      onClick={share ? (event) => event.stopPropagation() : undefined}
    >
      {share ? (
        <span
          className={clsx(styles.shareCheck, share.checked && styles.shareCheckOn)}
          role="checkbox"
          aria-checked={share.checked}
          aria-label={message.content || undefined}
          onClick={(event) => {
            event.stopPropagation()
            share.onToggle()
          }}
        >
          {share.checked ? <IconCheckedOutline14 /> : null}
        </span>
      ) : null}
      <div className={styles.body}>
        {message.files.length > 0 ? (
          <div
            className={clsx(
              styles.files,
              message.files.some((file) => !isImage(getFileViewType(file.name))) &&
                styles.filesWithDocuments
            )}
          >
            {message.files.map((file) => (
              <MessageFile key={file.id} file={file} />
            ))}
          </div>
        ) : null}
        {message.content ? <div className={styles.bubble}>{message.content}</div> : null}
        <div className={styles.bottom}>
          <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
            {message.content ? <CopyButton text={message.content} /> : null}
          </div>
          <BranchSwitcher versions={versions} disabled={false} onSelect={onSelectVersion} />
        </div>
      </div>
    </div>
  )
})
