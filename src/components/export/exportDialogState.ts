import { create } from 'zustand'

/** 导出目标：一个归档组或单个会话 */
export type ExportTarget = { kind: 'group' | 'session'; id: string }

export const useExportDialog = create<{ target: ExportTarget | null }>(() => ({ target: null }))

export const openExport = (target: ExportTarget) => useExportDialog.setState({ target })

export const closeExport = () => useExportDialog.setState({ target: null })
