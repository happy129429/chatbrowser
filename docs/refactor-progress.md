# chatbrowser 改造进度文档

> 基于上游 deepseek-ai/chat-demo v0.1.3 的本地化改造。
> 目标：保留原 UI 风格，去掉「客户端」能力，改造成加载导出数据的**本地 AI 对话浏览器**。
>
> **状态（2026-11-21）：阶段 1–5 已全部完成并分阶段提交。** 剩余待办见文末。

## 提交历史

| 提交      | 阶段   | 内容                                                                                            |
| --------- | ------ | ----------------------------------------------------------------------------------------------- |
| `7dd055f` | 阶段 1 | 去客户端化：删除 API/SSE/上传/语音输入/输入框，store 瘦身，朗读改 speechSynthesis               |
| `90cc534` | 阶段 2 | ZIP 增量导入为新归档组（IndexedDB v12：groups 表 + groupId 索引），Welcome 拖放/多选入口        |
| `702b529` | 阶段 3 | 组管理：折叠/命名/六色配色/合并/解散/导出组 ZIP/删除，会话移动到组                              |
| `ba6eba4` | 阶段 4 | 全局文本搜索：归一化子串 + 子序列降级、摘录高亮、跳转定位闪烁 |
| 阶段 5 | 打磨 | i18n 孤儿 key 清理（187→135）、应用名与欢迎语、空列表态、README/package 更名 chatbrowser v0.2.0 |
| `9ba31bc` | 反馈轮 | 页面标题、语言默认跟随浏览器（中文变体回退简体、其余回退英文，可手动选）、搜索改为官方风格浮层（气泡图标 + 相对日期 + 命中词加粗）、会话拖拽入组、streaming 死 CSS 清理 |
| 同上 | 许可 | GPL-3.0-or-later 再发布；LICENSE 内保留上游 MIT 声明；README 致谢上游与 GLM-5.3-Flash 署名 |

## 一、已确认的产品决策

| 决策点     | 结论                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| 数据格式   | 第一版只支持 DeepSeek 官方导出 ZIP（格式 v3），`history/` 目录即格式边界，后续新格式加平行 loader       |
| 多归档组织 | 浏览器「标签页组」风格：每个 ZIP 导入为一个组，可移动/合并/解散组、导出组为 ZIP；拖拽后置，先做菜单操作 |
| 本地整理   | 允许重命名/删除/分组等，只改本地库，不动源文件                                                          |
| 缓存       | 保留 IndexedDB 持久化，导入过的数据关页面不丢                                                           |
| 搜索       | 先做文本模糊匹配（归一化子串 + 子序列降级），不做向量数据库                                             |
| 朗读       | 保留；改用浏览器内置 `speechSynthesis`（完全本地、免 API Key），UI 组件原样复用                         |
| 版本控制   | 用 git 分阶段提交                                                                                       |

## 二、已完成（阶段 1：去客户端化，未提交）

### 2.1 整体删除的模块（git rm）

| 删除内容                                                | 原职责                                      |
| ------------------------------------------------------- | ------------------------------------------- |
| `services/api/{client,errors,parseEvent,sse}.ts`        | Messages API 请求、SSE 流解析、错误分类     |
| `services/api/speech.ts`、`services/speech/recorder.ts` | TTS 请求、录音                              |
| `services/attachments.ts`、`services/uploadExts.ts`     | Files API 上传队列、格式白名单              |
| `services/location.ts`、`locationData.ts`               | 请求携带的地理位置                          |
| `services/chat/{drafts,latestReminder,reply}.ts`        | 输入草稿、系统快照、流式事件合并/请求构造   |
| `utils/resizeUploadImage.ts`                            | 上传前图片缩放                              |
| `components/chatInput/*`（11 个文件）                   | 聊天输入框、拖拽上传、语音输入、音频频谱    |
| `components/settings/{ApiKeyField,useApiKeyForm}.tsx`   | API Key 表单与校验                          |
| `components/messages/{ReadAloudButton,ReadingBars}*`    | 朗读按钮（待在 speechSynthesis 方案上恢复） |

### 2.2 保留但精简

- **`services/api/types.ts`**：只保留渲染归档数据所需的协议类型（内容块、工具块、引用、StopReason/Usage），删掉请求参数与流式事件类型。它是 `chat/types.ts`、`view.ts`、`toLocal.ts`、`toArchive.ts` 的类型基础。
- **`services/chat/types.ts`**：
  - `FileAttachment` 去掉 `serverId` / `imageSizeChecked`（纯上传概念）；
  - `AssistantMessage` 去掉 `prefix` / `latestReminder`，`error.kind` 放宽为 string（只承接旧客户端遗留数据）；
  - `ReplyStatus` 保留 `pending`/`streaming`（旧库数据可能存在），读取时按 stopped 收尾。
- **`services/chat/store.ts`**（1100 行 → 约 400 行）：只保留 `initChat` / `selectSession` / `newChat` / `renameSession` / `removeSession` / `selectMessageVersion` / `replaceHistory`（导入与清空仍用）/ 持久化绑定与会话缓存淘汰；发送、流式、重试、补传全部移除。旧数据里未完成的回复在载入时内联收尾。
- **`services/chat/describe.ts`**：HTTP 状态分类本地实现，去掉「去设置 API Key / 去充值」操作链接。
- **`services/settings.ts`**：只留语言、主题、侧栏收起（localStorage key 暂不迁移）。
- **`services/chat/history/toLocal.ts`**：同步适配新类型。

