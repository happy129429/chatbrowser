import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { EXPORT_FORMATS } from '../../services/chat/exportFormats.js'
import type { ExportFormat } from '../../services/chat/exportTypes.js'
import styles from './Export.module.css'

export const ExportFormatPicker = ({
  format,
  onChange,
  anonymize,
  onAnonymizeChange,
}: {
  format: ExportFormat
  onChange: (format: ExportFormat) => void
  anonymize: boolean
  onAnonymizeChange: (anonymize: boolean) => void
}) => {
  const t = useTranslate()
  return (
    <>
      <div role="radiogroup" className={styles.options}>
        {EXPORT_FORMATS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={format === item.id}
            className={clsx(styles.option, format === item.id && styles.optionActive)}
            onClick={() => onChange(item.id)}
          >
            <span className={styles.optionText}>
              <span className={styles.optionLabel}>
                {t(item.labelKey)}
                {item.lossy ? <span className={styles.lossy}>{t('exportLossy')}</span> : null}
              </span>
              <span className={styles.optionDescription}>{t(item.descriptionKey)}</span>
            </span>
            <span className={styles.radio} aria-hidden />
          </button>
        ))}
      </div>
      <label className={styles.anonymize}>
        <input
          type="checkbox"
          checked={anonymize}
          onChange={(event) => onAnonymizeChange(event.target.checked)}
        />
        <span className={styles.optionText}>
          <span className={styles.optionLabel}>{t('exportAnonymize')}</span>
          <span className={styles.optionDescription}>{t('exportAnonymizeDesc')}</span>
        </span>
      </label>
    </>
  )
}
