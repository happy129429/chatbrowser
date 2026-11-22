# chatbrowser

[English](README.md) | 简体中文

基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) fork 的**本地对话历史浏览器**：不再连接 DeepSeek API，而是加载官方客户端导出的**历史对话 ZIP**（`deepseek_data-*.zip`），沿用原界面完整渲染，完全本地运行，无需 API Key。

> **致谢**：本项目由 **GLM-5.3-Flash（Z.ai）** 开发，人类参与者仅提出原始想法与反馈。饮水思源——界面上大量优秀的 UI 与消息渲染管线来自上游 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)，特此致谢。

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

## 功能

- 导入一个或多个历史导出 ZIP；每次导入生成一个归档组，**增量导入**，不覆盖已有数据。
- 完整还原对话渲染：Markdown、代码高亮、KaTeX 公式、Mermaid 图表、深度思考时间线、联网搜索步骤与来源引用、消息分支与版本切换、图片附件（非图片附件仅展示元信息）。
- 归档组如同浏览器标签页组：重命名、配色、折叠、在组间移动会话、合并、解散、导出组为 ZIP、删除。所有整理只改本地库，**不动源文件**。
- 全局文本搜索：覆盖标题、提问与回答正文，摘录高亮，点击跳转定位；归一化匹配（大小写、全半角、空白）并带子序列模糊降级。
- 按轮次勾选导出会话：自包含 HTML（渲染后的 Markdown、MathML 公式、代码高亮、来源列表）或 Markdown 文件。
- 使用浏览器内置语音合成朗读回答，无需 TTS 服务。
- 界面语言默认跟随浏览器（可手动选简体中文 / English）、明暗主题、移动端布局。

## 数据与存储

导入的会话、分组元数据与图片原件存放在浏览器 IndexedDB；语言、主题等偏好存放在 localStorage。应用完全本地运行，除你主动点击的搜索结果链接外不发起任何网络请求。设置 → 数据管理可清空全部本地数据。

组导出与「导出所有对话」沿用原始归档格式，可再次导入本应用或官方客户端。

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
