/** 预留的默认组：所有无组会话迁入；不可删除/解散。 */
export const DEFAULT_GROUP_ID = 'default-group'

export const isDefaultGroup = (id: string | null | undefined) => id === DEFAULT_GROUP_ID

/** 内置默认名；用于识别升级前未记录 nameCustomized 的组是否被改过名。 */
export const DEFAULT_GROUP_NAMES = new Set(['默认组', 'Default group'])
