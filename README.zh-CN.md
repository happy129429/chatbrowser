# chatbrowser

[English](README.md) | 简体中文

基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) fork 的**本地对话历史浏览器**：不再连接 DeepSeek API，而是加载官方客户端导出的**历史对话 ZIP**（`deepseek_data-*.zip`），沿用原界面完整渲染，完全本地运行，无需 API Key。

> **致谢**：本项目由 **GLM-5.3-Flash（Z.ai）** 与 **DeepSeek-V4.1-Flash-1017** 开发，人类参与者仅提出原始想法与反馈。界面与消息渲染管线大量来自上游 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)，特此致谢。

## 截图

| 归档列表                               | 全局搜索                                 |
| -------------------------------------- | ---------------------------------------- |
| ![归档列表](docs/screenshots/list.png) | ![全局搜索](docs/screenshots/search.png) |

| 轮次导航                                    | 统计                                |
| ------------------------------------------- | ----------------------------------- |
| ![轮次导航](docs/screenshots/round-nav.png) | ![统计](docs/screenshots/stats.png) |

## 快速开始

安装 Node.js 22.12+ 与 pnpm：

```sh
git clone https://github.com/happy129429/chatbrowser.git
cd chatbrowser
pnpm install
pnpm dev
```

打开 http://localhost:8090，把一个或多个导出 ZIP 拖到欢迎页（或使用「打开归档」按钮 / 设置 → 数据管理）。构建静态站点：

```sh
pnpm build
```

产物在 `dist/`，可部署到任意静态服务器。

## 下载

预构建产物见 [Releases](https://github.com/happy129429/chatbrowser/releases)：

| 包                        | 平台          | 使用方式                                                                                                           |
| ------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `windows-x64.zip`         | Windows 10/11 | 解压后双击 `chatbrowser.exe`，自动用 Edge/Chrome 打开无地址栏应用窗口（本地服务固定为 `http://127.0.0.1:17890`）。 |
| `linux-x64.tar.gz`        | Linux x86_64  | 解压运行 `./chatbrowser`（或把 `chatbrowser.desktop` 装进应用菜单）。                                              |
| `chatbrowser-android.apk` | Android 6+    | 直接安装 APK，打开后导入 ZIP 即可。                                                                                |

注意：

- **数据按 origin 隔离**：启动器固定使用 `127.0.0.1:17890`，重启后数据仍在；而开发服务器（`localhost:8090`）、`file://` 页面、Android App 各自是独立仓库。每台设备固定用一种打开方式即可。
- 桌面启动器优先 Chromium 系（Edge/Chrome/Chromium）以获得 `--app` 独立窗口，Firefox 只能退回普通标签页；IndexedDB 按浏览器隔离，固定用同一个浏览器才能看到同一份数据。
- Android 上导出文件保存到**「文档」目录**（系统 WebView 不支持 blob 下载链接）；桌面/网页端照常下载。
- 附件中的 APK 为 debug 签名（可直接安装）；自行构建见 `pnpm android:apk`。

### 构建产物

```sh
pnpm icons        # 从 assets/icon.svg 重新生成各平台图标（需 Chrome）
pnpm desktop      # Windows/Linux 单文件启动器 → release/desktop（需 Go）
pnpm android:apk  # debug APK → android/app/build/outputs/apk/debug（需 Android SDK + JDK 17）
```

## 功能

- 导入 DeepSeek 历史 ZIP，或 ChatGPT / Claude / z.ai 的导出（ZIP 或 JSON）；每次导入生成一个归档组，**增量导入**，不覆盖已有数据。外部对话保留系统提示词（会话内可查看），账号级记忆/自定义指令从组菜单「附加信息」查看。
- 完整还原对话渲染：Markdown、代码高亮、KaTeX 公式、Mermaid 图表、深度思考时间线、联网搜索步骤与来源引用、消息分支与版本切换、图片附件（非图片附件仅展示元信息）。
- 归档组如同浏览器标签页组：重命名、配色、折叠、在组间移动会话、合并、解散、导出组为 ZIP、删除。所有整理只改本地库，**不动源文件**。
- 全局文本搜索：覆盖标题、提问与回答正文，摘录高亮，点击跳转定位；归一化匹配（大小写、全半角、空白）并带子序列模糊降级。
- 按轮次勾选导出会话：自包含 HTML（渲染后的 Markdown、MathML 公式、代码高亮、来源列表）或 Markdown 文件。
- 使用浏览器内置语音合成朗读回答，无需 TTS 服务。
- 界面语言默认跟随浏览器（可手动选简体中文 / English）、明暗主题、移动端布局。

## 数据与存储

导入的会话、分组元数据与图片原件存放在浏览器 IndexedDB；语言、主题等偏好存放在 localStorage。应用完全本地运行，除你主动点击的搜索结果链接外不发起任何网络请求。设置 → 数据管理可清空全部本地数据。

组导出与「导出所有对话」沿用原始归档格式，可再次导入本应用或官方客户端。

## 已知问题

- 桌面启动器未签名：Windows SmartScreen/Defender 首次运行可能提示。可用 `windows-portable.zip`（PowerShell，无 exe）或解压前右键 ZIP → 属性 → 勾选「解除锁定」。
- 数据按 origin 隔离：启动器（`127.0.0.1:17890`）、开发服务器、`file://` 页面与 Android App 各自独立存储。
- 外部格式导入覆盖 ChatGPT / Claude / z.ai 的常见导出形态；官方改版可能需要补充字段映射，反馈时请附脱敏样本。

## 开发

| 命令          | 说明            |
| ------------- | --------------- |
| `pnpm dev`    | 启动开发服务器  |
| `pnpm build`  | 构建到 `dist/`  |
| `pnpm type`   | TypeScript 检查 |
| `pnpm lint`   | oxlint 检查     |
| `pnpm format` | oxfmt 格式化    |

```text
src/
  app/                 应用布局、主题与全局样式
  components/          侧栏、会话视图、消息渲染、搜索、设置
  i18n/                中英文案
  services/
    api/               保留的协议类型（渲染归档内容块所需）
    chat/              会话、归档组、存储、搜索、历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            基于 Web Speech API 的朗读
  utils/               通用工具
```

## 许可证

本项目以 [GPL-3.0-or-later](LICENSE) 再发布。它 fork 自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（DeepSeek 以 MIT 许可发布），按 MIT 条款要求，原 MIT 声明已保留在 [LICENSE](LICENSE) 中。第三方依赖遵循其各自许可证。
