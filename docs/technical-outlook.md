# 技术展望：原生外壳方案（存档）

本文存档一个曾讨论过的架构方向，供未来参考；**当前版本不采用**。

## 当前架构

| 入口                   | 资源提供方式                  | Origin                          | 生命周期                       |
| ---------------------- | ----------------------------- | ------------------------------- | ------------------------------ |
| 网页版（GitHub Pages） | 静态托管                      | `https://happy129429.github.io` | 关闭标签页                     |
| Windows / Linux 启动器 | Go `net/http` 伺服内嵌 `dist` | `http://127.0.0.1:17890`        | 独立后台进程（需「退出应用」） |
| Android                | Capacitor WebView + 打包资源  | `https://localhost`             | 关闭 App                       |

特点：Windows/Linux 启动器是**纯 Go 交叉编译**、零运行时依赖；固定端口保证 origin 稳定，从而保住 IndexedDB。

## 存档方案：WebView2 虚拟主机 / Tauri / Wails

用原生 WebView 直接加载应用资源，不再启动 HTTP 服务：

- **WebView2 虚拟主机映射**：`SetVirtualHostNameToFolderMapping("app.local", "dist")`，页面 origin 为 `https://app.local`，资源经虚拟主机提供，无需端口与后台进程
- **Tauri v2**：WebView2（Windows）/ WebKitGTK（Linux）+ 自定义协议，自带窗口、托盘、更新器、签名打包体系
- **Wails**：Go + WebView2/WebKitGTK，保留 Go 侧能力，但需要 CGO

三者本质相同：把「本地 HTTP 服务 + 外部浏览器」替换为「进程内 WebView + 自定义协议」。

### 优点

- 无固定端口冲突，无后台残留、exe 被占用、删除失败等问题
- 窗口关闭即退出，符合普通桌面应用直觉
- 更像原生应用：窗口图标、文件关联、托盘、自动更新、单实例
- 不再依赖用户安装 Edge/Chrome（WebView2 Runtime 在 Win10/11 通常已预装）

### 代价

- **Origin 变化**：`127.0.0.1:17890` → 新地址，现有 IndexedDB 数据无法直接迁移，必须导出 ZIP 再导入
- **构建复杂度**：不能纯 Go 交叉编译；Windows 需要 WebView2 SDK/CGO（或 Tauri 的 Rust 工具链），Linux 需要 WebKitGTK；CI 与本地构建都要改
- 新增运行时依赖与版本兼容面（WebView2 Runtime 缺失、旧系统）
- APK 侧不变：Capacitor 的 `https://localhost` 必须保持稳定，不要改 scheme/host

### 迁移策略（若将来实施）

1. 旧启动器继续提供导出（组 ZIP / 全部导出）
2. 新外壳首次启动检测为空库时，提示导入旧包；或提供「从旧版迁移」按钮
3. 文档明确「换外壳 = 换 origin」，避免用户误以为数据丢失
4. 保留网页版与旧启动器至少一个版本周期

## 决策

暂缓。触发重新评估的条件：

- 端口占用/后台进程问题持续造成用户困扰
- 需要文件关联、托盘、自动更新、单实例等原生能力
- 愿意承担 CGO/WebView2 构建与数据迁移成本

在那之前，维护现有「Go HTTP + Edge/Chrome `--app`」方案；它的稳定性和零依赖仍是当前最大优势。
