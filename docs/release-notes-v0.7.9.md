# Release v0.7.9

导入适配层重构、格式提示与隐私边界收口。

## 导入适配层

- 新增统一的格式描述、`ImportBundle`、warnings 和适配器注册表
- ZIP、JSON、分卷导入统一走同一层；格式由适配器声明，不再散落在入口
- 新增通用 `BatchResolver`，Claude 分卷规则从导入编排中移出
- 导入结果会显示识别到的格式；有损格式标记 warning
- 账号个人数据文件单独导入时提示「无内容」

## 隐私与数据边界

- ChatGPT 单数 `user.json` / `user_settings.json` 视为账号个人数据，跳过
- ChatGPT 记忆摘要改从 `conversation_summaries.json` 读取，不保存内部 summary key
- Claude 复数 `users.json` / `login_history.json` 继续跳过
- Claude 记忆文件的 `path` 显示在标题括号中；不保存账号 UUID、`account_uuid` 或 `updated_at`
- 修复 DeepSeek 归档里存在 `user.json` 时被外部格式扫描抢先处理的问题

## 界面

- 组操作菜单限制最大高度并支持滚动，组多时底部操作仍可点击
- 组附加信息改为宽弹窗，整体可滚动，单条正文也可滚动
- 分卷导入提示保留来源格式与有损标记

## 已知问题

- 部分 ChatGPT 官方 ZIP 的目录/JSON 形态仍无法直接导入；需要脱敏样本后继续适配
- 超长会话（数百至一千多轮）可以导入，但首次加载可能卡顿
- 完整备份、CLI/API、嵌套组仍未实现

## 校验 / Checksums (SHA-256)

```
fc4a028a7050fe23dbfc9f58029d56137ad095d8013d1db38e4d7f0baaef2033  windows-portable.zip
0f2cfa501c9d6f6c5c5c82cdc36961419c3853283a9183a3bdc714f2675dd5e2  windows-x64.zip
2a3167c37594ffc7f6b84a0a74df880fc6695888da6adabf652e54a03838a8c8  linux-x64.tar.gz
c1d6ac3a22e78404333e6ba874e5fb12dec26774dfd169026dfa6db3c2224ee5  chatbrowser-android-debug.apk
```
