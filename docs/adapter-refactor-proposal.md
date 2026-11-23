# 导入导出适配层重构方案

> 状态：阶段 1/2/4 已落地，阶段 3 部分落地；待 0.7.9 验证 · 2026-11-23
> 目标：统一内部模型与格式边界，不引入 DSL，不改变现有行为

## 1. 要解决的问题

当前导出是显式选择格式，导入是靠内容启发式识别；两边各有一套枚举和分发逻辑：

- 导出：`ExportFormat` + `ExportFormatPicker` + `backup.exportGroupSelection`
- 导入：`ExternalSource` + `detectExternalSource` + `externalToSessions`
- 分卷：`backup.ts` 里的 `PART_FILE` 文件名规则
- 组信息：extras 在适配器外单独提取
- 失败信息：只有成功/失败，没有“识别成什么、丢了什么”

结果：

- 导入结果不可解释，用户不知道识别成了哪个格式
- 导入导出不对称，新增格式要改多处
- `backup.ts` 同时承担文件分发、格式解析、建组、staging
- 适配器能力没有声明，UI 无法提示有损项
- 未来接 CLI/完整备份时，格式层和持久化层仍然粘在一起

## 2. 方案结论

采用：

- **类型化格式适配器**
- **注册表统一分发**
- **声明式元数据/能力描述**
- **统一 ImportBundle / ExportRequest**
- **编排层与适配器分离**

不采用：

- JSON/YAML 描述语言 + 解释器
- 用一套声明式映射同时表达导入和导出
- 为了抽象而重写消息模型
- 改变 IndexedDB 结构

核心判断：**描述负责“是什么、支持什么、选择了什么”，代码负责“怎么转换”。**

## 3. 分层

```text
UI
  └─ format registry（只读元数据）
       └─ 编排层（backup/export orchestration）
            ├─ ImportAdapter / ExportAdapter
            └─ core（Session / Message / SessionGroup + DB staging）

格式适配器依赖 core；core 不依赖任何格式。
```

### 3.1 核心模型保持不变

继续使用：

- `Session`
- `Message` / `AssistantMessage` / `UserMessage`
- `SessionGroup`

第一版不引入第二套消息模型。适配器直接产出 `Session`，导出适配器直接消费 `Session`。如果后续发现附件/引用/工具块在多个格式里重复，再抽子结构，不提前做。

### 3.2 格式元数据

```ts
type ImportFormatId = 'deepseek' | 'chatgpt' | 'claude' | 'openwebui' | 'turns' | 'generic'

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

type FormatDescriptor = {
  id: ImportFormatId | ExportFormatId
  label: string
  direction: 'import' | 'export' | 'both'
  capabilities: ImportCapabilities
  lossyNotes: string[]
}
```

元数据只用于：

- 生成导出格式选择器
- 导入后展示“识别为 X”
- 提示有损项
- 未来 CLI 的格式列表

不用于执行字段映射。

### 3.3 导入适配器

```ts
type FormatWarning = {
  code: string
  params?: Record<string, string | number>
}

type ImportBundle = {
  format: ImportFormatId
  sessions: Session[]
  extras: GroupExtra[]
  warnings: FormatWarning[]
  groupName?: string
  sourceName?: string
}

type ImportAdapter = {
  descriptor: FormatDescriptor
  detect(input: ImportInput): Detection
  read(input: ImportInput, context: ImportContext): Promise<ImportBundle>
}
```

`Detection` 需要包含：

```ts
type Detection = {
  matched: boolean
  confidence: number
  reason?: string
}
```

约定：

- 检测顺序固定，先具体后通用
- `generic` 永远最后
- 适配器不访问 DB，不建组，不写 staging
- 适配器返回 extras 和 warnings
- 单个会话失败不应让整个适配器崩溃；失败进 warnings
- 隐私过滤放在共享层或 Claude 适配器内，不依赖入口层记得跳过

### 3.4 导出适配器

```ts
type ExportRequest = {
  sessions: Session[]
  groups: SessionGroup[]
  options: Record<string, unknown>
  anonymize: boolean
}

type ExportArtifact = {
  fileName: string
  blob: Blob
  warnings: FormatWarning[]
}

type ExportAdapter = {
  descriptor: FormatDescriptor
  write(request: ExportRequest): Promise<ExportArtifact>
}
```

注意：

- HTML/Markdown 分享导出和归档格式分开抽象，不强行塞进同一个 registry
- `deepseek` / `extended` / `claude` 继续由 `ExportFormatPicker` 选择
- `extended` 的 sidecar 仍然只在导出时写入，导入时由 compatibility 路径恢复

### 3.5 编排层

`backup.ts` 最终只做：

1. 接收用户选择的文件
2. 切分批次（分卷规则）
3. 找匹配的 adapter
4. 调用 `read` 得到 `ImportBundle`
5. 在一个事务里建组、写 staging、保存 extras
6. 返回导入报告

导入报告至少包含：

- 识别格式
- 会话数
- 附加信息条数
- warnings
- 原始文件名

导出编排只做：

1. 读取选中的组/会话
2. 找匹配的 export adapter
3. 生成 artifact
4. 返回给 UI 下载

## 4. 分卷与容器

分卷规则不应属于核心，也不应塞进每个 adapter 里。

建议单独一层：

