import clsx from 'clsx'
import { useState } from 'react'
import type { FileAttachment } from '../../services/chat/types.js'
import { IconPhotoErrorFill20 } from '../base/icons.js'
import { FileCard } from '../files/FileCard.js'
import { useFileView } from '../files/useFileView.js'
import styles from './MessageFile.module.css'

/**
 * 消息里的附件：
 * - 图片：纯图片显示 120×120 缩略图，与文件混排时为 64×64；
 *   本地没有原件（非图片附件或缺失条目）时只展示元信息。
 * - 文件：显示文件卡片。
 */
export const MessageFile = ({ file }: { file: FileAttachment }) => {
  const { image, url, link } = useFileView(file.id, file.name)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (image && url !== null) {
    const preview = url ? (
      failedUrl === url ? (
        <span className={styles.failedIcon} role="img" aria-label={file.name}>
          <IconPhotoErrorFill20 />
        </span>
      ) : (
        <img src={url} alt={file.name} onError={() => setFailedUrl(url)} />
      )
    ) : null

    // 正常态：链接到原件
    return link ? (
      <a className={clsx(styles.image, styles.imageThumb)} {...link} title={file.name}>
        {preview}
      </a>
    ) : (
      // 原件还没加载出来（极短暂）
      <div className={styles.image} />
    )
  }

  return <FileCard name={file.name} size={file.size} link={link} />
}
