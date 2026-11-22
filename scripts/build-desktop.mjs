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
    path.join(outDir, '使用说明.txt'),
    '双击 chatbrowser 启动（首次启动会在本地 127.0.0.1:17890 提供服务并自动打开窗口）。\n数据保存在浏览器存储中，与源 ZIP 文件无关。\n关闭窗口后程序仍在后台运行，再次双击即可重新打开（不会重复启动）。\n'
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

console.log('\n完成：')
for (const { target } of built) {
  console.log(`  release/desktop/${target.dir}/`)
}
