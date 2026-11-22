# 发布检查清单

每次发布按顺序执行；**每次发版都必须同步 GitHub Pages 与 README**。

## 1. 版本号

- [ ] `package.json` → `version`
- [ ] `packaging/launcher/winres/winres.json` → `FileVersion` / `ProductVersion`（x.y.z.0）
- [ ] `android/app/build.gradle` → `versionName`
- [ ] `scripts/e2e-smoke.mjs` 中关于页版本断言

## 2. 验证

- [ ] `pnpm type && pnpm lint`
- [ ] `pnpm mock && pnpm e2e`（需 Chrome；用当前 dev server）
- [ ] 手动冒烟：导入 ZIP / Claude ZIP / 搜索 / 导出 / 关于页
- [ ] 启动器：旧实例接管、退出应用、无黑框（Windows）

## 3. 文档与截图

- [ ] `pnpm shots` 重新生成 `docs/screenshots/*.png`（需 dev server 8090）
- [ ] 更新 README.md / README.zh-CN.md：功能、用法、已知问题、Pages 链接
- [ ] 新增 `docs/release-notes-vX.Y.Z.md`（含 SHA-256）

## 4. 构建与发布

- [ ] `pnpm desktop` → `release/desktop`（Windows/Linux/portable）
- [ ] `pnpm android:apk` → `release/android`
- [ ] 把 SHA-256 写入 release notes
- [ ] `git push origin main`
- [ ] `git tag vX.Y.Z && git push origin vX.Y.Z`
- [ ] 等 `Release packages` 工作流完成（自动创建 GitHub Release）
- [ ] 等 `Deploy GitHub Pages` 工作流完成（推送 main 时自动触发；tag 部署受环境保护规则限制）
- [ ] 验证 <https://happy129429.github.io/chatbrowser/> 为新版本
- [ ] 验证 Release 资产可下载、关于页版本号正确
