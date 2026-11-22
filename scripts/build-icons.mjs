/**
 * 从 assets/icon.svg 生成各平台图标：
 *  - assets/icons/icon-{16..1024}.png + icon.ico（Windows exe）
 *  - 桌面 Linux 包用 icon-256.png
 *  - 传入 --android <dir> 时替换 Capacitor 安卓工程的 mipmap 图标
 * 依赖本地 Chrome 渲染 SVG（无 ImageMagick）。
 * 用法：node scripts/build-icons.mjs [--android android/app/src/main/res]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const iconSvg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8')
const outDir = path.join(root, 'assets', 'icons')
fs.mkdirSync(outDir, { recursive: true })

const androidArg = process.argv.indexOf('--android')
const androidRes = androidArg !== -1 ? process.argv[androidArg + 1] : null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync('/tmp/chatbrowser-icons-profile', { recursive: true, force: true })
const chrome = spawn(
  process.env.CHROME ?? 'google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=9353',
    '--user-data-dir=/tmp/chatbrowser-icons-profile',
    'about:blank',
  ],
  { stdio: 'ignore' }
)
await sleep(3000)
const targets = await fetch('http://127.0.0.1:9353/json').then((r) => r.json())
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => (ws.onopen = resolve))
let seq = 0
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails)
    throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? ''))
  return r.result?.result?.value
}

/** 在页面里把 SVG 画到指定尺寸的 canvas，返回 PNG base64 */
const render = async (svgMarkup, size, { transparent = false, contentScale = 1 } = {}) => {
  const escaped = Buffer.from(svgMarkup).toString('base64')
  return evaluate(`(() => new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = ${size}
      canvas.height = ${size}
      const ctx = canvas.getContext('2d')
      if (!${transparent}) { ctx.fillStyle = '#4D6BFE'; ctx.fillRect(0, 0, ${size}, ${size}) }
      const draw = ${size} * ${contentScale}
      const offset = (${size} - draw) / 2
      ctx.drawImage(img, offset, offset, draw, draw)
      resolve(canvas.toDataURL('image/png').split(',')[1])
    }
    img.onerror = reject
    img.src = 'data:image/svg+xml;base64,${escaped}'
  }))()`)
}

// 桌面图标（完整圆角方块）
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024]
const pngs = new Map()
for (const size of sizes) {
  const base64 = await render(iconSvg, size)
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), Buffer.from(base64, 'base64'))
  pngs.set(size, Buffer.from(base64, 'base64'))
  console.log(`icon-${size}.png`)
}

// Windows .ico：优先用 Python PIL（BMP 条目，go-winres/Windows 兼容），否则退回 PNG 负载实现
const icoPath = path.join(outDir, 'icon.ico')
try {
  const { execFileSync } = await import('node:child_process')
  execFileSync(
    'python3',
    [
      '-c',
      `
from PIL import Image
imgs = [Image.open('${path.join(outDir, 'icon-16.png')}').convert('RGBA'), Image.open('${path.join(outDir, 'icon-32.png')}').convert('RGBA'), Image.open('${path.join(outDir, 'icon-48.png')}').convert('RGBA')]
large = Image.open('${path.join(outDir, 'icon-256.png')}').convert('RGBA')
large.save('${icoPath}', format='ICO', sizes=[(16,16),(32,32),(48,48),(256,256)], append_images=imgs)
`,
    ],
    { stdio: 'ignore' }
  )
  console.log('icon.ico (PIL)')
} catch {
  const icoSizes = [16, 32, 48, 256]
  const icoHeader = Buffer.alloc(6)
  icoHeader.writeUInt16LE(0, 0)
  icoHeader.writeUInt16LE(1, 2) // type: icon
  icoHeader.writeUInt16LE(icoSizes.length, 4)
  const entries = []
  const payloads = []
  let offset = 6 + 16 * icoSizes.length
  for (const size of icoSizes) {
    const png = pngs.get(size)
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size === 256 ? 0 : size, 0)
    entry.writeUInt8(size === 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    entries.push(entry)
    payloads.push(png)
  }
  fs.writeFileSync(icoPath, Buffer.concat([icoHeader, ...entries, ...payloads]))
  console.log('icon.ico (fallback)')
}

// Android：自适应前景（气泡，透明底，内容占 60% 安全区）+ 传统图标
if (androidRes) {
  const foregroundSvg = iconSvg.replace(
    '<rect width="1024" height="1024" rx="224" fill="#4D6BFE"/>',
    ''
  )
  const densities = [
    { dir: 'mipmap-mdpi', legacy: 48, foreground: 108 },
    { dir: 'mipmap-hdpi', legacy: 72, foreground: 162 },
    { dir: 'mipmap-xhdpi', legacy: 96, foreground: 216 },
    { dir: 'mipmap-xxhdpi', legacy: 144, foreground: 324 },
    { dir: 'mipmap-xxxhdpi', legacy: 192, foreground: 432 },
  ]
  for (const { dir, legacy, foreground } of densities) {
    const target = path.join(androidRes, dir)
    fs.mkdirSync(target, { recursive: true })
    const legacyPng = await render(iconSvg, legacy)
    fs.writeFileSync(path.join(target, 'ic_launcher.png'), Buffer.from(legacyPng, 'base64'))
    fs.writeFileSync(path.join(target, 'ic_launcher_round.png'), Buffer.from(legacyPng, 'base64'))
    // 自适应前景：蓝色气泡缩小到安全区，背景由 adaptive icon 的底色提供
    const fgPng = await render(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${foregroundSvg.replace(/<\/?svg[^>]*>/g, '')}</svg>`,
      foreground,
      { transparent: true, contentScale: 0.66 }
    )
    fs.writeFileSync(path.join(target, 'ic_launcher_foreground.png'), Buffer.from(fgPng, 'base64'))
  }
  console.log('android mipmaps updated in', androidRes)
}

ws.close()
chrome.kill()
console.log('图标生成完成 →', outDir)
process.exit(0)
