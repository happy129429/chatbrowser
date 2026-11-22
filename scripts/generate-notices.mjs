/**
 * 生成 THIRD_PARTY_NOTICES.txt：项目许可 + 生产依赖的版权与许可全文。
 * 用法：pnpm notices（pnpm build 会自动执行）
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'THIRD_PARTY_NOTICES.txt')

const licenseFiles = (dir) => {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name))
      .map((name) => path.join(dir, name))
      .filter((file) => fs.statSync(file).isFile())
  } catch {
    return []
  }
}

let groups = {}
try {
  const json = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  groups = JSON.parse(json)
} catch (error) {
  console.warn('pnpm licenses 扫描失败，仅写入项目许可：', error.message)
}

const seen = new Set()
const sections = []
for (const license of Object.keys(groups).sort((a, b) => a.localeCompare(b))) {
  const packages = [...groups[license]].sort((a, b) => String(a.name).localeCompare(String(b.name)))
  for (const pkg of packages) {
    const versions = Array.isArray(pkg.versions)
      ? pkg.versions.join(', ')
      : String(pkg.versions ?? '')
    const key = `${pkg.name}@${versions}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    const dir = Array.isArray(pkg.paths) && pkg.paths.length > 0 ? pkg.paths[0] : null
    const files = dir ? licenseFiles(dir) : []
    const texts = files.map((file) => {
      const name = path.basename(file)
      return `--- ${name} ---\n${fs.readFileSync(file, 'utf8').trim()}`
    })
    sections.push(
      [
        '='.repeat(80),
        `${pkg.name} ${versions}`.trim(),
        `License: ${license}`,
        '='.repeat(80),
        texts.length > 0
          ? texts.join('\n\n')
          : `${license} (this package does not ship a license file)`,
      ].join('\n')
    )
  }
}

const header = [
  'chatbrowser — third-party software notices',
  '',
  'This project is licensed under GPL-3.0-or-later. The full license text is in LICENSE.',
  'It is based on deepseek-ai/chat-demo (MIT); the upstream MIT notice is preserved in LICENSE.',
  '',
  'The following third-party packages are distributed with the application.',
  'Each section contains the package name, version, license identifier and the',
  'license/notice text shipped by that package.',
  '',
].join('\n')

fs.writeFileSync(output, `${header}\n${sections.join('\n\n')}\n`)
console.log(
  `已生成 ${path.basename(output)}（${sections.length} 个依赖，${fs.statSync(output).size} 字节）`
)
