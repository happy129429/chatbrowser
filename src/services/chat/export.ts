import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { math, mathHtml } from 'micromark-extension-llm-math'
import { micromark } from 'micromark'
import { getHighlightLang, loadHighlight } from '../markdown/highlight.js'
import { HIGHLIGHT_THEME_CSS } from '../markdown/highlightTheme.js'
import Prism from 'prismjs'
import type { AssistantMessage, Session, UserMessage } from './types.js'
import { buildReplyView } from './view.js'
import * as db from './db.js'

/** 会话内一轮「提问 + 回答」。回答可能缺失（中断、模板答复轮）。 */
export type ExportRound = { user: UserMessage; assistant: AssistantMessage | null }

export type ExportFormat = 'html' | 'markdown'

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** [citation:N] 换成 [N]（来源以编号列表附在回答末尾），避免 micromark 误解析。 */
const stripCitations = (markdown: string) => markdown.replace(/\[citation:\d+\]/g, '')

const mdToHtml = (markdown: string) =>
  micromark(markdown, {
    extensions: [gfm(), math({ singleDollarTextMath: true })],
    htmlExtensions: [gfmHtml(), mathHtml({ output: 'mathml' })],
  })

/** 用 Prism 高亮 HTML 里的代码块（DOM 解析后回填，保证实体解码正确）。 */
const highlightCodeBlocks = async (html: string): Promise<string> => {
  const document = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const codes = [...document.querySelectorAll('pre code[class*="language-"]')]
  for (const code of codes) {
    const lang = getHighlightLang([...code.classList].find((c) => c.startsWith('language-')) ?? '')
    if (!lang) {
      continue
    }
    try {
      await loadHighlight(lang)
    } catch {
      continue
    }
    const grammar = Prism.languages[lang]
    if (grammar) {
      code.innerHTML = Prism.highlight(code.textContent ?? '', grammar, lang)
    }
  }
  return document.getElementById('root')?.innerHTML ?? html
}

const attachmentName = (name: string, size: number) =>
  `${escapeHtml(name)}<span class="size">${size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`}</span>`

/** 收集一轮的展示素材：图片转 data URI，回答按引用来源拆成正文 + 来源列表。 */
const prepareRound = async (
  round: ExportRound
): Promise<{
  question: string
  images: string[]
  files: string[]
  thinking: { text: string; seconds: number | null } | null
  answerHtml: string
  answerMarkdown: string
  sources: { index: number; url: string; title: string }[]
}> => {
  const { user, assistant } = round
  const images: string[] = []
  const files: string[] = []
  for (const file of user.files) {
    if (!file.isImage) {
      files.push(attachmentName(file.name, file.size))
      continue
    }
    const blob = await db.loadFile(file.id).catch(() => undefined)
    if (blob) {
      const dataUri = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => resolve('')
        reader.readAsDataURL(blob)
      })
      if (dataUri) {
        images.push(`<img src="${dataUri}" alt="${escapeHtml(file.name)}" />`)
        continue
      }
    }
    images.push(`<span class="img-missing">${escapeHtml(file.name)}</span>`)
  }

  let thinking: { text: string; seconds: number | null } | null = null
  let answerHtml = ''
  let answerMarkdown = ''
  let sources: { index: number; url: string; title: string }[] = []
  if (assistant) {
    const view = buildReplyView(assistant, false)
    const thinkText = view.steps
      .filter((step) => step.type === 'thinking')
      .map((step) => step.blocks.map((block) => block.thinking).join(''))
      .join('\n\n')
    if (thinkText.trim()) {
      let seconds: number | null = 0
      let known = true
      for (const step of view.steps) {
        if (step.type !== 'thinking') {
          continue
        }
        for (const block of step.blocks) {
          if (block.elapsedSeconds !== undefined) {
            seconds += block.elapsedSeconds
            continue
          }
          if (block.startedAt === undefined) {
            known = false
            continue
          }
          seconds += ((block.endedAt ?? assistant.createdAt) - block.startedAt) / 1000
        }
      }
      thinking = { text: thinkText, seconds: known ? Math.max(1, Math.round(seconds)) : null }
    }
    if (view.answer) {
      const lines = [...view.sources]
        .map((source) => `${source.index}. [${source.title}](${source.url})`)
        .join('\n')
      answerMarkdown = `${stripCitations(view.answer.markdown)}${lines ? `\n\n**来源**\n\n${lines}` : ''}`
      sources = view.sources.map((source) => ({
        index: source.index,
        url: source.url,
        title: source.title,
      }))
      let html = mdToHtml(answerMarkdown)
      html = await highlightCodeBlocks(html)
      answerHtml = html
    }
    for (const block of assistant.blocks) {
      if (block.type === 'text' && block.isTemplate) {
        answerHtml += `<p class="template">${escapeHtml(block.text)}</p>`
        answerMarkdown += `\n\n> ${block.text}`
      }
    }
  }
  return { question: user.content, images, files, thinking, answerHtml, answerMarkdown, sources }
}

const roundCount = (rounds: ExportRound[]) => rounds.length

const exportRoundsMarkdown = (
  session: Session,
  rounds: ExportRound[]
): { name: string; blob: Blob } => {
  const parts: string[] = [`# ${session.title || '对话'}`, '']
  rounds.forEach((round, index) => {
    parts.push(`## 第 ${index + 1} 轮`, '', `**提问：** ${round.user.content}`, '')
    for (const file of round.user.files) {
      parts.push(`- 附件：${file.name}`, '')
    }
    if (round.assistant) {
      const view = buildReplyView(round.assistant, false)
      const think = view.steps
        .filter((step) => step.type === 'thinking')
        .map((step) => step.blocks.map((block) => block.thinking).join(''))
        .join('\n\n')
      if (think.trim()) {
        parts.push('<details><summary>思考过程</summary>', '', think.trim(), '', '</details>', '')
      }
      if (view.answer) {
        const lines = [...view.sources]
          .map((source) => `${source.index}. [${source.title}](${source.url})`)
          .join('\n')
        parts.push(stripCitations(view.answer.markdown), lines ? `\n**来源**\n\n${lines}` : '', '')
      }
      for (const block of round.assistant.blocks) {
        if (block.type === 'text' && block.isTemplate) {
          parts.push(`> ${block.text}`, '')
        }
      }
    }
  })
  return {
    name: `${session.title || '对话'}-导出.md`,
    blob: new Blob([parts.join('\n')], { type: 'text/markdown' }),
  }
}

