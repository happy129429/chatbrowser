/**
 * 保存文件：浏览器走 <a download>，Android App（Capacitor）写入「文档」目录，
 * 因为系统 WebView 不支持 blob 下载链接。
 * 返回 'downloaded'（浏览器下载）或 'saved'（原生保存到文档目录）。
 */
export const saveBlob = async (name: string, blob: Blob): Promise<'downloaded' | 'saved'> => {
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor
  if (capacitor?.isNativePlatform?.()) {
    const [{ Filesystem, Directory }, base64] = await Promise.all([
      import('@capacitor/filesystem'),
      blobToBase64(blob),
    ])
    await Filesystem.writeFile({
      path: name,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    })
    return 'saved'
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
