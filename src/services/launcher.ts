/** 桌面/便携启动器固定使用 127.0.0.1:17890；其它入口（dev、APK、file://）不显示退出按钮。 */
export const isLauncherOrigin = () => {
  try {
    return window.location.hostname === '127.0.0.1' && window.location.port === '17890'
  } catch {
    return false
  }
}

/** 请求启动器结束自身进程，释放 exe/脚本文件占用。 */
export const quitLauncher = async () => {
  try {
    await fetch('/__chatbrowser/quit', { method: 'POST' })
    document.body.textContent = ''
    window.close()
  } catch {
    // 服务已退出时 fetch 可能直接失败，视为成功
    window.close()
  }
}
