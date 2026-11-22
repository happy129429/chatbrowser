/**
 * 生成 README 截图：导入 mock 数据后截取列表、搜索、轮次导航、统计四个画面。
 * 用法：node scripts/capture-screenshots.mjs（需 dev server 已在 localhost:8090 运行）
 * 输出：docs/screenshots/*.png
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'docs', 'screenshots')
const mockZipPath = path.join(root, 'mock', 'mock-data.zip')
const APP_URL = process.env.APP_URL ?? 'http://localhost:8090'
const README_PREFS = `localStorage.setItem('chat-demo:theme-preference', 'light'); localStorage.setItem('chat-demo:locale', 'zh-CN')`

fs.mkdirSync(outDir, { recursive: true })
fs.rmSync('/tmp/chatbrowser-shots-profile', { recursive: true, force: true })

const chrome = spawn(
  process.env.CHROME ?? 'google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=9351',
    '--user-data-dir=/tmp/chatbrowser-shots-profile',
    '--window-size=1440,900',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' }
)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
await sleep(3000)
const targets = await fetch('http://127.0.0.1:9351/json').then((r) => r.json())
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
const reload = async () => {
  await send('Page.navigate', { url: APP_URL })
  await sleep(2500)
}
const shot = async (name, clip) => {
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  })
  fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, 'base64'))
  console.log('saved', name)
}

await send('Page.enable')
await reload()
await evaluate(README_PREFS)
await reload()

const zipBase64 = fs.readFileSync(mockZipPath).toString('base64')
await evaluate(`(() => {
  const bytes = Uint8Array.from(atob(${JSON.stringify(zipBase64)}), (c) => c.charCodeAt(0))
  const file = new File([bytes], 'mock-data.zip', { type: 'application/zip' })
  const input = document.querySelector('input[type="file"][multiple]')
  const dt = new DataTransfer()
  dt.items.add(file)
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return 'ok'
})()`)
await sleep(3500)

// 1) 列表：分组 + 置顶
await shot('list.png')

// 2) 搜索浮层
await evaluate(`document.querySelector('div[class*="topActions"] button')?.click()`)
await sleep(400)
await evaluate(`(() => {
  const input = document.querySelector('div[class*="overlay"] input[type="text"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '量子')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
await sleep(1500)
await evaluate(`document.querySelector('button[class*="groupRow"]')?.click()`)
await sleep(500)
await shot('search.png')
await evaluate(`document.querySelector('div[class*="mask"]')?.click()`)
await sleep(400)

// 3) 长会话 + 轮次导航悬停浮层
await evaluate(
  `[...document.querySelectorAll('div[class*="item-"]')].find((el) => el.textContent.includes('长会话压测'))?.click()`
)
await sleep(1600)
const rail = JSON.parse(
  await evaluate(`(() => {
    const r = document.querySelector('div[class*="rail-"]').getBoundingClientRect()
    return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) })
  })()`)
)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rail.x, y: rail.y })
await sleep(600)
await shot('round-nav.png')

// 4) 统计
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 400 })
await sleep(300)
await evaluate(`document.querySelector('button[class*="settings"]')?.click()`)
await sleep(600)
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('button[role="tab"]')].find((node) => node.textContent.includes('统计'))
  tab?.click()
  return 'ok'
})()`)
await sleep(1200)
await shot('stats.png')

ws.close()
chrome.kill()
console.log('全部截图完成 →', outDir)
process.exit(0)
