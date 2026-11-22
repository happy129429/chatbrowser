import { useEffect, useState } from 'react'
import { getFileViewType, isImage } from '../../utils/file.js'
import { loadFile } from '../../services/chat/db.js'

const createViewUrl = (original: Blob, type: string) => {
  const blob = original.slice(0, original.size, type || 'application/octet-stream')
  if (type !== 'image/svg+xml') {
    return URL.createObjectURL(blob)
  }
  // SVG 缩略图用 data: 地址，单独打开图片时也与应用隔离。
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** 附件传 IndexedDB 原件 ID。 */
export const useFileView = (source: string, name: string) => {
  const type = getFileViewType(name)
  const [state, setState] = useState<{ source: string; type: string; url: string | null }>()
  useEffect(() => {
    let active = true
    const pending = loadFile(source)
      .then((blob) => (active && blob ? createViewUrl(blob, type) : null))
      .catch(() => null)
    void pending.then((url) => {
      if (active) {
        setState({ source, type, url })
      }
    })
    return () => {
      active = false
      void pending.then((url) => {
        if (url?.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
      })
    }
  }, [source, type])

  const url = state?.source === source && state.type === type ? state.url : undefined
  const image = isImage(type)
  const openInTab = type === 'application/pdf' || (image && type !== 'image/svg+xml')
  const action = openInTab ? { target: '_blank', rel: 'noreferrer' } : { download: name }
  return {
    url,
    image,
    loaded: state?.source === source && state.type === type,
    link: url ? { href: url, ...action } : undefined,
  }
}
