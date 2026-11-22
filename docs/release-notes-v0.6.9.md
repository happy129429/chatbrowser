# Release v0.6.9

Claude 导出字段利用（阶段一）：会话摘要、原始消息链、附件元数据。

## Claude

- 会话 `summary` 以会话页折叠面板展示（Markdown），扩展 ZIP 的旁路文件也会保存并在导入时恢复
- 保留消息 `uuid` 与 `parent_message_uuid`：按父链还原当前分支，原始消息 ID 不再重新生成；导出数组包含分支时可通过现有版本切换器查看
- `files[]` / `attachments[]` 转为附件元数据：显示文件名与类型；Claude 导出不含原件，图片显示为文件卡而不是空白占位
- 思考块与正文继续按 `content` 解析，`text` 仅回退

## 其他

- 增强 ZIP sidecar 增加 `summary`
- e2e 增至 27 项（摘要/附件/原始消息 ID）

## 校验 / Checksums (SHA-256)

```
033f8873a0806d679c842bbc83e6223c82e44974a440bf30d602529d6366218b  windows-portable.zip
19cfe5129e683c20b1e83ec7b81da46128b2a1f9f751dc23ee1e979cec2c94f4  windows-x64.zip
6189c6bc8f11ad7a701c30b1294bcf2346dc919f552cf4e7d0481e9f3cf8e7d5  linux-x64.tar.gz
a562ebe9a2b901f374a26631dc70fa8c199207d22a0acc72ff4a8559d8315634  chatbrowser-android-debug.apk
```
