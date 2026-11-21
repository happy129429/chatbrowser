import clsx from 'clsx'
import { memo } from 'react'
import { getFileViewType, isImage } from '../../utils/file.js'
import type { UserMessage as UserMessageType } from '../../services/chat/types.js'
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
}: {
  message: UserMessageType
  isFirst: boolean
  isLast: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  return (
    <div className={clsx(styles.container, isFirst && styles.isFirst)} data-message-id={message.id}>
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
  )
})
