# Release v0.7.0

Claude 字段利用（阶段二）：引用来源、思考状态与增强导出。

## 渲染

- Claude `content[].citations` 映射为来源引用：正文末尾显示可悬停/点击的引用角标
- thinking 块保留并展示 `signature`、`truncated`、`hidden` 状态；思考区显示「思考已截断 / 思考内容已隐藏」徽标
- thinking 开始/结束时间写入 startedAt/endedAt，思考用时更准确

## 增强格式

- `chatbrowser_ext.json` 新增消息级扩展：按归档消息 ID + 块序号保存 citations 与 thinking 状态
- 扩展 ZIP 回导时自动恢复引用和思考标记
- Claude JSON 导出补齐：thinking 块（含 signature/truncated/hidden/时间）、text 块 citations、附件 files 元数据、parent_message_uuid 链、会话 summary

## 其他

- e2e 增至 28 项（引用角标、思考截断标记）
- 修复扩展 sidecar 未写入消息级扩展的问题

## 校验 / Checksums (SHA-256)

```
7a5ffd7a6e71a4dcafb92761706e75a9e8cbd778eb07289644ca2e811989ad85  windows-portable.zip
e56542ef29bfa3a85598379be3ca787eaaa0feb9bb0891ab6d061afb4cde799b  windows-x64.zip
e8b5ff5ad54f16150bf23ffbec799406306d5b89f092d677b75a91e5cccba6cc  linux-x64.tar.gz
9936ffc71589826c3532e8b0a23e14fbcf9a2e6a13c90892e59de52c46b9350e  chatbrowser-android-debug.apk
```
