/** 同一次导出的分卷文件模式（Anthropic 等）。 */
export const CLAUDE_PART_FILE =
  /^(conversations|projects|users|memories|light_metadata)(-\d+)?\.(zip|json)$/i

export type BatchContext = {
  resolver: string
  sourceName: string
  partNames: string[]
  /** 容器层给出的格式提示；适配器仍需按内容确认。 */
  formatHint?: 'claude'
}

export type ArchiveBatch = {
  files: File[]
  context: BatchContext
  /** 合并导入时的组名；单文件批次不设置。 */
  name?: string
}

/** 通用容器接口：以后可增加 Gemini Takeout、DeepSeek 分卷等。 */
export type BatchResolver = {
  id: string
  detect: (files: File[]) => boolean
  describe: (files: File[]) => { name: string; context: Omit<BatchContext, 'sourceName'> }
}

const claudeSplitName = (files: File[]) => {
  const first = files.find(
    (file) => CLAUDE_PART_FILE.exec(file.name)?.[1]?.toLowerCase() === 'conversations'
  )
  const kind = CLAUDE_PART_FILE.exec((first ?? files[0]).name)?.[1]?.toLowerCase()
  return kind ? `${kind}-export` : 'imported-export'
}

const resolvers: BatchResolver[] = [
  {
    id: 'claude-split',
    detect: (files) => files.length > 1 && files.every((file) => CLAUDE_PART_FILE.test(file.name)),
    describe: (files) => ({
      name: claudeSplitName(files),
      context: {
        resolver: 'claude-split',
        partNames: files.map((file) => file.name),
        formatHint: 'claude',
      },
    }),
  },
]

/** 多选分卷时合并为一个批次；未匹配容器规则的每个文件独立导入。 */
export const resolveArchiveBatches = (files: File[]): ArchiveBatch[] => {
  const resolver = resolvers.find((item) => item.detect(files))
  if (resolver) {
    const described = resolver.describe(files)
    return [
      {
        files,
        name: described.name,
        context: { ...described.context, sourceName: files.map((file) => file.name).join(', ') },
      },
    ]
  }
  return files.map((file) => ({
    files: [file],
    context: { resolver: 'single', sourceName: file.name, partNames: [file.name] },
  }))
}