const EXPORT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 40px 24px 80px; max-width: 860px; background: #fff; color: #1b1b1b;
  font: 16px/1.75 system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
header { border-bottom: 1px solid #e5e5e5; margin-bottom: 28px; padding-bottom: 16px; }
h1 { margin: 0 0 8px; font-size: 26px; }
.meta { margin: 0; font-size: 13px; color: #888; }
.round { margin: 0 0 36px; }
.who { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.q .who { color: #4d6bfe; }
.a .who { color: #0a7d51; }
.q .bubble { background: #f5f6f7; border-radius: 12px; padding: 12px 16px; white-space: pre-wrap; word-break: break-word; }
.files { margin-top: 8px; font-size: 13px; color: #666; }
.files .size { margin-left: 6px; color: #999; font-size: 12px; }
.images img { max-width: 260px; border-radius: 10px; margin: 6px 8px 0 0; vertical-align: top; }
.images .img-missing { font-size: 13px; color: #999; margin-right: 10px; }
details.think { margin: 10px 0; font-size: 14px; color: #666; }
details.think summary { cursor: pointer; }
details.think div { white-space: pre-wrap; background: #fafafa; border-left: 3px solid #ddd; padding: 8px 12px; border-radius: 6px; }
.answer { word-break: break-word; }
.answer :is(h1, h2, h3, h4) { margin: 18px 0 8px; }
.answer p { margin: 10px 0; }
.answer pre { background: #f6f8fa; border-radius: 8px; padding: 12px 14px; overflow-x: auto; font-size: 13.5px; line-height: 1.6; }
.answer code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.answer :not(pre) > code { background: #f0f1f2; border-radius: 4px; padding: 1px 5px; font-size: 90%; }
.answer blockquote { margin: 10px 0; padding: 2px 14px; border-left: 3px solid #d8d8d8; color: #555; }
.answer table { border-collapse: collapse; margin: 10px 0; }
.answer :is(th, td) { border: 1px solid #ddd; padding: 5px 10px; }
.sources { margin: 10px 0 0; padding-left: 22px; font-size: 13.5px; color: #4d6bfe; }
.sources a { color: inherit; }
.template { background: #fff8e6; border-radius: 8px; padding: 8px 12px; color: #8a6d1a; }
a { color: #4d6bfe; }
`

const exportRoundsHtml = async (
  session: Session,
  rounds: ExportRound[]
): Promise<{ name: string; blob: Blob }> => {
  const sections: string[] = []
  for (const [index, round] of rounds.entries()) {
    const { question, images, files, thinking, answerHtml, sources } = await prepareRound(round)
    const thinkHtml = thinking
      ? `<details class="think"><summary>已思考（用时 ${thinking.seconds ?? '?'} 秒）</summary><div>${escapeHtml(
          thinking.text
        )}</div></details>`
      : ''
    sections.push(`<section class="round">
<div class="q"><div class="who">第 ${index + 1} 轮 · 我</div>
${question ? `<div class="bubble">${escapeHtml(question)}</div>` : ''}
${images.length ? `<div class="images">${images.join('')}</div>` : ''}
${files.length ? `<div class="files">${files.join('<br />')}</div>` : ''}
</div>
<div class="a"><div class="who">DeepSeek</div>
${thinkHtml}
${answerHtml ? `<div class="answer">${answerHtml}</div>` : ''}
${sources.length ? `<ol class="sources">${sources.map((s) => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer">${escapeHtml(s.title)}</a></li>`).join('')}</ol>` : ''}
</div>
</section>`)
  }
  const title = session.title || '对话'
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}</style>
<style>${HIGHLIGHT_THEME_CSS}</style>
</head>
<body>
<header><h1>${escapeHtml(title)}</h1>
<p class="meta">${new Date().toLocaleDateString('zh-CN')} · ${roundCount(rounds)} 轮 · 由 Chat Browser 导出</p>
</header>
<main>
${sections.join('\n')}
</main>
</body>
</html>`
  return { name: `${title}-导出.html`, blob: new Blob([html], { type: 'text/html' }) }
}

export const exportRounds = async (
  session: Session,
  rounds: ExportRound[],
  format: ExportFormat
): Promise<{ name: string; blob: Blob }> =>
  format === 'html'
    ? exportRoundsHtml(session, rounds)
    : Promise.resolve(exportRoundsMarkdown(session, rounds))
