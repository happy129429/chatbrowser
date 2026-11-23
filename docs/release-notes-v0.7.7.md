# Release v0.7.7

收敛重构、未导出内容提示与归档重复导入修复。

## 收敛重构

- 单组与批量组操作共用同一套实现：删除、改色、合并都走批量入口
- “导出为…”和组批量导出共用格式选择器与导出 service
- 拆分 `history/external`：Claude / ChatGPT / OpenWebUI / turn_history / extras / ZIP 分模块
- 删除未使用的旧文案，统一导入/导出术语

## 未导出内容块

- Claude 的 `tool_use` / `tool_result` 等未导出块提示改为正文下方的独立提示条
- 使用小号次要色 + 浅色底，不再混入正文、复制内容或导出正文
- 安全拒绝布局调整：拦截提示 → “以下为原始内容”提示 → 原始思考/正文
- 没有原始内容时不再显示无效的“显示原始内容”按钮

## 修复

- DeepSeek 归档再次导入时不再覆盖已有会话：每次导入分配新的本地会话 ID
- 批量导出 → 再导入的闭环验证通过（会话数正确增加）
- 组批量导出的合并虚拟组继续保留 extras、摘要与扩展字段

## 校验 / Checksums (SHA-256)

```
bca9453d975007c6f8e424c72e2216ac94fb84774d6e2303e5f547fc82c7279a  windows-portable.zip
ffc45b3b7935195432b721ca5b24b729c6eedf366e5aee47acd5963199e3c845  windows-x64.zip
fcc3d2afbca7648ea5128e31af2c19db0506f43754410c19279cfddf71c2ad7a  linux-x64.tar.gz
8fc9ba3f34e5e0dda4a064dfd9269ba2827de00ec1006fdef45c929dcd44ae73  chatbrowser-android-debug.apk
```
