# Release v0.6.2

构建与兼容性修复版本 / Build and compatibility fixes.

- 修复桌面启动器在 Linux CI 上的图标资源生成（GOOS 导致的 exec format error）；`.syso` 已入库，正常情况下构建完全离线 / fix launcher .syso generation on Linux CI; committed resource means offline builds
- Android CI 改用 runner 预装 SDK，避开 preview cmdline-tools 的许可失败 / Android job uses the runner's preinstalled SDK
- 导入：设置页文件选择器支持 JSON；Claude 原生 content 数组、z.ai 嵌套包装等真实字段形态 / settings picker accepts JSON; Claude content arrays and z.ai nested shapes supported
- 桌面包附带 Instructions.txt（英文）与 README-zh.txt（中文，ASCII 文件名防乱码）/ bilingual instructions in packages

> 未签名提示：右键 zip → 属性 → 解除锁定；或使用 windows-portable.zip（免 exe）。

## 校验 / Checksums (SHA-256)

```
baa348b240b82f0239b58bfbe0d4f035ca19af13a635a6b905438e09f8283467  windows-portable.zip
5d3cd7cad1e951d784ccd5f02c3e28ec1e9604d368c1d3b14a8d77103e235e6c  windows-x64.zip
6edc04a2e7b09f3bf278c65ee12a83b3d67daf7c7f31bcf0653cc6f88442f3d4  linux-x64.tar.gz
37ddff7a84229f846f83a08a35c99633ef586b2163b31e8c3584ac0cbf91f2ba  chatbrowser-android-debug.apk
```
