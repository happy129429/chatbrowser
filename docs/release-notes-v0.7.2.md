# Release v0.7.2

Claude 项目附加信息增强与部署文档。

## 导入

- Claude `projects.json` 兼容数组、`{projects:[...]}`、`{data:[...]}` 与单个项目对象
- 项目提示词支持 `prompt_template` / `system_prompt` / `instructions` / `custom_instructions` / `prompt`
- 项目文件（`docs[].filename/name/file_name`）列入组「附加信息」
- Claude `users.json` 的记忆字段也会进入组「附加信息」

## 文档

- README 新增「自建静态站（私有部署）」：pnpm build 后托管 dist、固定 URL/origin、HTTPS 建议、nginx 示例
- 使用方式表补充「Windows 免 exe 便携版」与自建部署
- README 增加 5 步快速上手（导入/浏览/整理/搜索/导出）
- 明确组「附加信息」只在存在内容时显示

## 其他

- e2e 增加 Claude 组附加信息断言（29+1 项）

## 校验 / Checksums (SHA-256)

```
f49faa336afa8ec9f377312a9433418c1441daadd28bd129aad93a32a9ebfa6e  windows-portable.zip
b5b0218795fe96f2df9744c24bf1a5492118d4919394832ffa8f5728ee3b88c0  windows-x64.zip
6f296f9e839a73d08be9c6e81a7e7b3a99e299f76da6e27b1e981ff71fb478e2  linux-x64.tar.gz
b385daef8f7540ec70d3a0aa7259165a70fffec055096c3b21bbad1fbb0f7d3b  chatbrowser-android-debug.apk
```
