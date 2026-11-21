import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCheckedOutline14,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconPinFill16,
  IconTrashOutline16,
} from '../base/icons.js'
import { renameSession, selectSession } from '../../services/chat/store.js'
import type { SessionGroup, SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import { colorDotClass } from './GroupHeader.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  moveTargets,
  onMove,
  onDragStart,
  onDragEnd,
  selection,
  onPin,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  /** 可移动到的目标组；不提供时只显示重命名与删除 */
  moveTargets?: SessionGroup[]
  onMove?: (groupId: string | null) => void
  /** 拖拽移动会话到组 */
  onDragStart?: () => void
  onDragEnd?: () => void
  /** 多选模式：提供后隐藏菜单与拖拽，行点击切换选中 */
  selection?: { checked: boolean; onToggle: () => void }
  /** 单项置顶切换；参数为置顶后的状态 */
  onPin?: (pinned: boolean) => void
  onDelete: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const displayTitle = session.title || t('untitledChat')

  if (selection) {
    return (
      <div
        className={clsx(styles.item, selection.checked && styles.selected)}
        onClick={selection.onToggle}
      >
        <span
          className={clsx(styles.checkbox, selection.checked && styles.checkboxChecked)}
          aria-checked={selection.checked}
          role="checkbox"
        >
          {selection.checked ? <IconCheckedOutline14 /> : null}
        </span>
        <div className={styles.title}>{displayTitle}</div>
      </div>
    )
  }

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  const moveOptions = (moveTargets ?? []).map((group) => ({
    key: `move-${group.id}`,
    label: group.name,
    icon: <span className={clsx(styles.moveDot, colorDotClass(group.color))} />,
    onSelect: () => onMove?.(group.id),
  }))
  const ungroupOption =
    session.groupId !== null && onMove
      ? [
          {
            key: 'ungroup',
            label: t('ungroupSession'),
            icon: <span className={clsx(styles.moveDot, styles.moveDotNone)} />,
            onSelect: () => onMove(null),
          },
        ]
      : []

  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      draggable={!!onDragStart}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', session.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      onDragEnd={onDragEnd}
      onClick={() => {
        selectSession(session.id)
        closeMobileSider()
      }}
    >
      <div className={styles.title}>{displayTitle}</div>
      <div className={styles.action} onClick={(event) => event.stopPropagation()}>
        <Menu
          options={[
            {
              key: 'rename',
              label: t('sessionItemMenuRenameOption'),
              icon: <IconEditOutline16 />,
              onSelect: () => setEditing(true),
            },
            {
              key: 'pin',
              label: session.pinned ? t('unpin') : t('pin'),
              icon: <IconPinFill16 />,
              onSelect: () => onPin?.(!session.pinned),
            },
            ...moveOptions,
            ...ungroupOption,
            {
              key: 'delete',
              label: t('delete'),
              icon: <IconTrashOutline16 />,
              danger: true,
              onSelect: onDelete,
            },
          ]}
        >
          {({ toggle }) => (
            <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
          )}
        </Menu>
      </div>
    </div>
  )
})
