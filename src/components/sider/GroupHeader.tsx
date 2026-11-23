import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import type { SessionGroup } from '../../services/chat/types.js'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconInfoOutline16,
  IconManageOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { GROUP_COLORS, toGroupColor, type GroupColor } from './groupColors.js'
import styles from './Sider.module.css'

/** 组点色类名；无颜色时不显示圆点。 */
export const colorDotClass = (color: string | null) => {
  const key = toGroupColor(color)
  return key ? styles[`color${key[0].toUpperCase()}${key.slice(1)}`] : undefined
}

const COLOR_LABELS: Record<GroupColor, TranslationKey> = {
  blue: 'colorBlue',
  green: 'colorGreen',
  yellow: 'colorYellow',
  red: 'colorRed',
  purple: 'colorPurple',
  cyan: 'colorCyan',
}

const ColorDot = ({ color }: { color: string | null }) => (
  <span className={clsx(styles.groupDot, colorDotClass(color))} />
)

/**
 * 归档组标题：折叠开关、点色、组名（可就地重命名）、会话数与菜单
 * （重命名、配色、合并到其他组、导出 ZIP、删除）。
 */
export const GroupHeader = ({
  group,
  count,
  collapsed,
  otherGroups,
  droppable,
  locked = false,
  onDropSession,
  onToggle,
  onRename,
  onSetColor,
  onMerge,
  onExport,
  onMultiSelect,
  onShowExtras,
  onDelete,
}: {
  group: SessionGroup
  count: number
  collapsed: boolean
  otherGroups: SessionGroup[]
  /** 有会话正在拖拽时成为放下目标 */
  droppable?: boolean
  locked?: boolean
  onDropSession?: () => void
  onToggle: () => void
  onRename: (name: string) => void
  onSetColor: (color: string | null) => void
  onMerge: (targetId: string) => void
  onExport: () => void
  /** 进入该组的多选管理模式 */
  onMultiSelect: () => void
  /** 查看组级附加信息（仅外部导入存在时提供） */
  onShowExtras?: () => void
  onDelete: () => void
}) => {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)

  if (editing) {
    const finish = (name: string) => {
      setEditing(false)
      const trimmed = name.trim()
      // 默认组即使改成同名也算手动命名，之后不再跟随界面语言
      if (trimmed && (trimmed !== group.name || locked)) {
        onRename(trimmed)
      }
    }
    return (
      <input
        className={styles.groupRenameInput}
        defaultValue={group.name}
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

  return (
    <div
      className={clsx(
        styles.groupHeader,
        collapsed && styles.groupHeaderCollapsed,
        droppable && styles.groupHeaderDroppable
      )}
      onClick={onToggle}
      onDragOver={
        droppable && onDropSession
          ? (event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }
          : undefined
      }
      onDrop={
        droppable && onDropSession
          ? (event) => {
              event.preventDefault()
              onDropSession()
            }
          : undefined
      }
    >
      <span className={styles.groupChevron}>
        {collapsed ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
      </span>
      <ColorDot color={group.color} />
      <span className={styles.groupName} title={group.name}>
        {group.name}
      </span>
      <span className={styles.groupCount}>{count}</span>
      <span className={styles.groupMenu} onClick={(event) => event.stopPropagation()}>
        <IconButton
          icon={<IconManageOutline16 />}
          tooltip={t('multiSelect')}
          tooltipPlacement="bottom"
          onClick={onMultiSelect}
        />
        <Menu
          options={[
            ...(locked
              ? [
                  {
                    key: 'default-lock-note',
                    label: t('defaultGroupLockedHint'),
                    icon: <IconInfoOutline16 />,
                    disabled: true,
                    onSelect: () => {},
                  },
                ]
              : []),
            {
              key: 'rename',
              label: t('sessionItemMenuRenameOption'),
              icon: <IconEditOutline16 />,
              onSelect: () => setEditing(true),
            },
            {
              key: 'multiselect',
              label: t('multiSelect'),
              icon: <IconManageOutline16 />,
              onSelect: onMultiSelect,
            },
            ...GROUP_COLORS.map((color) => ({
              key: `color-${color}`,
              label: t(COLOR_LABELS[color]),
              icon: <ColorDot color={color} />,
              onSelect: () => onSetColor(color),
            })),
            {
              key: 'color-none',
              label: t('colorNone'),
              icon: (
                <span className={clsx(styles.groupDot, styles.groupDotNone)}>
                  <IconCloseOutline16 />
                </span>
              ),
              onSelect: () => onSetColor(null),
            },
            ...(locked
              ? []
              : otherGroups.map((target) => ({
                  key: `merge-${target.id}`,
                  label: `${t('groupMenuMerge')}：${target.name}`,
                  icon: <ColorDot color={target.color} />,
                  onSelect: () => onMerge(target.id),
                }))),
            ...(onShowExtras
              ? [
                  {
                    key: 'extras',
                    label: t('groupExtrasMenu'),
                    icon: <IconInfoOutline16 />,
                    onSelect: onShowExtras,
                  },
                ]
              : []),
            {
              key: 'export',
              label: t('groupMenuExport'),
              icon: <IconDownloadOutline16 />,
              onSelect: onExport,
            },
            ...(locked
              ? []
              : [
                  {
                    key: 'delete',
                    label: t('groupMenuDelete'),
                    icon: <IconTrashOutline16 />,
                    danger: true,
                    onSelect: onDelete,
                  },
                ]),
          ]}
        >
          {({ toggle }) => (
            <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
          )}
        </Menu>
      </span>
    </div>
  )
}
