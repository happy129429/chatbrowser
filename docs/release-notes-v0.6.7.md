# Release v0.6.7

修复 z.ai / OpenWebUI 原生导出与 `turn_history` 单会话封装的导入（依据脱敏真实结构）。

## 导入

- 新增 z.ai / OpenWebUI 原生形态：`chat.history.messages` 对象树 + `currentId`，按当前分支回溯父链；ID 被脱敏破坏时自动按时间/插入顺序降级
- 新增 `turn_history` 单会话封装：`session_metadata` 时间、`metadata.sender`（human / AI Model）、`global_context.system_instructions` → 会话系统提示
- 保持严格 JSON（脱敏样本中的 `//` 注释为人工标注，不属于导出格式）

## 其他

- e2e 增至 22 项：z.ai 原生分支选择、turn_history 系统指令、Claude content 数组等
- README 补充原生 z.ai / OpenWebUI 与 turn_history 格式说明

## 校验 / Checksums (SHA-256)

```
4abe42cfe1ca63170ca58d8d3b779b231793a711292d230469e2e635fbae1901  windows-portable.zip
849c801474ab1036bc55371f2e5a331b33d70679d96db297055e3d2fec75ec05  windows-x64.zip
e05bcc8a59e73294186b98da1ced1fddaee7ad5bda7e936b9d69255db2f049b6  linux-x64.tar.gz
c65dcf91c33ba405a622c0dfcc3c16c8b8bb6fd37574f40c14146f2f5b6fb61b  chatbrowser-android-debug.apk
```
