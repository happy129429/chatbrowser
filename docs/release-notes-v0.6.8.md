# Release v0.6.8

格式转换导出、Claude 真实导出兼容、安全拒绝原文查看与 z.ai 导入修复。

## 导出为…

- 组或单会话统一入口：会话菜单/分组菜单「导出为…」打开格式选择弹窗
- 支持：
  - **DeepSeek 兼容 ZIP**：仅官方字段
  - **DeepSeek 扩展 ZIP**：旁路文件 `chatbrowser_ext.json` 保存会话系统提示词与分组信息（含 extras），重新导入时恢复
  - **Claude JSON**：`conversations.json` 形态（有损：仅当前分支文本）
- **匿名化 ID** 选项：会话/消息/附件 ID 重映射为随机值，保留 parent/分支结构，时间与标题不变

## Claude

- 按真实导出解析 `content` 块：`thinking` 与 `text` 分离，思考按时间线展示（此前 `text` 是思考+正文拼接，导致混排）
- 支持 thinking 的 summaries/耗时、`thinking_hidden`、单会话对象外层形态
- `text` 仅在缺少 content 块时作为回退

## 安全拒绝回复

- 导入时保留原始 thinking/正文（此前被丢弃），界面默认仍只显示模板提示
- 归档浏览可点「显示原始内容」查看被拦截前已下发的思考与正文（仅本地查看）
- 注意：旧版本已导入的拒绝回复原始内容无法恢复，需重新导入

## z.ai / 导入

- z.ai/OpenWebUI 对象树在父链断裂时回退到全量时间顺序，避免只导入分支末端
- 统计面板新增口径说明：仅统计带用量数据的归档（DeepSeek 原生）
- 已知限制：z.ai「导出已归档对话」只包含首条用户提问正文，其余消息仅元数据（导出端问题）

## 其他

- e2e 增至 26 项（拒绝原文展开、Claude 思考分离、导出弹窗等）

## 校验 / Checksums (SHA-256)

```
8161c8a969076b841546ae2901e82420cec8e427d37809cee59b470e2187f0a1  windows-portable.zip
9d1b70decb79b22018cb87bc445be3fe4df8ab7cedec11d7eaf47a9a2a2f222c  windows-x64.zip
2b57ef0b4ddca268f7cbddf511b598f217b6bcf7d8325e3687dddc63283b9266  linux-x64.tar.gz
ba688800bc59fa1ca7c68075e2e0f9318332b89e827599106168fcb0b5495255  chatbrowser-android-debug.apk
```

> 未签名提示：右键 zip → 属性 → 解除锁定；或使用 windows-portable.zip（免 exe）。
