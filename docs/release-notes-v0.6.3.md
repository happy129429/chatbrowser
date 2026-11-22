# Release v0.6.3

关于页、自动更新检查、旧实例接管与 Claude ZIP 兼容修复。

## 重点

- **启动器版本握手**：固定端口 17890 上如果还跑着旧版本，新启动器会自动结束它再接管，避免「下载了新版却看到旧界面」。免 exe 便携版会明确提示先关闭旧窗口。
- **关于页**：设置或侧栏底部「关于」可查看版本、项目地址、上游致谢（DeepSeek chat-demo，MIT）与许可证（GPL-3.0-or-later）。
- **自动检查更新**：启动后静默查询 GitHub Release，有新版本时显示下载提示条（可「稍后」忽略该版本）。
- **Claude ZIP 导入**：兼容真实导出中 `text` 为空、正文在 `content: [{type:"text",text}]` 里的形态；此前会报「文件不完整」。
- **文件选择器**：统一为 `.zip,.json`（不再显示 `*.zip;*.zip;*.zip`）。

## 校验 / Checksums (SHA-256)

```
cad83016c1133d586847f9d8e4364c1bad8257c0dbf103cc8f33a370200c17cf  windows-portable.zip
e375685a285d5bd9b01eba172cf576289a9580ab0f37210c58e8e5ce5917ac61  windows-x64.zip
6fe9b4108e7452a1142a0c9a0a4a7146d31e81f1824659b91abc84748c5899df  linux-x64.tar.gz
ecc40370c26778f31d49a95b37a741cd258e8ea980beae6ed32eb85f006e576e  chatbrowser-android-debug.apk
```

> 未签名提示：右键 zip → 属性 → 解除锁定；或使用 windows-portable.zip（免 exe）。
