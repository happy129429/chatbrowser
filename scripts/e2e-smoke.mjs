/**
 * 端到端冒烟测试：导入 mock ZIP → 搜索 → 跳转 → 轮次导航 → 滚动位置恢复 → 分享导出 → 统计。
 * 用法：
 *   node scripts/e2e-smoke.mjs                 # 自动启动/复用 localhost:8090 的 dev server
 *   node scripts/e2e-smoke.mjs --url=http://localhost:8090
 * 依赖本地 Chrome（google-chrome / chromium），无需额外 npm 包。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mockZipPath = path.join(root, 'mock', 'mock-data.zip')
const argUrl = process.argv.find((arg) => arg.startsWith('--url='))
const APP_URL = argUrl ? argUrl.slice('--url='.length) : 'http://localhost:8090'
const CHROME = process.env.CHROME ?? 'google-chrome'
const DEBUG_PORT = 9349
const DOWNLOAD_DIR = '/tmp/chatbrowser-e2e-downloads'
const PROFILE_DIR = '/tmp/chatbrowser-e2e-profile'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

if (!fs.existsSync(mockZipPath)) {
  console.error(`缺少 mock 数据：${mockZipPath}，先运行 pnpm mock`)
  process.exit(1)
}

// ---------- dev server ----------
let devServer = null
const reachable = async () => {
  try {
    const res = await fetch(APP_URL, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}
if (!(await reachable())) {
  console.log(`启动 dev server（${APP_URL}）…`)
  devServer = spawn('pnpm', ['dev'], { cwd: root, stdio: 'ignore', detached: true })
  for (let i = 0; i < 60 && !(await reachable()); i++) await sleep(1000)
  if (!(await reachable())) {
    console.error('dev server 启动失败')
    process.exit(1)
  }
}

// ---------- Chrome + CDP ----------
fs.rmSync(PROFILE_DIR, { recursive: true, force: true })
fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--window-size=1600,1000',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' }
)

const cleanup = () => {
  try {
    chrome.kill()
  } catch {}
  if (devServer) {
    try {
      process.kill(-devServer.pid)
    } catch {}
  }
}
process.on('exit', cleanup)

await sleep(3000)
const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
const page = targets.find((t) => t.type === 'page')
if (!page) {
  console.error('无法连接 Chrome 调试端口')
  process.exit(1)
}
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
  if (r.result?.exceptionDetails) {
    throw new Error(
      JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)
    )
  }
  return r.result?.result?.value
}
const reload = async () => {
  await send('Page.navigate', { url: APP_URL })
  await sleep(2500)
}

await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR })
await send('Page.enable')
await reload()
await evaluate(
  `localStorage.setItem('chat-demo:theme-preference', 'light'); localStorage.setItem('chat-demo:locale', 'zh-CN')`
)
await reload()

const clickByText = (selector, text) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)}))
    if (!el) return 'not-found'
    el.click()
    return 'ok'
  })()`)

// ---------- 1. 导入 ----------
const zipBase64 = fs.readFileSync(mockZipPath).toString('base64')
await evaluate(`(() => {
  const bytes = Uint8Array.from(atob(${JSON.stringify(zipBase64)}), (c) => c.charCodeAt(0))
  const file = new File([bytes], 'mock-data.zip', { type: 'application/zip' })
  const input = document.querySelector('input[type="file"][multiple]')
  if (!input) return 'no-input'
  const dt = new DataTransfer()
  dt.items.add(file)
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return 'ok'
})()`)
await sleep(3500)
const sessionCount = await evaluate(`document.querySelectorAll('div[class*="item-"]').length`)
check('导入 mock ZIP', sessionCount === 12, `会话数=${sessionCount}`)

// 外部格式（ChatGPT ZIP / Claude ZIP / z.ai JSON）
const chatgptBase64 = fs
  .readFileSync(path.join(root, 'mock', 'chatgpt-sample.zip'))
  .toString('base64')
const claudeBase64 = fs
  .readFileSync(path.join(root, 'mock', 'claude-sample.zip'))
  .toString('base64')
const zaiBase64 = fs.readFileSync(path.join(root, 'mock', 'zai-sample.json')).toString('base64')
const zaiHistoryBase64 = fs
  .readFileSync(path.join(root, 'mock', 'zai-history-sample.json'))
  .toString('base64')
const claudeTurnsBase64 = fs
  .readFileSync(path.join(root, 'mock', 'claude-turns-sample.json'))
  .toString('base64')
await evaluate(`(() => {
  const input = document.querySelector('input[type="file"][multiple]')
  const dt = new DataTransfer()
  const toFile = (base64, name, type) =>
    new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type })
  dt.items.add(toFile(${JSON.stringify(chatgptBase64)}, 'chatgpt-sample.zip', 'application/zip'))
  dt.items.add(toFile(${JSON.stringify(claudeBase64)}, 'claude-export.zip', 'application/zip'))
  dt.items.add(toFile(${JSON.stringify(zaiBase64)}, 'zai-sample.json', 'application/json'))
  dt.items.add(
    toFile(${JSON.stringify(zaiHistoryBase64)}, 'zai-history-sample.json', 'application/json')
  )
  dt.items.add(
    toFile(${JSON.stringify(claudeTurnsBase64)}, 'claude-turns-sample.json', 'application/json')
  )
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return 'ok'
})()`)
let withExternal = 0
for (let i = 0; i < 30; i++) {
  await sleep(500)
  withExternal = await evaluate(`document.querySelectorAll('div[class*="item-"]').length`)
  if (withExternal >= 18) {
    break
  }
}
const hasChatGptTitle = await evaluate(
  `[...document.querySelectorAll('div[class*="item-"]')].some((el) => el.textContent.includes('Rust 所有权'))`
)
check('导入 ChatGPT(ZIP) / Claude / z.ai', withExternal === 18, `会话数=${withExternal}`)
check('外部会话标题正确', hasChatGptTitle === true)

const acceptAttr = await evaluate(
  `document.querySelector('input[type="file"][multiple]')?.accept ?? ''`
)
check(
  '文件选择器接受 ZIP 与 JSON',
  typeof acceptAttr === 'string' &&
    acceptAttr.includes('.zip') &&
    acceptAttr.includes('.json') &&
    !acceptAttr.includes('*.*'),
  acceptAttr
)

// Claude：text 为空、正文在 content 数组中
await clickByText('div[class*="item-"]', '论文润色')
await sleep(1400)
const claudeContent = await evaluate(`document.querySelector('main')?.textContent ?? ''`)
check(
  'Claude content 数组正文可导入',
  typeof claudeContent === 'string' && claudeContent.includes('conducted extensive experiments'),
  claudeContent.includes('conducted extensive experiments') ? 'ok' : 'missing'
)

await clickByText('div[class*="item-"]', 'z.ai 原生：分支历史')
await sleep(1200)
const zaiNativeText = await evaluate(`document.querySelector('main')?.textContent ?? ''`)
check(
  'z.ai 原生消息树按 currentId 取分支',
  typeof zaiNativeText === 'string' &&
    zaiNativeText.includes('当前分支回答') &&
    !zaiNativeText.includes('旧分支回答'),
  zaiNativeText.includes('当前分支回答') ? 'ok' : 'missing'
)

await clickByText('div[class*="item-"]', 'Claude turn_history')
await sleep(1200)
const turnsText = await evaluate(`document.querySelector('main')?.textContent ?? ''`)
const turnsPrompt = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((node) => node.textContent.includes('系统提示词') || node.textContent.includes('System prompt'))
  btn?.click()
  return btn ? 'ok' : 'no-prompt-button'
})()`)
await sleep(300)
const turnsPromptText = await evaluate(
  `document.querySelector('div[class*="systemPromptBody"]')?.textContent ?? ''`
)
check(
  'turn_history 封装与全局系统指令可导入',
  typeof turnsText === 'string' &&
    turnsText.includes('压缩成一句摘要') &&
    turnsPrompt === 'ok' &&
    turnsPromptText.includes('会话级系统指令'),
  turnsPromptText.slice(0, 40)
)

// 系统提示词面板（ChatGPT system 消息）
await clickByText('div[class*="item-"]', 'Rust 所有权')
await sleep(1400)
const promptOpened = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((node) => node.textContent.includes('系统提示词') || node.textContent.includes('System prompt'))
  btn?.click()
  return btn ? 'ok' : 'no-prompt-button'
})()`)
await sleep(400)
const promptText = await evaluate(
  `document.querySelector('div[class*="systemPromptBody"]')?.textContent ?? ''`
)
check(
  '会话系统提示词可查看',
  promptOpened === 'ok' && promptText.includes('helpful assistant'),
  promptText.slice(0, 40)
)

// 组级附加信息（记忆 / 自定义指令）
const groupMenuOpened = await evaluate(`(() => {
  const headers = [...document.querySelectorAll('div[class*="groupHeader"]')]
  const target = headers.find((node) => node.textContent.includes('chatgpt-sample'))
  if (!target) return 'no-group'
  const buttons = target.querySelectorAll('button')
  buttons[buttons.length - 1]?.click()
  return 'ok'
})()`)
await sleep(500)
const extrasItem = await evaluate(`(() => {
  const item = [...document.querySelectorAll('div[role="menuitem"]')].find((node) => node.textContent.includes('附加信息') || node.textContent.includes('Archive notes'))
  item?.click()
  return item ? 'ok' : 'no-extras-item'
})()`)
await sleep(500)
const extrasText = await evaluate(
  `document.querySelector('div[class*="extrasList"]')?.textContent ?? ''`
)
check(
  '组级附加信息入口与内容',
  groupMenuOpened === 'ok' &&
    extrasItem === 'ok' &&
    extrasText.includes('记忆') &&
    extrasText.includes('自定义指令'),
  extrasText.slice(0, 60)
)
await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Escape',
  code: 'Escape',
  windowsVirtualKeyCode: 27,
})
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Escape',
  code: 'Escape',
  windowsVirtualKeyCode: 27,
})
await sleep(500)

// ---------- 2. 搜索 + 跳转 ----------
await evaluate(`document.querySelector('div[class*="topActions"] button')?.click()`)
await sleep(500)
await evaluate(`(() => {
  const input = document.querySelector('div[class*="overlay"] input[type="text"]')
  if (!input) return 'no-input'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '量子隧穿')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
await sleep(1500)
const searchState = JSON.parse(
  await evaluate(`JSON.stringify({
    groups: document.querySelectorAll('button[class*="groupRow"]').length,
    text: document.querySelector('div[class*="overlay"]')?.textContent?.slice(0, 80) ?? '',
  })`)
)
check('搜索命中', searchState.groups >= 1, searchState.text)
await evaluate(`document.querySelector('button[class*="groupRow"]')?.click()`)
await sleep(400)
await evaluate(`document.querySelector('button[class*="subHit"]')?.click()`)
await sleep(700)
const jumped = await evaluate(`JSON.stringify({
  flash: !!document.querySelector('.ds-jump-flash'),
  sessionTitle: document.querySelector('div[class*="view-"] div[class*="title-"]')?.textContent ?? '',
})`)
const jumpState = JSON.parse(jumped)
check('搜索跳转（闪烁定位）', jumpState.flash, jumpState.sessionTitle)

// ---------- 3. 轮次导航 ----------
console.log('打开长会话…')
await clickByText('div[class*="item-"]', '长会话压测')
await sleep(1600)
const railRect = JSON.parse(
  await evaluate(`(() => {
    const rail = document.querySelector('div[class*="rail-"]')
    if (!rail) return JSON.stringify(null)
    const r = rail.getBoundingClientRect()
    return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) })
  })()`)
)
check('轮次导航存在', railRect !== null)
if (railRect) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: railRect.x, y: railRect.y })
  await sleep(500)
  const card = JSON.parse(
    await evaluate(`(() => {
      const card = document.querySelector('div[class*="card-"]')
      return JSON.stringify({
        rows: card ? card.querySelectorAll('button').length : 0,
        active: card?.querySelector('button[class*="rowActive"]')?.textContent?.slice(0, 12) ?? null,
      })
    })()`)
  )
  check('悬停展开全部轮次', card.rows === 20, `行数=${card.rows} 当前=${card.active}`)
  await evaluate(`document.querySelectorAll('div[class*="card-"] button')[5]?.click()`)
  await sleep(800)
  const afterNav = JSON.parse(
    await evaluate(`JSON.stringify({
      flash: document.querySelector('.ds-jump-flash')?.getAttribute('data-message-id') ?? null,
      scrollTop: Math.round(document.querySelector('div[class*="container-"]').scrollTop),
    })`)
  )
  check('导航条跳转', afterNav.flash === '11', `flash=${afterNav.flash} top=${afterNav.scrollTop}`)
}

// ---------- 4. 滚动位置 + 会话恢复 ----------
await evaluate(`(() => {
  const el = document.querySelector('div[class*="container-"]')
  el.scrollTop = 1600
  el.dispatchEvent(new Event('scroll', { bubbles: true }))
  return 'ok'
})()`)
await sleep(800)
const beforeReload = JSON.parse(
  await evaluate(`(() => {
    const el = document.querySelector('div[class*="container-"]')
    const top = el.getBoundingClientRect().top
    let first = null
    for (const node of document.querySelectorAll('[data-message-id]')) {
      const r = node.getBoundingClientRect()
      if (r.bottom > top + 1) { first = { id: node.getAttribute('data-message-id'), offset: Math.round(r.top - top) }; break }
    }
    return JSON.stringify({ scrollTop: Math.round(el.scrollTop), first })
  })()`)
)
await reload()
await sleep(1800)
const afterReload = JSON.parse(
  await evaluate(`(() => {
    const el = document.querySelector('div[class*="container-"]')
    if (!el) return JSON.stringify({ activeItem: null })
    const top = el.getBoundingClientRect().top
    let first = null
    for (const node of document.querySelectorAll('[data-message-id]')) {
      const r = node.getBoundingClientRect()
      if (r.bottom > top + 1) { first = { id: node.getAttribute('data-message-id'), offset: Math.round(r.top - top) }; break }
    }
    return JSON.stringify({
      scrollTop: Math.round(el.scrollTop),
      first,
      activeItem: document.querySelector('div[class*="item-"][class*="active"]')?.textContent ?? null,
    })
  })()`)
)
// content-visibility 使离屏高度为估算值，scrollTop 数字会偏移；以可见锚点为准
check(
  '刷新恢复会话与位置',
  afterReload.activeItem?.includes('长会话压测') &&
    afterReload.first?.id === beforeReload.first?.id &&
    Math.abs((afterReload.first?.offset ?? 0) - (beforeReload.first?.offset ?? 0)) <= 2,
  `before=${JSON.stringify(beforeReload)} after=${JSON.stringify(afterReload)}`
)

// ---------- 5. 分享导出 HTML ----------
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('div[class*="header"] button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('分享'))
  btn?.click()
  return btn ? 'ok' : 'no-share'
})()`)
await sleep(800)
const shareBar = await evaluate(`!!document.querySelector('div[class*="shareBar"]')`)
check('分享选择模式', shareBar === true)
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('div[class*="shareBar"] button')].find((b) => b.textContent.includes('HTML'))
  btn?.click()
  return 'ok'
})()`)
let exportedFile = null
for (let i = 0; i < 40 && !exportedFile; i++) {
  await sleep(250)
  const files = fs.readdirSync(DOWNLOAD_DIR).filter((name) => name.endsWith('.html'))
  if (files.length > 0) exportedFile = path.join(DOWNLOAD_DIR, files[0])
}
let exportOk = false
let exportDetail = '无导出文件'
if (exportedFile) {
  const html = fs.readFileSync(exportedFile, 'utf8')
  exportOk = html.length > 5000 && html.includes('第 1 轮') && html.includes('<style>')
  exportDetail = `${path.basename(exportedFile)} ${html.length}B`
}
check('导出包含所选轮次的 HTML', exportOk, exportDetail)

// ---------- 6. 统计 ----------
await evaluate(`document.querySelector('button[class*="settings"]')?.click()`)
await sleep(600)
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('button[role="tab"]')].find((node) => node.textContent.includes('统计'))
  tab?.click()
  return 'ok'
})()`)
await sleep(1200)
const statsText = await evaluate(
  `[...document.querySelectorAll('div[class*="cell"]')].map((cell) => cell.textContent).join('|')`
)
check(
  '统计包含 token 数值',
  typeof statsText === 'string' && /Token总用量[\d,]+/.test(statsText.replace(/\s/g, '')),
  statsText?.slice(0, 120)
)

// ---------- 7. 关于页 ----------
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('button[role="tab"]')].find((node) => node.textContent.includes('关于'))
  tab?.click()
  return 'ok'
})()`)
await sleep(600)
const aboutText = await evaluate(
  `document.querySelector('div[role="dialog"]')?.textContent ?? document.querySelector('main')?.textContent ?? ''`
)
const aboutOk =
  typeof aboutText === 'string' &&
  aboutText.includes('0.6.7') &&
  aboutText.includes('github.com/happy129429/chatbrowser') &&
  aboutText.includes('deepseek-ai/chat-demo') &&
  aboutText.includes('GPL-3.0-or-later') &&
  aboutText.includes('检查')
check('关于页包含版本/项目/上游/许可', aboutOk, aboutOk ? 'ok' : aboutText?.slice(0, 160))

const licenseLinkClicked = await evaluate(`(() => {
  const link = [...document.querySelectorAll('div[role="dialog"] a')].find((a) => a.textContent.includes('GPL-3.0-or-later'))
  link?.click()
  return link ? 'ok' : 'no-link'
})()`)
await sleep(800)
const licenseText = await evaluate(`document.querySelector('pre')?.textContent ?? ''`)
check(
  '许可证可在应用内查看并关闭',
  licenseLinkClicked === 'ok' &&
    typeof licenseText === 'string' &&
    licenseText.includes('GNU GENERAL PUBLIC LICENSE'),
  licenseText ? `长度=${licenseText.length}` : 'empty'
)
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '关闭')
  btn?.click()
  return 'ok'
})()`)
await sleep(300)

if (APP_URL.includes('127.0.0.1:17890')) {
  const quitTab = await evaluate(
    `[...document.querySelectorAll('button[role="tab"]')].some((node) => node.textContent.includes('退出应用'))`
  )
  check('启动器设置含独立退出子项', quitTab === true)
}

// ---------- 汇总 ----------
ws.close()
cleanup()
console.log('\n========== e2e 结果 ==========')
for (const item of results) {
  console.log(`${item.ok ? '✓' : '✗'} ${item.name}${item.detail ? `  (${item.detail})` : ''}`)
}
if (failures.length > 0) {
  console.error(`\n${failures.length} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
process.exit(0)
