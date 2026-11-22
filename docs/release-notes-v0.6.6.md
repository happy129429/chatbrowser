# Release v0.6.6

GitHub Pages 在线版、README 重构与退出入口文案调整。

## 在线版

- 新增 GitHub Pages 部署：<https://happy129429.github.io/chatbrowser/>
- 以后每次推送 `v*` tag 自动重新部署（也可手动触发 Pages 工作流）

## 关于 / 退出应用

- 「退出应用」说明改为「关闭本地服务并退出」，使用正文黑色文字（不再灰色）

## 文档

- README（中/英）重构：区分网页版 / 桌面版 / Android 三种使用方式，数据隔离按入口列表说明，补充 Pages 链接与已知问题
- 重新生成 README 截图（列表、搜索、轮次导航、统计）
- 新增 `docs/release-checklist.md`：每次发版必须同步 Pages 与 README
- 新增 `docs/technical-outlook.md`：存档 WebView2 虚拟主机 / Tauri / Wails 原生外壳方案（暂不采用）

## 校验 / Checksums (SHA-256)

```
54c5a7771abda42eba17789276f2e049691acceac115af9d8a9de7d307f429c0  windows-portable.zip
af72bf6cc3c594c2d32d3cce79f4a67d5100672fe70c47fbb155c63f222e425b  windows-x64.zip
d941b5e01e1c7df617db24c6129bfd3195e7ef54a23dfadec014424991898752  linux-x64.tar.gz
b55e31667af66193480ff615e82e14f9f672f1648ffe7d10a9f36446d9fcf37b  chatbrowser-android-debug.apk
```

> 未签名提示：右键 zip → 属性 → 解除锁定；或使用 windows-portable.zip（免 exe）。
