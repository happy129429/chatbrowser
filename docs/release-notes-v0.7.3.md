# Release v0.7.3

Claude 注入式系统提示词、更新检查限流提示与构建版本资源修复。

## Claude

- `content[]` 中的 `injected_prompt_block`（`<system-reminder>` / memory snapshot）不再被当作未知块丢弃
- 提取 `prompt` 作为会话级系统提示词，去重后显示在会话顶部「系统提示词」面板
- 其它未知块仍显示「未导出的内容块」提示

## 更新检查

- 区分 GitHub API 限流（未认证 60 次/小时/IP）与网络失败
- 限流时显示额度恢复时间，不再只提示「稍后重试」

## 构建

- Windows 版本资源在 `winres.json`（版本号）变化时重新生成，修复 exe 文件属性版本滞后

## 校验 / Checksums (SHA-256)

```
3b39d3a165cafa7908b76af90b11260a275f15ae0c42dedc58138fe20ef0ea57  windows-portable.zip
89b694bce00bf44efeecf9cbf2206171fe0182e975158e9958b2e1474f2f793a  windows-x64.zip
78ce52c88c2ee11069126041390b4016311b7928951ca1c4c9b2e3a06331ab74  linux-x64.tar.gz
f8cad7bd34de20e1043f05b0ceeb81dec56120e61cf80d3832dc07953fe5703b  chatbrowser-android-debug.apk
```
