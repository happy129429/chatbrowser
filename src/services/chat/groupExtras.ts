import type { SessionGroup } from './types.js'

type GroupExtra = NonNullable<SessionGroup['extras']>[number]

const extraKey = (extra: GroupExtra) => `${extra.title}\u0000${extra.content}`

/**
 * 合并组级附加信息：保留目标组原有条目，再按源组顺序追加。
 * 完全相同的 title + content 去重；同标题不同内容时给源条目加来源组名。
 */
export const mergeGroupExtras = (
  target: SessionGroup | null,
  sources: SessionGroup[]
): GroupExtra[] => {
  const result: GroupExtra[] = []
  const seen = new Set<string>()
  const titles = new Map<string, Set<string>>()

  const add = (extra: GroupExtra) => {
    const key = extraKey(extra)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    result.push(extra)
    const contents = titles.get(extra.title)
    if (contents) {
      contents.add(extra.content)
    } else {
      titles.set(extra.title, new Set([extra.content]))
    }
    return true
  }

  for (const extra of target?.extras ?? []) {
    add(extra)
  }

  for (const source of sources) {
    for (const extra of source.extras ?? []) {
      if (seen.has(extraKey(extra))) {
        continue
      }
      let title = extra.title
      const contents = titles.get(title)
      if (contents && !contents.has(extra.content)) {
        const base = `${extra.title} (${source.name})`
        title = base
        let suffix = 2
        while (true) {
          const existing = titles.get(title)
          if (!existing || existing.has(extra.content)) {
            break
          }
          title = `${base} #${suffix}`
          suffix += 1
        }
      }
      add({ title, content: extra.content })
      seen.add(extraKey(extra))
    }
  }

  return result
}
