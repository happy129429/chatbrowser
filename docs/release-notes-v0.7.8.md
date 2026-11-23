# Release v0.7.8

Claude 记忆/隐私处理与脱敏脚本修复。

## Claude

- `users.json` / `login_history.json` 视为个人数据，导入层直接跳过，不解析、不写入组附加信息
- `memories/<uuid>.json` 的顶层内容进入组附加信息：
  - `conversations_memory` → 「Claude 记忆」
  - `memory_files[].content` → 「Claude 记忆文件 N」
- 不保存用户 UUID 文件名、`account_uuid`、`path`、`updated_at`
- 记忆和系统提示词内部的半结构化文本暂不解析，按原文保留
- `turn_history` 样本身份降级为未验证兼容，不作为 Claude 官方格式依据

## 脱敏脚本

- 修复 UUID 脱敏破坏 Claude 前缀链的问题
- 完整 ID 生成前 16 位互不相同的合成 UUID
- 截断的 `parent_message_uuid` 映射为对应完整 UUID 的同长度前缀
- 旧版脚本生成的 `sanitized_conversations.json` 父链不可信，需要从原始文件重新脱敏

## 测试

- Claude mock 增加 `users.json` / `login_history.json` / `memories/<uuid>.json` 隐私标记
- e2e 验证记忆进入 extras，同时 UUID/路径不会泄漏

## 校验 / Checksums (SHA-256)

```
48ea2ab46f9062014b6e8f864a413e4afe02287305e6017812f1f9ab4a0cfd55  windows-portable.zip
02d55ec495b011bd843afde3447c3887f2a7396084a10c77a3fffbb09fd5e1de  windows-x64.zip
038f0bf73094f0df5332c387091e03f138f8108984583ebed2bd36e7ee753f54  linux-x64.tar.gz
e08b8ffe15d6d4d963d0bc570d52574179ba53842a6e94f23e584610312cada3  chatbrowser-android-debug.apk
```
