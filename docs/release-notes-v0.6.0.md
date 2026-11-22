# Release v0.6.0

本地 AI 对话浏览器 —— 加载 AI 聊天记录导出，只看不聊，数据全在本地。
A local AI chat-history browser. No API, no server, your data stays on your device.

## 下载 / Downloads

| 文件 / Asset              | 平台 / Platform | 说明 / Notes                                                                          |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| `windows-x64.zip`         | Windows 10/11   | 解压双击 `chatbrowser.exe`（Edge/Chrome 无地址栏窗口）                                |
| `windows-portable.zip`    | Windows         | **免 exe**：用系统自带 PowerShell 启动（`start-chatbrowser.cmd`），规避未签名程序拦截 |
| `linux-x64.tar.gz`        | Linux x86_64    | 解压运行 `./chatbrowser`（含图标与 .desktop）                                         |
| `chatbrowser-android.apk` | Android 6+      | 直接安装；数据与导出均在本机                                                          |

> 未签名提示：右键 zip → 属性 → 勾选「解除锁定」后再解压；SmartScreen 弹窗选「更多信息 → 仍要运行」。桌面版与便携版使用同一地址 `127.0.0.1:17890`，数据互通。

## 本版亮点 / Highlights

- **多格式导入**：DeepSeek 历史 ZIP、ChatGPT / Claude / z.ai 导出（ZIP 或 JSON）
- **系统提示词与账号附加信息**：外部对话的系统提示在会话页可折叠查看；记忆 / 自定义指令 / 项目提示词从归档组菜单「附加信息」查看
- **免 exe 的 Windows 便携版**（PowerShell 伺服，绕开未签名 exe 拦截）
- **应用内「关于」**：版本号 + 手动检查更新；新增 CSP 安全策略
- **发布自动化**：打 tag 后 GitHub Actions 自动构建 Windows/Linux/APK 并发布 Release（Android 支持配置签名密钥）
- **性能**：消息与列表项离屏渲染跳过（`content-visibility`），长会话更流畅；跳转锁静默期调优
- Android 导出写入系统「文档」目录；APK 支持 release 签名配置

## 自 v0.5.0 以来的变化 / Since v0.5.0

### 新增

- ChatGPT / Claude / z.ai 导入与附加信息查看
- Windows PowerShell 便携版；启动器自动发现 Edge/Chrome 并用 `--app` 开窗口
- 关于页与检查更新、CSP、三平台应用图标、GitHub Actions 发布流水线

### 修复

- DeepSeek ZIP 内的会话文件不会被误判为外部格式
- 导航条悬停浮层尺寸、用户气泡折行、跳转期间滚动位置丢失等

## 数据说明 / Data

会话、附件图片、分组与设置存于浏览器/WebView 本地；源导出文件不受影响。换设备请重新导入或用「导出所有历史对话」迁移。
