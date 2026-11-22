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
0cc156fb07097fcf07af80d37ed482dae6a105545b0e9937a89cde3db813fc9b  windows-portable.zip
06b6f8c93d29928ca95c31246c5bed506b1d1e43a54c4fc8447a355fea34e1e5  windows-x64.zip
e174e5bcdf8fe35c92d1ad7d6b77a347115e561076764831f63c4ef8adc3d94b  linux-x64.tar.gz
279f35863bfac89d87be2fa1ea33f842670ab5b46b0b165f0887d8b4a09cc2b6  chatbrowser-android-debug.apk
```
