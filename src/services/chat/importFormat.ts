import type { TranslationKey } from '../../i18n/index.js'
import type { ImportFormatId } from './history/external/index.js'

const keys: Record<ImportFormatId, TranslationKey> = {
  deepseek: 'importFormatDeepseek',
  chatgpt: 'importFormatChatgpt',
  claude: 'importFormatClaude',
  openwebui: 'importFormatOpenwebui',
  turns: 'importFormatTurns',
  generic: 'importFormatGeneric',
  privacy: 'importFormatPrivacy',
}

export const importFormatKey = (format: ImportFormatId): TranslationKey => keys[format]
