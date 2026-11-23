# Release v0.8.0

跨平台导入适配层、Gemini Takeout 与隐私/存储边界。

## 导入

- 统一格式适配器、`ImportBundle`、warnings 与格式注册表
- 导入结果显示识别格式和有损提示
- 新增 Gemini Takeout `MyActivity.json` 与包含它的 ZIP 导入
- 新增通用 BatchResolver，Claude 分卷从入口编排中移出
- 修复外部 ZIP 跳过条目未消费导致的 ArchiveError，官方 ChatGPT ZIP 可直接导入
- ChatGPT 记忆摘要从 `conversation_summaries.json` 读取，兼容嵌套 JSON 字符串
- ChatGPT 附件元数据导入：文件名、类型、大小；不导入原件

## 隐私与存储

- ChatGPT `user.json` / `user_settings.json`、Claude `users.json` / `login_history.json` 跳过
- 个人数据文件单独导入提示「无内容」
- 设置页和 README 明确浏览器存储可能被清理、驱逐；启动时尽力申请 persistent storage
- Claude 记忆文件 path 作为标题括注展示，不保存账号 UUID

## UI

- 组操作菜单限制高度并支持滚动
- 组附加信息弹窗整体和单条正文均可滚动
- 分卷导入提示保留格式与有损标记

## 文档

- 新增各格式完整性对照：`docs/format-completeness.md`
- 新增中英文兼容与开源合规说明
- 内部交接、审计与官方参考移入忽略的 `internal/`

## 已知问题

- Gemini 活动日志中带引用的正文可能被 Google 导出为 `.`，无法恢复
- ChatGPT/Gemini 附件原件未导入；当前只保留元数据
- 超长会话首次加载可能卡顿
- 完整备份、CLI/API、嵌套组仍未实现

## 校验 / Checksums (SHA-256)

```
df7fddb237472f7f53a1a63d35a2b61a8377a06f4aa8d6b74a43a96c6416964b  windows-portable.zip
c8c45e662de930529b4407a2489df7e7cc14a70091e8ca68d89520918f96d35c  windows-x64.zip
e8b110f003d15e0a366341a0d8c108c3a486daf7e8249953fa8925f782449d41  linux-x64.tar.gz
db5feeecc1ae5085294b89bc034587e8e6bfed1ece1ae7b1b208ee5caf649504  chatbrowser-android-debug.apk
```
