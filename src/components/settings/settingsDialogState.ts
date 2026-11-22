import { create } from 'zustand'

/** 设置弹窗的分组：通用设置 / 统计 / 数据管理 */
export type SettingsSection = 'general' | 'stats' | 'data'

/** 设置弹窗：侧边栏底部按钮可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })
