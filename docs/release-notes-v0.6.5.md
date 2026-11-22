# Release v0.6.5

v0.6.4 之后的界面整理与退出入口调整。

## 关于页

- 「已是最新版本 / 发现新版本」并入「检查更新」一行；有新版本时同处显示「前往下载」
- 上游项目只保留 `deepseek-ai/chat-demo` 链接（不再单列说明，也不提 MIT）
- 许可证改为链接：应用内弹窗查看完整 GPL 文本，点「关闭」回到原页面

## 退出应用

- 从关于页移出，成为设置左侧独立子项（仅桌面/便携启动器显示）
- 停止本地服务并释放 exe/脚本文件占用；关闭窗口后需要彻底退出时用它

## 启动器

- 版本握手：端口 17890 上有旧版本时自动结束旧实例再接管（便携版提示先关闭旧窗口）
- 所有子进程使用 CREATE_NO_WINDOW，不再闪 cmd 黑框

## 导入

- Claude ZIP 兼容 `text` 为空、正文在 `content: [{type:"text",text}]` 的真实导出
- 文件选择器统一 `.zip,.json`

## 校验 / Checksums (SHA-256)

```
ddc040b94a7053efb77bea473611c5b87c7bd91675c42733d08f98f455c451bb  windows-portable.zip
11746b8fa1f198c50d223738f25813b7306e99763b581c2b4ade4e922de1e216  windows-x64.zip
6a7f91b4e5baada53ced25fe8e9d99dee80a62cbc88ec59a2cb58cef93cc490d  linux-x64.tar.gz
62d18102ec28e0190a481549e0de528ddec800b595e68a750841337fc10ff1ea  chatbrowser-android-debug.apk
```

> 未签名提示：右键 zip → 属性 → 解除锁定；或使用 windows-portable.zip（免 exe）。
