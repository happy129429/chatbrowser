import { create } from 'zustand'

/** 全局搜索浮层：侧栏搜索入口触发 */
export const useSearchOverlay = create(() => ({ open: false }))

export const openSearchOverlay = () => useSearchOverlay.setState({ open: true })

export const closeSearchOverlay = () => useSearchOverlay.setState({ open: false })
