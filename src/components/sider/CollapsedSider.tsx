import { IconPanelLeftOutline16, IconUploadOutline14 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { IconButton } from '../base/IconButton.js'
import { openArchivePicker } from './ArchiveInputHost.js'
import styles from './Sider.module.css'

/** 收起后左上角的按钮组 */
export const CollapsedSider = () => {
  const t = useTranslate()
  return (
    <div className={styles.collapsed}>
      <div className={styles.collapsedGroup}>
        <IconButton
          size="m"
          tone="primary"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('expandSiderbarButton')}
          onClick={() => setSiderCollapsed(false)}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<IconUploadOutline14 />}
          tooltip={t('openArchive')}
          onClick={openArchivePicker}
        />
      </div>
    </div>
  )
}