### 2.3 新增

- **`utils/file.ts`**：从原 `attachments.ts` 抽出的纯展示工具（按扩展名识别 MIME、isImage、formatSize 等），供附件卡片与缩略图使用。

### 2.4 组件适配（UI 外观不变，去掉交互）

- `App.tsx`：去掉上传通知、朗读停止、`ensureApiKey` 首启弹窗。
- `SessionView`：去掉底部输入框区。
- `MessageList`：去掉 streaming 跟随与「附件补传重试」入口，保留吸底滚动、分支切换、版本切换锚定。
- `AssistantMessage`：去掉重新生成/续写/朗读按钮与等待动画，保留复制、分支切换、来源汇总条、模板/错误提示。
- `ReplyArea`：去掉所有「进行中」动效（shimmer、搜索词轮播、秒表），归档数据按静态时间线渲染。
- `UserMessage`：去掉编辑重发与重试上传，保留复制与分支切换。
- `MessageFile` / `useFileView`：去掉上传态，仅展示图片缩略图/文件卡片。
- `Welcome`：问候语 + 「导入历史记录」按钮（打开设置数据页），替代原输入框；阶段 2 会改为拖放入口。
- `SettingsDialog`：通用页只留主题、语言；数据页保留导入/导出/清空。
- 未动：`Sider`、`SessionItem`、`CollapsedSider`、`MobileHeader`、搜索来源面板、Markdown/公式/mermaid 渲染、主题与移动端适配。

## 三、进行中

**朗读功能恢复**（刚接到反馈，正在做）：

1. 从 git 恢复 `ReadAloudButton.tsx`、`ReadingBars.tsx`（UI 不变：播放/停止/加载三态动画）。
2. 重写 `services/speech/readAloud.ts`：保持导出接口不变（`useReadAloud` / `toggleReadAloud` / `stopReadAloud`），底层从「TTS 裸 PCM 流 + AudioContext」换成 `window.speechSynthesis`：
   - 按 `locale` 选浏览器语音，markdown 记号在提交前做简单剥离；
   - `loading` 态映射为语音列表/utterance 就绪前，`playing` 态到 `onend`；
   - 错误统一走 `ttsFailed` toast；
   - 切换会话/消息时停止（App 中 `stopReadAloud` 的 effect 已移除，恢复时加回）。
3. 在 `AssistantMessage` 底部操作区加回朗读按钮。

## 四、下一步（按顺序）

1. **收尾阶段 1**
   - 完成朗读恢复；全局 grep 清理残留引用；
   - 环境装 pnpm（node 24 + npm 11 已就绪，`corepack enable` 或 `npm i -g pnpm`），`pnpm install`；
   - `pnpm type` + `pnpm lint` 全过；
   - git 提交阶段 1（单 commit，注明去客户端化范围）。
2. **阶段 2：打开 ZIP（新增组）**
   - IndexedDB v12：新增 `groups` 表，`sessions`/`sessionSummaries` 加 `groupId`；
   - 导入从「整库替换」改为「暂存 → 提交为新组」（复用现有 staging 事务机制）；
   - Welcome 改为拖放/多选 ZIP 入口 + 导入进度与错误提示；设置里的导入保留为兼容入口。
3. **阶段 3：组管理**
   - 侧边栏分组渲染：折叠、命名、配色（标签页组风格）；会话菜单「移动到组 / 取消分组」；
   - 组菜单：重命名 / 配色 / 合并到… / 解散 / 导出 ZIP（复用 `exportArchive`）/ 删除；
   - 导出产物需能被本应用和原版重新导入（互操作验收）。
4. **阶段 4：全局搜索**
   - 侧栏顶部搜索框；匹配域 = 标题 + 提问 + 回答正文；
   - 归一化子串优先、子序列模糊降级、多关键词 AND；
   - 结果面板（会话 → 命中消息摘录高亮）+ 点击跳转定位；
   - 实现上直接流式遍历 IndexedDB 会话，量级过大再建索引表。
5. **阶段 5：打磨**
   - 统计（会话数、token 用量、思考耗时）；空态/错误态文案；清理孤儿 i18n key 与死 CSS；
   - README、应用名（`chat-demo` → `chatbrowser`）、`dist` 产物 `file://` 直接打开验证。

## 五、风险与备注

- **存储配额**：导入大 ZIP（图片多）会占配额，后续可在导入时提示 Blob 占用。
- **朗读音质**：`speechSynthesis` 音色取决于系统/浏览器；若需要高质量可加回 TTS API 作为可选（需 Key），接口层已隔离在 `services/speech/readAloud.ts`。
- **旧数据兼容**：旧客户端留下的 `pending/streaming` 回复载入时按已停止收尾；旧错误文案 key 若被 i18n 清理移除，回退展示保存时的原文。
- **互操作**：组导出与全量导出均为原格式 v3，官方客户端可直接导入。

## 六、剩余待办（原型之后）

- **真实数据验证**：用官方客户端导出的 ZIP 手动走一遍导入/浏览/搜索/组操作/导出回导闭环（开发期未接触真实导出文件）。
- **统计面板**：会话数 / token 用量 / 思考耗时汇总（数据字段已保留）。
- **更多导出格式**：`history/` 目录即格式边界，后续为其他来源（如自建客户端）加平行 loader。
- **搜索会话内多命中**：同一会话最多展示 3 条命中，可在结果面板内展开完整命中列表。
