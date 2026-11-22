# Release v0.6.4

关于页整理、应用内许可证、独立退出入口与启动器体验修复。

## 关于页

- 版本、项目主页、上游项目（DeepSeek chat-demo）与许可证一目了然
- 「已是最新版本 / 发现新版本」并入「检查更新」一行；有新版本时直接出现「前往下载」
- 许可证改为链接：应用内弹窗查看完整 GPL 文本，点「关闭」即回到原页面（不再跳走）
- 移除单独的上游说明行（不再提 MIT）

## 退出应用

- 设置左侧新增独立子项「退出应用」（仅桌面/便携启动器显示）：停止本地服务并释放 exe/脚本文件占用
- 关闭窗口后程序仍在后台运行，需要彻底退出时用它；也可在任务管理器结束 chatbrowser.exe

## 启动器

- 版本握手：固定端口 17890 上有旧版本时自动结束旧实例再接管（便携版提示先关闭旧窗口）
- 所有子进程使用 CREATE_NO_WINDOW，启动/接管时不再闪 cmd 黑框

## 导入

- Claude ZIP：兼容 `text` 为空、正文位于 `content: [{type:"text",text}]` 的真实导出（修复「文件内容不完整」）
- 文件选择器统一为 `.zip,.json`

## 校验 / Checksums (SHA-256)

```
c5fe1748dd18a93b44cfe3963205604de083c94f8d70d8e41aceeb23ca80f2fe  windows-portable.zip
c3fd78312f8ea74a2dd1deb505f05c33f0faafba15da543b51726a4abbac5fbc  windows-x64.zip
fd252f37ea4d24c065a2cb4107e7f6c789dbbe9dddc43b446846222d3ea28e9b  linux-x64.tar.gz
28086431e95a01e9d21ae44e6c81aa04cf30b179fa602cb60600c8f27321da5a  chatbrowser-android-debug.apk
```

> 未签名提示：右键 zip → 属性 → 解除锁定；或使用 windows-portable.zip（免 exe）。
