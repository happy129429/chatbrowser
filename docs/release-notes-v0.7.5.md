# Release v0.7.5

更新检查与默认组本地化的修复。

## 更新检查

- 缓存从 24 小时缩短为 **30 分钟**，避免连续发版时一直提示旧版本；手动「检查更新」始终绕过缓存请求最新 Release
- 最近版本提示改为显示最新版本号（如 v0.7.5），已是最新时也会显示当前最新版本
- 设置 → 关于新增「启动时自动检查更新」开关，默认开启；关闭后不会自动请求 GitHub，仍可手动检查

## 默认组

- 未改名的默认组会跟随界面语言：中文显示「默认组」，英文显示「Default group」
- 一旦手动重命名（哪怕改成与当前相同的名字），默认组名称就固定，不再随语言变化
- 升级前已自定义名称的默认组会被识别并保留，不会被语言切换覆盖
- 英文默认组菜单提示与中文同步

## 校验 / Checksums (SHA-256)

```
0e214ea20b937303984c84652ea992555c20769b476da321ebefa9b2a7e42875  windows-portable.zip
98eee06c41fb9e661e3d4618232e54c39e1ad71677238194b2976eea7b07c3c3  windows-x64.zip
84a0555288b5f13ca96a3bdf2c0c916a2e5153a998aa38254c9d8fad80ddc265  linux-x64.tar.gz
8a29ab0197dad4c1f8ed0ca4f0a32f7faa859ae001de34ecbb2ff3b0b0172472  chatbrowser-android-debug.apk
```
