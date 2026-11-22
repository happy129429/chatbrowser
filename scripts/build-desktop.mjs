/**
 * 构建桌面启动器：内嵌 dist，交叉编译 Windows / Linux（可选 macOS）。
 * 用法：node scripts/build-desktop.mjs
 * 产物：release/desktop/*（单文件可执行 + LICENSE）
 * 需要：Go 工具链（GO 环境变量或 PATH 中的 go）。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { zipSync } = require('fflate')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const go = process.env.GO ?? 'go'
const launcherDir = path.join(root, 'packaging', 'launcher')
const webDir = path.join(launcherDir, 'web')
const releaseDir = path.join(root, 'release', 'desktop')

const run = (cmd, args, options = {}) => {
  console.log(`> ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...options })
}

const rmrf = (target) => fs.rmSync(target, { recursive: true, force: true })

// 1. 构建前端
run('pnpm', ['build'])

// 2. 把 dist 放进 launcher 供 go:embed 使用
rmrf(webDir)
fs.cpSync(path.join(root, 'dist'), webDir, { recursive: true })

// 3. Windows 可执行文件图标（生成 rsrc_windows_amd64.syso，仅参与 windows 构建）
fs.copyFileSync(
  path.join(root, 'assets', 'icons', 'icon.ico'),
  path.join(launcherDir, 'winres', 'icon.ico')
)
const syso = path.join(launcherDir, 'rsrc_windows_amd64.syso')
rmrf(syso)
run(
  go,
  [
    'run',
    'github.com/akavel/rsrc@latest',
    '-ico',
    'winres/icon.ico',
    '-o',
    'rsrc_windows_amd64.syso',
    '-arch',
    'amd64',
  ],
  {
    cwd: launcherDir,
    env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64' },
  }
)

// 4. 交叉编译
rmrf(releaseDir)
const targets = [
  { goos: 'windows', goarch: 'amd64', name: 'chatbrowser.exe', dir: 'windows-x64' },
  { goos: 'linux', goarch: 'amd64', name: 'chatbrowser', dir: 'linux-x64' },
]
const built = []
for (const target of targets) {
  const outDir = path.join(releaseDir, target.dir)
  fs.mkdirSync(outDir, { recursive: true })
  const out = path.join(outDir, target.name)
  const ldflags = target.goos === 'windows' ? '-s -w -H=windowsgui' : '-s -w'
  run(go, ['build', '-trimpath', '-ldflags', ldflags, '-o', out, '.'], {
    cwd: launcherDir,
    env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: '0' },
  })
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(outDir, 'LICENSE'))
  if (target.goos === 'linux') {
    fs.copyFileSync(
      path.join(root, 'assets', 'icons', 'icon-256.png'),
      path.join(outDir, 'chatbrowser.png')
    )
    fs.writeFileSync(
      path.join(outDir, 'chatbrowser.desktop'),
      '[Desktop Entry]\nType=Application\nName=对话浏览器\nComment=本地 AI 对话浏览器\nExec=chatbrowser\nIcon=chatbrowser\nTerminal=false\nCategories=Utility;\n'
    )
  }
  fs.writeFileSync(
    path.join(outDir, 'README-zh.txt'),
    '双击 chatbrowser 启动（首次启动会在本地 127.0.0.1:17890 提供服务并自动打开窗口）。\n数据保存在浏览器存储中，与源 ZIP 文件无关。\n关闭窗口后程序仍在后台运行，再次双击即可重新打开（不会重复启动）。\n'
  )
  fs.writeFileSync(
    path.join(outDir, 'Instructions.txt'),
    'chatbrowser\n\nDouble-click "chatbrowser" to start. It serves the app at 127.0.0.1:17890 and opens a chromeless window (Edge/Chrome; Firefox falls back to a normal tab).\nData is stored in the browser storage and is independent of your source ZIP files.\nClosing the window keeps the launcher running; double-click again to reopen it (no duplicate instance).\n'
  )
  built.push({ target, outDir })
}

// 5. 打包
for (const { target, outDir } of built) {
  const files = {}
  for (const name of fs.readdirSync(outDir)) {
    files[name] = new Uint8Array(fs.readFileSync(path.join(outDir, name)))
  }
  if (target.goos === 'windows') {
    fs.writeFileSync(`${outDir}.zip`, zipSync(files))
    console.log(`打包 ${outDir}.zip`)
  } else {
    // tar.gz 交给系统 tar，保留可执行位
    run('tar', ['-czf', `${outDir}.tar.gz`, '-C', path.dirname(outDir), path.basename(outDir)])
    console.log(`打包 ${outDir}.tar.gz`)
  }
}

// 6. 免 exe 便携版（Windows）：PowerShell 伺服 dist，规避未签名 exe 拦截
{
  const portableDir = path.join(releaseDir, 'windows-portable')
  fs.mkdirSync(portableDir, { recursive: true })
  fs.cpSync(path.join(root, 'dist'), path.join(portableDir, 'dist'), { recursive: true })
  fs.copyFileSync(
    path.join(root, 'packaging', 'windows', 'server.ps1'),
    path.join(portableDir, 'server.ps1')
  )
  fs.copyFileSync(
    path.join(root, 'packaging', 'windows', 'start-chatbrowser.cmd'),
    path.join(portableDir, 'start-chatbrowser.cmd')
  )
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(portableDir, 'LICENSE'))
  fs.writeFileSync(
    path.join(portableDir, 'README-zh.txt'),
    '双击 start-chatbrowser.cmd 启动（使用 Windows 自带 PowerShell，无需安装，也没有 exe）。\r\n' +
      '首次可能提示“是否允许 PowerShell 运行”，选择允许即可。\r\n' +
      '本地服务地址固定为 127.0.0.1:17890，与桌面版共享同一份浏览器数据。\r\n'
  )
  fs.writeFileSync(
    path.join(portableDir, 'Instructions.txt'),
    'chatbrowser (portable, no exe)\r\n\r\n' +
      'Double-click start-chatbrowser.cmd. It uses the built-in Windows PowerShell, so there is no executable to be blocked by Defender.\r\n' +
      'Allow PowerShell if prompted. The fixed address 127.0.0.1:17890 shares data with the desktop build.\r\n'
  )
  const files = {}
  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const name = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(full, name)
      } else {
        files[name] = new Uint8Array(fs.readFileSync(full))
      }
    }
  }
  walk(portableDir, '')
  fs.writeFileSync(path.join(releaseDir, 'windows-portable.zip'), zipSync(files))
  console.log('打包 release/desktop/windows-portable.zip')
}

console.log('\n完成：')
for (const { target } of built) {
  console.log(`  release/desktop/${target.dir}/`)
}
console.log('  release/desktop/windows-portable.zip（免 exe 便携版）')
