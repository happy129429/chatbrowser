# Release v0.6.4

- 修复 Windows 启动器在接管旧实例/弹提示时闪出 cmd 黑框：PowerShell 等子进程统一以 `CREATE_NO_WINDOW` 启动。
- 其余与 v0.6.3 相同：关于页（版本/项目地址/上游 MIT 致谢/GPL 许可）、启动自动检查更新、旧实例版本握手接管、Claude ZIP content 数组兼容、`.zip,.json` 文件选择器。

> 未签名提示：右键 zip → 属性 → 解除锁定；或使用 windows-portable.zip（免 exe，便携版自带 PowerShell 控制台窗口属正常）。

## 校验 / Checksums (SHA-256)

```
9a6bc64aebdf491c0bff27e316daa5c6757e62d1e9bd6e535e6e57870850c343  windows-portable.zip
84c066149e8e2b97a24b0da40736fbfd1c1a3b78461712e28d53c1f80a12110e  windows-x64.zip
a4e518978f340a9f9faa9a9f04e3266aa6a78e01702f87c1dd104164d4092a00  linux-x64.tar.gz
c4efb172b8200f77bada71add96c259ac9ac5f7a4a2eb4b550844c0ec3dc66ea  chatbrowser-android-debug.apk
```
