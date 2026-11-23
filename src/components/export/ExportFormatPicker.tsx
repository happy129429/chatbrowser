import clsx from 'clsx'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import type { ExportFormat } from '../../services/chat/exportTypes.js'
import styles from './Export.module.css'

const formats: {
  value: ExportFormat
  label: TranslationKey
  description: TranslationKey
  lossy?: boolean
}[] = [
  {
    value: 'deepseek',
    label: 'exportFormatDeepseek',
    description: 'exportFormatDeepseekDesc',
    lossy: true,
  },
  {
    value: 'extended',
    label: 'exportFormatExtended',
    description: 'exportFormatExtendedDesc',
  },
  {
    value: 'claude',
    label: 'exportFormatClaude',
    description: 'exportFormatClaudeDesc',
    lossy: true,
  },
]

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
        {formats.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={format === item.value}
            className={clsx(styles.option, format === item.value && styles.optionActive)}
            onClick={() => onChange(item.value)}
          >
            <span className={styles.optionText}>
              <span className={styles.optionLabel}>
                {t(item.label)}
                {item.lossy ? <span className={styles.lossy}>{t('exportLossy')}</span> : null}
              </span>
              <span className={styles.optionDescription}>{t(item.description)}</span>
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
