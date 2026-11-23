import { record, type GroupExtra, type Loose } from './common.js'

/** 从 ChatGPT 的 user.json / Claude 的 projects.json 中提取账号级附加信息。 */
export const extrasFromJsonFile = (name: string, parsed: unknown): GroupExtra[] => {
  const lower = name.toLowerCase()
  const extras: GroupExtra[] = []
  if (lower.endsWith('user.json')) {
    const user = record(parsed)
    if (!user) {
      return extras
    }
    const memories = Array.isArray(user.memories)
      ? user.memories.filter(
          (item): item is string => typeof item === 'string' && item.trim() !== ''
        )
      : []
    if (memories.length > 0) {
      extras.push({ title: '记忆', content: memories.map((item) => `- ${item}`).join('\n') })
    }
    for (const [key, label] of [
      ['custom_instructions', '自定义指令'],
      ['instructions', '自定义指令'],
    ] as const) {
      const value = user[key]
      if (typeof value === 'string' && value.trim()) {
        extras.push({ title: label, content: value.trim() })
      }
    }
  }
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
        .filter((doc): doc is Loose => doc !== null)
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
  if (lower.endsWith('users.json')) {
    const wrapper = record(parsed)
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(wrapper?.users)
        ? wrapper.users
        : wrapper
          ? [wrapper]
          : []
    const memories = new Set<string>()
    for (const item of list) {
      const user = record(item)
      if (!user) {
        continue
      }
      for (const value of [
        ...(Array.isArray(user.memories) ? user.memories : []),
        ...(Array.isArray(user.memory) ? user.memory : []),
      ]) {
        if (typeof value === 'string' && value.trim()) {
          memories.add(value.trim())
        }
      }
    }
    if (memories.size > 0) {
      extras.push({
        title: '记忆',
        content: [...memories].map((item) => `- ${item}`).join('\n'),
      })
    }
  }
  // 暂未结构化解析的元数据（memories / light_metadata 等）先原样保留
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
