# Release v0.7.4

Anthropic 分卷导出、默认组与 Claude 父链兼容修复。

## 默认组

- 首次启动创建「默认组」（可改名/配色/导出/多选）
- 历史 `groupId = null` 会话自动迁入默认组，不再有独立的「未分组」状态
- 解散分组 / 删除组 → 会话进入默认组
- 默认组不可合并、解散或删除；组菜单顶部有说明
- 侧栏在没有任何会话时也会显示已有分组（包括空的默认组）

## Anthropic 分卷

- 同一个 ZIP 内含多个 `conversations-*.json` 时全部导入
- 一次选中 `conversations-* / projects-* / users-* / memories-* / light_metadata-*` 分卷（zip/json）自动合并为一个归档组，并提示
- 只有 memories/metadata 的 ZIP 也能导入/参与合并；未结构化解析的元数据原样放进组「附加信息」

## Claude

- `parent_message_uuid` 支持唯一前缀匹配（导出会截断 uuid），恢复完整可见分支，避免 AI 回复被隐藏
- 注入的系统提示词、思考、引用、附件元数据继续保留

## 其他

- 会话拖拽不再把内部 ID 作为纯文本拖到地址栏（改为可读标题 + 自定义 MIME）
- 更新检查限流提示、Windows 版本资源、第三方许可等沿用 0.7.2/0.7.3 的修复

## 校验 / Checksums (SHA-256)

```
77bf9f00e39f9e145241610fd9f7162f083cada90e59e489b495160de11fb57a  windows-portable.zip
b30af00ce900a4c96531b658ae4964be3b7f32430be20ac2c20ec4e7ac2c53fc  windows-x64.zip
f1f1f2cdf1931f8b0995e95d56e17de1b8c0d55d6f1f4586c915d2067e4b5264  linux-x64.tar.gz
0fc3e09b47bb906123c1d6d43e4720d61cb29eb209abde97985865c7af30c909  chatbrowser-android-debug.apk
```
