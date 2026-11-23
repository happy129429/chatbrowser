import type { TranslationKey } from '../../i18n/index.js'
import type { ExportFormat } from './exportTypes.js'

export type ExportFormatDescriptor = {
  id: ExportFormat
  labelKey: TranslationKey
  descriptionKey: TranslationKey
  lossy: boolean
}

/** 导出格式的唯一描述表；UI 和后续 CLI 从这里读取，不再各自硬编码。 */
export const EXPORT_FORMATS: readonly ExportFormatDescriptor[] = [
  {
    id: 'deepseek',
    labelKey: 'exportFormatDeepseek',
    descriptionKey: 'exportFormatDeepseekDesc',
    lossy: true,
  },
  {
    id: 'extended',
    labelKey: 'exportFormatExtended',
    descriptionKey: 'exportFormatExtendedDesc',
    lossy: false,
  },
  {
    id: 'claude',
    labelKey: 'exportFormatClaude',
    descriptionKey: 'exportFormatClaudeDesc',
    lossy: true,
  },
]

export const isLossyExport = (format: ExportFormat) =>
  EXPORT_FORMATS.some((item) => item.id === format && item.lossy)
