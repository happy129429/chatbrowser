/** 预留的默认组：所有无组会话迁入；不可删除/解散。 */
export const DEFAULT_GROUP_ID = 'default-group'

export const isDefaultGroup = (id: string | null | undefined) => id === DEFAULT_GROUP_ID
