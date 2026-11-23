import { record, type GroupExtra } from './common.js'

const baseName = (name: string) => name.replace(/\\/g, '/').split('/').pop() ?? ''

/**
 * 账号个人数据文件：不解析、不导入。
 * Claude 用复数 users.json；ChatGPT 用单数 user.json 与 user_settings.json。
 */
export const isPersonalExternalFile = (name: string) =>
  /^(?:login_history|users)(?:-\d+)?\.json$/i.test(baseName(name)) ||
  /^user(?:_settings)?\.json$/i.test(baseName(name))

/** 旧名称保留，避免外部调用点一次性迁移。 */
export const isIgnoredExternalFile = isPersonalExternalFile

/** Claude memories/<account_uuid>.json：只取顶层记忆文本，不保存 UUID 或文件路径。 */
const isClaudeMemoryFile = (name: string) => {
  const lower = name.replace(/\\/g, '/').toLowerCase()
  return /(^|\/)memories\/[^/]+\.json$/.test(lower) || /(^|\/)memories(?:-\d+)?\.json$/.test(lower)
}

const memoryText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim()
  }
  return value === null || value === undefined ? '' : JSON.stringify(value, null, 2)
}

const claudeMemoryExtras = (parsed: unknown): GroupExtra[] => {
  const memory = record(parsed)
  if (!memory) {
    return []
  }
  const extras: GroupExtra[] = []
  const conversations = memoryText(memory.conversations_memory)
  if (conversations) {
    extras.push({ title: 'Claude 记忆', content: conversations })
  }
  const files = Array.isArray(memory.memory_files) ? memory.memory_files : []
  files.forEach((item, index) => {
    const file = record(item)
    const content = memoryText(file?.content)
    if (content) {
      const path = typeof file?.path === 'string' ? file.path.trim() : ''
      extras.push({
        title: path ? `Claude 记忆文件 ${index + 1}（${path}）` : `Claude 记忆文件 ${index + 1}`,
        content,
      })
    }
  })
  return extras
}

/** ChatGPT 的记忆摘要；不保存 summary key 等内部标识。 */
const chatGptMemoryExtras = (parsed: unknown): GroupExtra[] => {
  const values = Array.isArray(parsed) ? parsed : Object.values(record(parsed) ?? {})
  const summaries = values
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim())
  return summaries.length > 0
    ? [{ title: 'ChatGPT 记忆摘要', content: summaries.map((item) => `- ${item}`).join('\n') }]
    : []
}

/** 从 ChatGPT 记忆摘要 / Claude projects.json 中提取账号级附加信息。 */
export const extrasFromJsonFile = (name: string, parsed: unknown): GroupExtra[] => {
  if (isPersonalExternalFile(name)) {
    return []
  }
  if (isClaudeMemoryFile(name)) {
    return claudeMemoryExtras(parsed)
  }
  if (baseName(name).toLowerCase() === 'conversation_summaries.json') {
    return chatGptMemoryExtras(parsed)
  }
  const lower = name.toLowerCase()
  const extras: GroupExtra[] = []
  if (lower.endsWith('projects.json')) {
    // 兼容数组、{projects:[...]}、{data:[...]} 与单个项目对象
    const wrapper = record(parsed)
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(wrapper?.projects)
        ? wrapper.projects
        : Array.isArray(wrapper?.data)
          ? wrapper.data
          : wrapper
            ? [wrapper]
            : []
    for (const item of list) {
      const project = record(item)
      if (!project) {
        continue
      }
      const name =
        typeof project.name === 'string' && project.name.trim() ? project.name : '未命名项目'
      const prompt = [
        project.prompt_template,
        project.system_prompt,
        project.instructions,
        project.custom_instructions,
        project.prompt,
      ].find((value): value is string => typeof value === 'string' && value.trim() !== '')
      if (prompt) {
        extras.push({ title: `项目：${name}`, content: prompt.trim() })
      }
      const docs = Array.isArray(project.docs) ? project.docs : []
      const docNames = docs
        .map(record)
        .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
        .map((doc) =>
          typeof doc.filename === 'string'
            ? doc.filename
            : typeof doc.name === 'string'
              ? doc.name
              : typeof doc.file_name === 'string'
                ? doc.file_name
                : ''
        )
        .filter(Boolean)
      if (docNames.length > 0) {
        extras.push({
          title: `项目文件：${name}`,
          content: docNames.map((doc) => `- ${doc}`).join('\n'),
        })
      }
    }
  }
  // 暂未结构化解析的元数据先原样保留；账号个人数据已在上面跳过。
  if (extras.length === 0 && /(memory|memories|metadata)/i.test(name)) {
    const raw = JSON.stringify(parsed, null, 2)
    extras.push(
      raw.length <= 512 * 1024
        ? { title: `文件：${name}`, content: '```json\n' + raw + '\n```' }
        : { title: `文件：${name}`, content: '文件过大，未内联显示。' }
    )
  }
  return extras
}
