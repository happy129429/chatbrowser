import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { useSettings } from '../settings.js'

/**
 * 朗读：同一时间只读一条回复，使用浏览器内置的 speechSynthesis，完全本地、无需 API 服务。
 * 正文按句子切段排队朗读，规避长文本截断；状态：loading（未出声）→ playing → 结束回到 idle。
 */
export type ReadAloudStatus = 'idle' | 'loading' | 'playing'

type ReadAloudState = {
  /** 正在朗读的回复 id */
  messageId: string | null
  status: ReadAloudStatus
}

export const useReadAloud = create<ReadAloudState>(() => ({ messageId: null, status: 'idle' }))

/** 单段朗读长度上限（字符），按句子边界切分，超出硬切 */
const MAX_CHUNK = 200

/** 当前朗读会话；切换或结束时置空，事件回调据此丢弃过期通知 */
let current: { messageId: string; utterances: SpeechSynthesisUtterance[] } | null = null

const finish = () => {
  current = null
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

/** 停止当前朗读（切换会话、再次点击等场景调用） */
export const stopReadAloud = () => {
  if (!current) {
    return
  }
  current = null
  window.speechSynthesis.cancel()
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

export const describeReadAloudError = (error: unknown): TranslationMessage | string => {
  // 浏览器不支持或无法合成这段正文，与其余失败区分开
  if (error instanceof Error && error.message === 'unsupported') {
    return { key: 'ttsUnavailable' }
  }
  return { key: 'ttsFailed' }
}

/** 剥离 markdown 记号，只留可读文本 */
const cleanText = (markdown: string) =>
  markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[citation:\d+\]/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

/** 按句子边界切分；找不到边界时在上限处硬切 */
const splitChunks = (text: string): string[] => {
  if (text.length <= MAX_CHUNK) {
    return text ? [text] : []
  }
  const chunks: string[] = []
  let rest = text
  while (rest.length > MAX_CHUNK) {
    const window = rest.slice(0, MAX_CHUNK)
    const index = Math.max(
      ...['。', '！', '？', '；', '.', '!', '?', ';', '\n'].map((mark) => window.lastIndexOf(mark))
    )
    const cut = index > 0 ? index + 1 : MAX_CHUNK
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut)
  }
  if (rest.trim()) {
    chunks.push(rest.trim())
  }
  return chunks
}

/** 按界面语言挑选浏览器语音；语音列表尚未就绪时交给浏览器默认发音 */
const pickVoice = (locale: 'zh-CN' | 'en-US'): SpeechSynthesisVoice | undefined => {
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) {
    return undefined
  }
  const prefix = locale === 'zh-CN' ? 'zh' : 'en'
  return (
    voices.find((voice) => voice.lang.replace('_', '-').toLowerCase() === locale.toLowerCase()) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix))
  )
}

/**
 * 开始朗读一条回复的正文；同一条正在朗读时调用等于停止。
 * 必须在点击事件中同步调用：部分浏览器要求用户手势后才允许出声。
 */
export const toggleReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void
) => {
  const reading = useReadAloud.getState().messageId
  stopReadAloud()
  if (reading === messageId) {
    return
  }
  const synth = window.speechSynthesis
  if (!synth) {
    onError(new Error('unsupported'))
    return
  }
  const chunks = splitChunks(cleanText(text))
  if (chunks.length === 0) {
    return
  }
  const { locale } = useSettings.getState()
  const voice = pickVoice(locale)
  const utterances = chunks.map((content, index) => {
    const utterance = new SpeechSynthesisUtterance(content)
    if (voice) {
      utterance.voice = voice
    }
    utterance.lang = voice?.lang ?? locale
    utterance.onstart = () => {
      if (current?.messageId === messageId) {
        useReadAloud.setState({ status: 'playing' })
      }
    }
    utterance.onend = () => {
      if (current?.messageId === messageId && index === chunks.length - 1) {
        finish()
      }
    }
    utterance.onerror = (event) => {
      if (current?.messageId !== messageId) {
        return
      }
      const reason = (event as SpeechSynthesisErrorEvent).error
      // cancel() 触发的中断不是错误
      if (reason === 'interrupted' || reason === 'canceled') {
        return
      }
      finish()
      onError(new Error(reason || 'synthesis failed'))
    }
    return utterance
  })
  current = { messageId, utterances }
  useReadAloud.setState({ messageId, status: 'loading' })
  for (const utterance of utterances) {
    synth.speak(utterance)
  }
}
