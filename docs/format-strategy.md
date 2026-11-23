# 格式适配与下一步方向

> 基于 v0.7.8 · 2026-11-23
> 具体重构方案见 `docs/adapter-refactor-proposal.md`。

## 1. 当前状态

现在已经支持：

- DeepSeek 官方 ZIP：分支树、思考、工具步骤、搜索来源、图片原件、token
- ChatGPT ZIP/JSON：`mapping` 树、当前分支、系统提示词、记忆摘要（`conversation_summaries.json`）
- Claude ZIP/JSON：`chat_messages`、content 块、UUID/parent 前缀链、摘要、项目、记忆
- Claude 分卷：多个 `conversations-* / projects-* / users-* / memories-* / light_metadata-*` 合并为一个组
- z.ai / OpenWebUI：`chat.history.messages` 对象树 + `currentId`
- `turn_history`：未验证样本，仅 best-effort
- 通用 `messages` / `chat_history` / `turns` / `records`

外部解析已经拆成：

```text
history/external/
  common.ts     共享类型、时间、文本、轮次、来源识别
  claude.ts     Claude content / files / parent 树
  chatgpt.ts    ChatGPT mapping 树
  openwebui.ts  chat.history.messages 树
  turns.ts      turn_history 单会话壳
  generic.ts    通用 messages
  extras.ts     组附加信息、隐私过滤
  zip.ts        ZIP 扫描
  dispatch.ts   来源分发
  index.ts      对外导出
```

## 2. 目前的主要问题

### 2.1 格式识别靠内容，入口分流靠文件名

- ZIP 内扫描按 JSON 内容识别，文件名只用于忽略和记忆文件判断
- 但“多选分卷合并”依赖文件名正则
- 账号个人数据文件单独导入时，单 JSON 入口现在也会返回「无内容」，但入口仍有两套分流
- 直接选 `light_metadata-000.zip` 时，里面只有个人数据，最终会报无法识别

### 2.2 适配器缺少统一契约

现在每个来源返回 `Session[]`，extras 另行收集。问题：

- 能力不统一：谁能保留分支、思考、引用、附件、项目、记忆，没有声明
- 警告不统一：未导出块、缺失正文、跳过字段，都是各写各的
- 测试不统一：每个来源的 fixture 和断言散落
- 未来做 CLI 时，格式核心仍和浏览器/ZIP/DB 耦合

### 2.3 隐私规则分散

已经确定：

- ChatGPT 单数 `user.json` / `user_settings.json`、Claude 复数 `users.json` / `login_history.json` 一律跳过；各自单独导入提示无内容
- `memories/<uuid>.json` 只取顶层内容；不保存 UUID/account_uuid/时间，`memory_files[].path` 仅用于标题括注
- 记忆和系统提示词内部的半结构化文本不解析

仍需决定：

- 直接单独导入 `light_metadata-000.zip` 时是否静默忽略（里面只有被跳过的 users/login）
- 其他含 `memory/metadata` 的 JSON 是否默认不落 extras
- 单个个人数据文件被直接选中时是否静默忽略

### 2.4 附件与保真度

- 图片原件：DeepSeek 支持；其他来源大多只有元数据
- 非图片附件：基本只有文件名
- Claude 记忆/项目内容：只保留顶层文本，不解析内部结构
- 分支：Claude 可重建；ChatGPT 只取当前分支；通用格式通常没有分支

## 3. 建议的适配器抽象

目标不是大改，而是让每个格式都有同一张“能力卡”。

```ts
type ImportCapabilities = {
  branches: boolean
  thinking: boolean
  citations: boolean
  tools: boolean
  attachmentsMetadata: boolean
  attachmentBytes: boolean
  systemPrompt: boolean
  projects: boolean
  memories: boolean
  splitParts: boolean
}

type ImportBundle = {
  sessions: Session[]
  extras: GroupExtra[]
  warnings: ImportWarning[]
  groupName?: string
  groupColor?: string | null
  sourceName?: string
}

type ImportAdapter = {
  id: string
  detect(input: unknown): boolean
  capabilities: ImportCapabilities
  parse(input: unknown, context: ImportContext): Promise<ImportBundle> | ImportBundle
}
```

配套原则：

- 检测顺序固定，先具体后通用
- 适配器只处理格式，不碰 IndexedDB/React
- 组名、extras、警告都由适配器返回，入口统一落库
- 隐私过滤放在共享层，不靠每个适配器自己记得
- 每个适配器必须有：检测样例、最小成功样例、隐私样例、失败样例
- 输出仍是我们现有的 `Session`，不引入第二套消息模型

## 4. 格式优先级

### 稳定维护

1. DeepSeek
2. ChatGPT
3. Claude
4. z.ai / OpenWebUI

### 下一批候选

按真实样本决定，不猜：

1. Gemini（Google Takeout）
2. Kimi
3. 豆包 / 通义
4. Grok / Perplexity
5. 其他用户实际提供的导出

规则：没有脱敏样本的格式不进入实现，最多保留 generic fallback。

## 5. 方向选择

### A. 格式广度（推荐先做）

- 加 Gemini / Kimi / 豆包等适配器
- 统一能力表和警告
- 目标是“主流平台能导入，且知道丢了什么”

### B. 保真度深度

- 附件原件、工具块、项目文件正文
- 需要更多真实样本和存储/权限设计
- 容易把范围拖大，建议按样本逐项做

### C. 数据所有权

- 完整备份
- CLI
- 本地 API
- 这些都要新的磁盘/服务契约，暂缓

### D. 组织方式

- Project / 文件夹 / 标签 / 嵌套组
- 当前组仍是导入批次容器
- 暂不改数据模型；Project 先作为会话元数据或筛选维度

## 6. 推荐路线

1. **收口 0.7.8**：隐私、记忆、sanitizer、文档（已完成）
2. **抽适配器契约**：不新增格式，先让现有四个来源走统一返回结构
3. **按样本加 1–2 个新格式**：Gemini / Kimi 优先
4. **补测试**：每个适配器的检测、隐私、警告、extras
5. **再评估**：完整备份 → CLI → 本地 API，顺序不要反

## 7. 明确不做

- 实时抓取/用户脚本
- 为了支持所有平台而猜字段
- 嵌套组
- 完整备份和 API 同时上
- 在没有样本时扩格式

## 8. 待确认

- 你实际最需要哪些平台？
- 其他文件名含 metadata 的 JSON 是否一律不落 extras？`light_metadata` 本身是 ZIP，内部 users/login 已跳过。
- 下一次优先“多格式”还是“附件原件”？
- 完整备份的恢复语义是否接受整体替换？
