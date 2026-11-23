# Release v0.7.10

外部 ZIP 扫描修复与合规文档。

## 修复

- 修复外部 ZIP 扫描跳过 `manifest.json`、非 JSON 文件和超大 JSON 时未消费条目，导致 `ArchiveError` 并放弃整个 ZIP 的问题
- `manifest.json` 不再被误判为 DeepSeek 归档标记；仅 `chat_sessions/` 或 `chat_session_index.json` 才触发 DeepSeek 专用导入
- 改进 ChatGPT 官方 ZIP 的兼容性；如果仍有无法识别的目录或 JSON 形态，需要脱敏样本继续适配

## 文档

- 新增公开的兼容与开源合规说明（中英文）
- 内部审计、风险分级和通知处理保留在本地 `docs/internal/`
- 发布检查清单加入第三方许可证与 `THIRD_PARTY_NOTICES.txt` 检查

## 已知问题

- 部分 ChatGPT 官方 ZIP 仍需真实样本验证
- 超长会话首次加载可能卡顿
- 完整备份、CLI/API、嵌套组仍未实现

## 校验 / Checksums (SHA-256)

```
3e5ca904f027a6426faa1db6f9475ac3039826229264a3e2238be15b7fdf210a  windows-portable.zip
7c094a393b63c3fde559d0add0dfeb35646a2e73dd8a7ad945867d4a15bb5b6c  windows-x64.zip
3a4c1027ad0ef2d2429811e071bbba2ff945f7d4001df277a4270c65460eb5bc  linux-x64.tar.gz
e4b8172ec04a69fa001f0674706b842c0fb0054e512686debb1944abb1c209c9  chatbrowser-android-debug.apk
```
