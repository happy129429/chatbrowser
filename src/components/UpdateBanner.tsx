import { useEffect, useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import {
  checkForUpdates,
  dismissUpdate,
  isUpdateDismissed,
  type UpdateResult,
} from '../services/update.js'
import { Button } from './base/Button.js'
import styles from '../app/App.module.css'

/** 启动后静默检查 GitHub Release；有新版本时显示可关闭的提示条。 */
export const UpdateBanner = () => {
  const t = useTranslate()
  const [info, setInfo] = useState<UpdateResult | null>(null)

  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      void checkForUpdates().then((result) => {
        if (!alive || !result?.newer || isUpdateDismissed(result.latest)) {
          return
        }
        setInfo(result)
      })
    }, 4000)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  if (!info) {
    return null
  }
  return (
    <div className={styles.updateBanner} role="status">
      <span>{t('updateAvailable', { version: info.latest })}</span>
      <div className={styles.updateActions}>
        <Button size="s" onClick={() => window.open(info.url, '_blank')}>
          {t('updateDownload')}
        </Button>
        <Button
          size="s"
          variant="outlined"
          onClick={() => {
            dismissUpdate(info.latest)
            setInfo(null)
          }}
        >
          {t('updateLater')}
        </Button>
      </div>
    </div>
  )
}
