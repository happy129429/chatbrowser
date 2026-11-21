/** 归档组的标签页组配色；色值对应 Sider.module.css 里的点色类。 */
export const GROUP_COLORS = ['blue', 'green', 'yellow', 'red', 'purple', 'cyan'] as const

export type GroupColor = (typeof GROUP_COLORS)[number]

/** 容错解析存储的配色值；未知或为 null 时返回 null（无颜色）。 */
export const toGroupColor = (color: string | null): GroupColor | null =>
  color !== null && (GROUP_COLORS as readonly string[]).includes(color)
    ? (color as GroupColor)
    : null