```ts
type BatchResolver = {
  detect(files: File[]): boolean
  describe(files: File[]): BatchContext
}
```

第一版只实现 Claude 分卷：

- `conversations-*`
- `projects-*`
- `users-*`
- `memories-*`
- `light_metadata-*`

`BatchContext` 传给适配器，至少包含：

- `sourceName`
- `partNames`
- 是否 Claude 分卷

这样：

- `PART_FILE` 从 `backup.ts` 移出
- `light_metadata` 内个人文件跳过有明确上下文
- 单文件 `users.json` 可以选择静默忽略或报错，不污染 ZIP 逻辑

## 5. 识别与覆盖

### 5.1 默认流程

继续自动识别，但结果必须可见：

```text
导入完成
识别格式：Claude
会话：12
附加信息：4
提示：2 个未识别内容块
```

### 5.2 自有格式快速路径

自己的导出带格式标记：

- DeepSeek 归档：manifest
- 扩展 ZIP：`chatbrowser_ext.json` 增加 `format` / `schemaVersion`
- Claude 转换导出：顶层或文件名声明

自有格式不再靠猜，第三方格式才走启发式。

### 5.3 手动覆盖

第一版可以不做 UI，只在数据结构上预留：

```ts
type ImportOptions = {
  format?: ImportFormatId
}
```

当通用 `messages` 被误判时，后续再加“按指定格式重试”。

## 6. 隐私边界

延续 v0.7.8 规则：

- ChatGPT 单数 `user.json` / `user_settings.json`：账号个人数据，跳过；记忆摘要改从 `conversation_summaries.json` 读取
- Claude 复数 `users.json` / `login_history.json`：跳过
- `memories/<uuid>.json`：只取顶层内容；不保存 UUID/account_uuid/时间，`memory_files[].path` 仅用于标题括注
- 记忆/提示词内部半结构化文本不解析
- 通用 metadata JSON 的 raw fallback 需要单独确认

适配层重构不能改变这些行为，必须有隐私回归用例。

## 7. 实施阶段

### 阶段 0：基线

- 保存当前 e2e 结果
- 记录各格式导入后的会话数、extras 数、warning 数
- 不改任何输出

### 阶段 1：加壳，不改行为（已完成）

- 新增 `FormatDescriptor` / `ImportBundle` / `ImportAdapter`
- 现有解析函数包一层 adapter
- `backup.ts` 仍走原路径
- 验证输出完全一致

### 阶段 2：导入结果统一（已完成）

- `externalToSessions` 改为返回 `ImportBundle`
- detect 结果、warnings、extras 一起返回
- 导入完成 UI 显示识别格式和警告
- 保留旧入口兼容

### 阶段 3：导出注册表（选择器已接 registry，导出执行仍沿用原分支）

- `ExportFormat` 改为 registry descriptor
- `ExportFormatPicker` 从 registry 生成
- `exportGroupSelection` 调 adapter
- 保持文件名、sidecar、有损提示不变

### 阶段 4：分卷/隐私入口收口（已完成）

- `PART_FILE` 移到 BatchResolver
- 单文件个人数据行为明确
- 自有导出写格式标记
- 清理 `backup.ts`

### 阶段 5：可选

- 手动格式覆盖
- CLI 复用 registry
- 完整备份

## 8. 验收标准

- 现有 e2e 38 项全部通过
- 同一批样本导入的会话数、组名、extras、附件数不变
- DeepSeek/ChatGPT/Claude/z.ai 识别结果与现在一致
- 导出文件名、sidecar 结构、格式选项不变
- 不新增 DB migration
- 不增加构建产物体积上限
- 隐私用例继续通过
- 导入后能看到格式名和 warnings

## 9. 风险

| 风险                    | 处理                                              |
| ----------------------- | ------------------------------------------------- |
| 过度抽象                | 第一阶段只加类型和 wrapper，不改行为              |
| 识别回归                | 保存 detect 基线，固定优先级，generic 最后        |
| ZIP 流式读取被抽象破坏  | archive adapter 保留 File/Blob 输入，不强行纯函数 |
| warnings 变成硬编码文案 | warning 只存 code + params，UI 负责 i18n          |
| 导入导出强行对称        | 允许 import-only / export-only / both             |
| 自有格式标记破坏兼容    | 只写扩展 sidecar，不改 DeepSeek 官方字段          |
| 分卷规则扩散            | 单独 BatchResolver，不进 adapter                  |

## 10. 明确不做

- DSL/解释器
- 新格式适配（Gemini/Kimi 等另开任务）
- 完整备份
- CLI/API
- 嵌套组
- 消息模型重写
- 改变官方兼容 ZIP 的字段

## 11. 已确认

1. 先完成内部抽象，再改 UI；当前格式提示和空内容提示已接入基础导入路径。
2. 导入结果需要显示识别格式；有损格式标记 warning。绿色/黄色/红色图标作为后续视觉细化。
3. 自有扩展 ZIP 的 `format` / `schemaVersion` 用于跳过启发式识别和后续迁移，等到导出注册表阶段再加。
4. 账号个人数据文件单独导入时提示「无内容」；其他隐私文件按同一规则处理。
5. BatchResolver 保留通用容器接口，当前只实现 Claude 分卷，后续可加 ChatGPT/Gemini 分卷。
