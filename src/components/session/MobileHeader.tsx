import { IconMenuOutline20, IconSearchOutline16, IconShareOutline16 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { IconButton } from '../base/IconButton.js'
import { startShareSelect } from '../../services/chat/store.js'
import { openSearchOverlay } from '../sider/searchOverlayState.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：左侧菜单打开侧边栏；会话页显示标题、分享与搜索 */
export const MobileHeader = ({ title, sessionId }: { title?: string; sessionId?: string }) => {
  const t = useTranslate()
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {title === undefined ? null : <div className={styles.title}>{title}</div>}
      {sessionId === undefined ? null : (
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconShareOutline16 />}
          aria-label={t('share')}
          onClick={() => startShareSelect(sessionId, 'all')}
        />
      )}
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconSearchOutline16 />}
        aria-label={t('searchPlaceholder')}
        onClick={openSearchOverlay}
      />
    </div>
  )
}
