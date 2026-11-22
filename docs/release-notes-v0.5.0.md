# Release v0.5.0

本地 AI 对话浏览器 —— 加载 DeepSeek 导出的历史对话 ZIP，只看不聊，数据全在本地。
A local DeepSeek chat-history browser that loads exported ZIP archives. No API, no server, data stays on your device.

## 下载 / Downloads

| 文件 / Asset | 平台 / Platform | 说明 / Notes |
| --- | --- | --- |
| `windows-x64.zip` | Windows 10/11 | 解压双击 `chatbrowser.exe`；屏幕出现无地址栏应用窗口 / unzip and run the exe |
| `linux-x64.tar.gz` | Linux x86_64 | 解压运行 `./chatbrowser`（含图标与 .desktop）/ extract and run |
| `chatbrowser-android-debug.apk` | Android 6+ | debug 签名，直接安装 / debug-signed, sideload directly |

> 数据按 origin 隔离：桌面启动器固定 `127.0.0.1:17890`，重启保留；开发服务器、file://、Android 各自独立。
> Android 导出文件保存在「文档」目录。

## 本版亮点 / Highlights

- **桌面单文件启动器**（Windows / Linux）：内嵌全部前端资源，双击即用，固定端口保证存储稳定；Chromium 系浏览器 `--app` 独立窗口
- **Android APK**（Capacitor）：完全离线、无需任何服务端；导出自动写入文档目录
- 三平台应用图标（exe 图标 / Linux 图标与菜单项 / Android 自适应图标）
- 端到端冒烟测试 `pnpm e2e`（导入、搜索跳转、轮次导航、刷新恢复、轮次导出、统计）

## 自 v0.4.0 以来的变化 / Since v0.4.0

### 新增
- 桌面启动器与 Android 打包（`pnpm desktop` / `pnpm android:apk`）
- 应用图标生成流水线（`pnpm icons`，从 `assets/icon.svg` 生成 ico/png/Android mipmap）
- 桌面端会话分享按钮移至右上角（与移动端一致）；移动端分享操作栏改为两行布局
- Android/原生环境下导出走系统「文档」目录

### 修复
- Windows 启动器首页 301 重定向循环（改用 `http.ServeContent` 直接输出内嵌文件）
- Windows 启动器未能在 PATH 找到浏览器时退回普通标签页：现会探测 Edge/Chrome 的标准安装路径，用 `--app` 打开无地址栏窗口
- 跳转锁定期间的用户滚动不会再丢失阅读位置记忆
- 会话气泡在部分窗口宽度下的异常折行（分享复选框布局回归）
- 轮次导航悬停浮层尺寸与单行文本

## 数据说明 / Data

所有会话、图片附件、分组与设置均存于浏览器/WebView 的 IndexedDB 与 localStorage；源 ZIP 不受影响。换设备请重新导入 ZIP，或用「导出所有历史对话」迁移。
