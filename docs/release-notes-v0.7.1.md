# Release v0.7.1

合规补全、ZIP64 支持与导出 UI 统一。

## 合规

- 生成并内置 `THIRD_PARTY_NOTICES.txt`：项目许可 + 全部依赖的版权与许可全文（`pnpm build` 自动生成）
- 关于页新增「第三方许可」入口，可在应用内查看完整清单
- README 新增隐私说明、免责声明、商标声明；关于页新增「隐私与免责」入口
- 桌面/便携包内说明补充隐私、免责与商标提示
- 更新检查的隐私影响写清楚：请求 GitHub API，GitHub 可见 IP/UA，不发送本地数据
- 明确非官方项目，DeepSeek/ChatGPT/Claude/z.ai 商标归各自权利人

## 导入

- 支持 ZIP64（Claude 分卷/大导出常见），修复 `conversations-000.zip` 报「内容不完整」
- Claude 未支持的内容块（artifact/tool_use 等）不再静默消失：消息内提示「包含未导出的内容块（类型 × 数量）」
- 严格 JSON 不变（脱敏样本中的注释仍不支持）

## 导出与文案

- 会话分享/导出页新增「包含会话摘要」选项（HTML/Markdown 均生效）
- 可泛化的 DeepSeek 文案改为「AI 助手 / AI Assistant」；导出格式改为「AI 助手兼容 ZIP / AI 助手扩展 ZIP」
- 「导出为…」弹窗改为与设置页一致的 DS 风格列表（分隔线 + 单选点）
- README 增加格式支持程度表：DeepSeek 因上游同源支持最完整

## 校验 / Checksums (SHA-256)

```
0f776535cd7ec00d2bb52ed276fbc9fcb2b0cab6e549ba0d599b8f98821202db  windows-portable.zip
9db2452541d61448ad67d7c66dcf42e922e35820411d01ccc46c7561f839ecba  windows-x64.zip
8d8a7e3a8d8740d05eb248c92fb58baf9397c8cf1e0e188686cf10211ebdccd7  linux-x64.tar.gz
29514549e14e185a4a04c7fa82b15bc03f5e163b1d7d22de43bb9ce89fc677b5  chatbrowser-android-debug.apk
```

> 未签名提示：右键 zip → 属性 → 解除锁定；或使用 windows-portable.zip（免 exe）。
