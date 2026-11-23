/**
 * 生成一批符合 DeepSeek 历史导出格式（v3）的 mock ZIP。
 * 用法：node scripts/generate-mock-data.mjs → 输出到 mock/*.zip，拖进应用即可导入。
 * 覆盖：思考、联网搜索、浏览/读链接、引用来源、表格、LaTeX、代码块、附件图片、
 * 部分读取、提示条、模板回复（内容过滤）、中断轮、置顶、累计 token。
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)))
const { zipSync, strToU8 } = require('fflate')

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mock')
mkdirSync(outDir, { recursive: true })

const DAY = 86_400_000
const now = Date.now()
const iso = (t) => new Date(t).toISOString()
let imageCounter = 0

/** 1×1 PNG（蓝色像素），作为可导入的图片附件 */
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

/** 会话构建器：rounds 依序成链，自动编号与累计 token。 */
function buildSession({ id, title, pinned = false, start, rounds }) {
  let cursor = start
  let messageId = 0
  let parentId = null
  let tokens = 0
  const messages = []
  for (const round of rounds) {
    messageId += 1
    const userId = messageId
    messages.push({
      id: userId,
      parent_id: parentId,
      role: 'USER',
      status: 'FINISHED',
      thinking_enabled: false,
      search_enabled: false,
      accumulated_token_usage: 0,
      inserted_at: iso(cursor),
      fragments: [...(round.file ? [round.file] : []), { type: 'REQUEST', content: round.q }],
    })
    parentId = userId
    cursor += 8_000 + Math.round(Math.random() * 5_000)

    messageId += 1
    const assistantId = messageId
    tokens += round.tokens
    messages.push({
      id: assistantId,
      parent_id: parentId,
      role: 'ASSISTANT',
      status: round.status ?? 'FINISHED',
      thinking_enabled: round.fragments.some((f) => f.type === 'THINK'),
      search_enabled: round.fragments.some((f) => f.type.startsWith('TOOL_')),
      accumulated_token_usage: tokens,
      inserted_at: iso(cursor),
      fragments: round.fragments,
    })
    parentId = assistantId
    cursor += 40_000 + Math.round(Math.random() * DAY)
  }
  return {
    id,
    title,
    pinned,
    current_message_id: messageId,
    inserted_at: iso(start),
    updated_at: iso(cursor),
    messages,
  }
}

const think = (content, seconds) => ({ type: 'THINK', content, elapsed_secs: seconds })
const answer = (content) => ({ type: 'RESPONSE', content })
const search = (queries, results) => ({
  type: 'TOOL_SEARCH',
  queries,
  results: results.map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.snippet,
    published_at: r.date ?? null,
    site_name: r.site ?? null,
    site_icon: r.site ? `https://${r.site}/favicon.ico` : null,
  })),
  status: 'FINISHED',
  stage_id: 1,
})
const openPage = (url, title, site) => ({
  type: 'TOOL_OPEN',
  status: 'FINISHED',
  url,
  title,
  snippet: '',
  site_name: site,
  published_at: null,
  stage_id: 1,
})
const readLink = (url, title) => ({
  type: 'READ_LINK',
  results: [{ url, title, signature: 'c2lnbmF0dXJlLW1vY2stZGF0YQ==' }],
})
const tip = (content, style = 'INFO') => ({ type: 'TIP', content, style })
const partialRead = (ratio) => ({ type: 'PARTIAL_FILE_READ', ratio })

const web = (url, title, snippet, site, date) => ({ url, title, snippet, site, date })

// ---------- 组一：工作项目（5 会话，蓝色） ----------
const workSessions = [
  buildSession({
    id: 'mock-w1',
    title: '前端内存泄漏排查',
    pinned: true,
    start: now - 2 * DAY,
    rounds: [
      {
        q: '我们的 React 后台频繁切换页面后越来越卡，怎么定位内存泄漏？',
        tokens: 1450,
        fragments: [
          think(
            '用户描述的是典型 SPA 内存泄漏。先讲 Chrome DevTools 的 Memory 面板与 Heap snapshot 对比法，再列常见泄漏源。',
            6
          ),
          answer(
            '## 定位方法\n\n1. 打开 DevTools → Memory，**堆快照**对比切换前后\n2. Allocation instrumentation on timeline 记录分配栈\n3. Performance Monitor 观察 JS heap size\n\n## 常见泄漏源\n\n- 全局变量缓存组件实例\n- `setInterval` / 事件监听未清理\n- 闭包引用大对象\n- 脱离 DOM 的引用（detached tree）'
          ),
        ],
      },
      {
        q: '确实有个 setInterval 没清，还有图表库实例。给个通用的清理模式',
        tokens: 2380,
        fragments: [
          search(
            ['React useEffect cleanup interval 遗漏 内存泄漏'],
            [
              web(
                'https://react.dev/reference/react/useEffect',
                'useEffect – React',
                '组件卸载时清理副作用的官方指南',
                'react.dev',
                '2025-11-02'
              ),
              web(
                'https://developer.chrome.com/docs/devtools/memory-problems',
                'Fix memory problems',
                'Chrome 官方内存问题排查手册',
                'developer.chrome.com',
                null
              ),
            ]
          ),
          answer(
            '统一放在 `useEffect` 的清理函数里：\n\n```tsx\nuseEffect(() => {\n  const timer = setInterval(tick, 1000)\n  chart = initChart(el)\n  return () => {\n    clearInterval(timer)\n    chart.dispose()\n  }\n}, [])\n```\n\n`strict mode` 下开发环境会挂载两次，正好能暴露漏清理的副作用。'
          ),
        ],
      },
      {
        q: '图表实例 dispose 后还是泄漏，帮我看下这个封装',
        file: {
          type: 'FILE',
          files: [
            {
              id: 'mock-img-1',
              file_name: 'chart-leak-screenshot.png',
              file_size: tinyPng.length,
              token_usage: null,
              inserted_at: iso(now - 2 * DAY + 3600_000),
              export_path: null,
              is_image: true,
              width: 1,
              height: 1,
            },
          ],
        },
        tokens: 3900,
        fragments: [
          openPage(
            'https://echarts.apache.org/handbook/en/concepts/event',
            'ECharts 事件与销毁',
            'Apache ECharts'
          ),
          readLink('https://echarts.apache.org/handbook/en/concepts/event', 'ECharts Handbook'),
          partialRead(72),
          answer(
            "`dispose()` 之后 `resize` 监听还挂在 window 上就会留引用。把监听也放进清理函数，或者用 `AbortController` 一并取消：\n\n```tsx\nconst ac = new AbortController()\nwindow.addEventListener('resize', onResize, { signal: ac.signal })\nreturn () => { ac.abort(); chart.dispose() }\n```"
          ),
        ],
      },
      {
        q: '搞定了，Leak Canary 式的自查清单也来一份',
        tokens: 4210,
        fragments: [
          answer(
            '- [ ] 所有 `useEffect` 返回清理函数\n- [ ] 定时器 / 监听 / 观察者三件套对应清理\n- [ ] 全局 store 不持有组件内对象\n- [ ] 大列表虚拟滚动\n\n完成后连点 20 次路由切换，堆快照增幅应 < 2MB。'
          ),
          tip('建议在 CI 中加入长会话内存回归用例。'),
        ],
      },
    ],
  }),
  buildSession({
    id: 'mock-w2',
    title: 'REST API 设计评审',
    start: now - 5 * DAY,
    rounds: [
      {
        q: '分页接口用 page/pageSize 还是 cursor？给个对比表',
        tokens: 980,
        fragments: [
          search(
            ['API pagination cursor vs offset best practice'],
            [
              web(
                'https://jsonapi.org',
                'JSON:API Recommendations',
                '分页设计推荐',
                'jsonapi.org',
                '2024-05-11'
              ),
            ]
          ),
          answer(
            '| 维度 | page/pageSize | cursor |\n| --- | --- | --- |\n| 跳页 | ✅ | ❌ |\n| 深分页性能 | 差 | 好 |\n| 数据一致性 | 有漂移 | 稳定 |\n\n后台管理用前者，开放 API 用后者。'
          ),
        ],
      },
      {
        q: '错误码规范呢？业务码和 HTTP 状态码怎么配合',
        tokens: 1720,
        fragments: [
          answer(
            'HTTP 层只表达传输语义（4xx/5xx），业务错误放在响应体：\n\n```json\n{ "code": "ORDER_NOT_FOUND", "message": "订单不存在" }\n```\n\n错误码注册表统一维护，避免魔法数字。'
          ),
          tip('版本升级时新增错误码不删旧码。', 'WARNING'),
        ],
      },
      {
        q: '最后帮我出一版评审 checklist',
        tokens: 2440,
        fragments: [
          answer('1. 幂等键 2. 分页策略 3. 错误码表 4. 限流注记 5. 变更记录\n\n齐了就可以提 PR。'),
        ],
      },
    ],
  }),
  buildSession({
    id: 'mock-w3',
    title: 'TypeScript 类型体操',
    start: now - 9 * DAY,
    rounds: [
      {
        q: '写一个 DeepReadonly',
        tokens: 860,
        fragments: [
          think('递归映射每个属性，数组与函数特判。', 3),
          answer(
            '```ts\ntype DeepReadonly<T> = T extends Function\n  ? T\n  : T extends readonly (infer U)[]\n    ? readonly DeepReadonly<U>[]\n    : { readonly [K in keyof T]: DeepReadonly<T[K]> }\n```'
          ),
        ],
      },
      {
        q: '这个类型在联合类型上表现不对',
        tokens: 1310,
        status: 'CONTENT_FILTER',
        fragments: [
          think('模型原始思考：联合类型分发时，条件类型会逐项展开，需要小心 never。', 2),
          answer('模型原始正文：这里是被安全策略拦截前已经下发的正文内容。'),
          {
            type: 'TEMPLATE_RESPONSE',
            content: '该回复因触发内容安全策略被拦截，请调整问题后重试。',
          },
        ],
      },
      {
        q: '换个说法：分布式的条件类型怎么让 DeepReadonly 保持联合',
        tokens: 1870,
        fragments: [
          answer(
            '包一层 `[T] extends [never]` 的干净分发技巧，或直接 `DeepReadonly<T> = T extends object ? ... : T`，联合会被自动分发，无需额外处理。'
          ),
        ],
      },
    ],
  }),
  buildSession({
    id: 'mock-w4',
    title: '构建速度优化',
    start: now - 16 * DAY,
    rounds: [
      {
        q: '这是构建日志，帮忙看看慢在哪',
        file: {
          type: 'FILE',
          files: [
            {
              id: 'mock-log-1',
              file_name: 'build-trace.txt',
              file_size: 20480,
              token_usage: null,
              inserted_at: iso(now - 16 * DAY),
              export_path: null,
              is_image: false,
              width: null,
              height: null,
            },
          ],
        },
        tokens: 1150,
        fragments: [
          partialRead(35),
          answer('从 trace 看主要耗时在 TS 类型检查与图片资产压缩，占比 71%。'),
        ],
      },
      {
        q: '类型检查能挪出去吗',
        tokens: 1900,
        fragments: [
          answer(
            '可以。`ts-loader` 换 `babel/swc` 转译 + `fork-ts-checker` 异步检查，dev 构建约快 40%。'
          ),
        ],
      },
      {
        q: '图片压缩这块呢',
        tokens: 2680,
        fragments: [
          answer('构建期压缩改上线前一次性压缩 + CDN 实时处理，本地只做尺寸校验。'),
          tip('两者都上后收益见下一条会话记录。'),
        ],
      },
    ],
  }),
  buildSession({
    id: 'mock-w5',
    title: 'Git 工作流讨论',
    start: now - 30 * DAY,
    rounds: [
      {
        q: 'trunk-based 和 git-flow 怎么选',
        tokens: 720,
        fragments: [answer('小团队高频发布选 trunk-based；多版本并行维护才需要 git-flow。')],
      },
      {
        q: 'feature flag 管理有什么实践',
        tokens: 1310,
        fragments: [answer('旗标即代码：配置进仓库，过期旗标两周内清理。')],
      },
    ],
  }),
]

// ---------- 组二：学习笔记（4 会话，绿色） ----------
const studySessions = [
  buildSession({
    id: 'mock-s1',
    title: '泰勒级数误差阶辨析',
    start: now - 3 * DAY,
    rounds: [
      {
        q: 'Peano 余项说 $R_n = o(|x-a|^n)$，为什么不能推出 $O(|x-a|^{n+1})$？',
        tokens: 1240,
        fragments: [
          think('区分小 o 与大 O 的定义差异，举 $x^{100}$ 的反例。', 5),
          answer(
            '小 o 只保证**渐近上界**被 $|x-a|^n$ 压制，不承诺下一阶系数存在。\n\n$$R_n = o(|x-a|^n) \\quad \\text{Peano}$$\n\n要得到 Lagrange 形式需要 $f^{(n+1)}$ 在邻域有界。'
          ),
        ],
      },
      {
        q: '给一个余项真的高于 n+1 阶的例子',
        tokens: 2080,
        fragments: [
          answer(
            '例：$f(x)=x^{100}$ 在 $0$ 处展开到一阶，余项 $x^{100}$，远高于二阶。系数恰巧消光时误差可以跳阶。'
          ),
        ],
      },
      {
        q: '总结成一张速查表',
        tokens: 2450,
        fragments: [
          answer(
            '| 余项 | 条件 | 形式 |\n| --- | --- | --- |\n| Peano | $n$ 阶可导 | $o(|x-a|^n)$ |\n| Lagrange | $n+1$ 阶连续 | $\\frac{f^{(n+1)}(\\xi)}{(n+1)!}(x-a)^{n+1}$ |'
          ),
        ],
      },
    ],
  }),
  buildSession({
    id: 'mock-s2',
    title: '量子隧穿入门',
    start: now - 8 * DAY,
    rounds: [
      {
        q: '量子隧穿是什么？为什么经典粒子做不到',
        tokens: 990,
        fragments: [
          think('从波函数与势垒讲起，给出透射系数公式。', 4),
          answer(
            '波函数在势垒内指数衰减但不为零，粒子以一定概率出现在另一侧：\n\n$$T \\approx e^{-2\\kappa a}, \\quad \\kappa = \\sqrt{2m(V_0-E)}/\\hbar$$'
          ),
        ],
      },
      {
        q: '扫描隧道显微镜就是利用这个？',
        tokens: 1650,
        fragments: [
          search(
            ['STM 扫描隧道显微镜 隧穿电流 工作原理'],
            [
              web(
                'https://en.wikipedia.org/wiki/Scanning_tunneling_microscope',
                'Scanning tunneling microscope',
                'STM 利用隧穿电流随距离指数变化成像',
                'en.wikipedia.org',
                '2025-09-18'
              ),
            ]
          ),
          readLink(
            'https://en.wikipedia.org/wiki/Scanning_tunneling_microscope',
            'Scanning tunneling microscope'
          ),
          answer('对：针尖与样品间距 ≈ 1nm，隧穿电流变化约一个数量级/nm，反馈回路据此成像。'),
        ],
      },
    ],
  }),
  buildSession({
    id: 'mock-s3',
    title: 'LeetCode 打家劫舍',
    start: now - 12 * DAY,
    rounds: [
      {
        q: '打家劫舍的状态转移怎么推',
        tokens: 830,
        fragments: [
          think('dp[i] = max(dp[i-1], dp[i-2] + nums[i])，滚动变量压缩到 O(1)。', 2),
          answer(
            '```python\ndef rob(nums):\n    prev = cur = 0\n    for x in nums:\n        prev, cur = cur, max(cur, prev + x)\n    return cur\n```'
          ),
        ],
      },
      {
        q: '环形版本呢',
        tokens: 1490,
        fragments: [
          answer(
            '分两种情况：不偷第一家或不偷最后一家，两次线性 DP 取最大。\n\n```python\ndef rob_round(nums):\n    if len(nums) == 1:\n        return nums[0]\n    return max(rob(nums[:-1]), rob(nums[1:]))\n```\n\n时间复杂度 O(n)，空间 O(1)。\n\n补充说明：环形约束的本质是把「首尾相邻」拆成两个线性子问题，分别排除首元素或尾元素，取较优者即可覆盖所有合法方案。也可以扩展成树形结构（树上打家劫舍）或带权图，思路仍是「选与不选」的状态机。\n\n- 变体一：房屋排成二叉树 → 树形 DP，返回「选/不选」两值\n- 变体二：房屋构成环且带负数 → 需要额外考虑全负情况\n- 变体三：可以偷 k 次 → 增加一维状态\n\n做题建议：先把线性版写熟，环形版只是多一次调用。'
          ),
          tip('环形版本注意空数组与单元素边界。'),
        ],
      },
    ],
  }),
  buildSession({
    id: 'mock-s4',
    title: '英语论文写作',
    start: now - 20 * DAY,
    rounds: [
      {
        q: '帮我润色这句：The result is very good and proves our method.',
        tokens: 640,
        fragments: [
          answer(
            '改写：*The experimental results substantiate the effectiveness of the proposed method.*'
          ),
        ],
      },
      {
        q: '结论段再展开一点，写成三句',
        tokens: 1020,
        status: 'INCOMPLETE',
        fragments: [answer('In this work, we proposed a lightweight framework for…')],
      },
    ],
  }),
]

// ---------- 组三：生活杂项（3 会话） ----------
const lifeSessions = [
  buildSession({
    id: 'mock-l1',
    title: '冰岛旅行攻略',
    start: now - 6 * DAY,
    rounds: [
      {
        q: '十二月去冰岛，极光概率高吗？给一份 7 天路线',
        file: {
          type: 'FILE',
          files: [
            {
              id: 'mock-img-2',
              file_name: 'iceland-map.png',
              file_size: tinyPng.length,
              token_usage: null,
              inserted_at: iso(now - 6 * DAY + 1200_000),
              export_path: null,
              is_image: true,
              width: 1,
              height: 1,
            },
          ],
        },
        tokens: 1580,
        fragments: [
          search(
            ['Iceland December northern lights probability route'],
            [
              web(
                'https://www.vedur.is',
                'Icelandic Met Office',
                '极光指数预报官方站',
                'vedur.is',
                null
              ),
              web(
                'https://www.guidetoiceland.is',
                'Guide to Iceland',
                '环岛路线与极光团',
                'guidetoiceland.is',
                '2025-10-30'
              ),
            ]
          ),
          answer(
            '十二月 KP 指数常态 2-4，晴夜概率约 60%。\n\n1. Day1-2 雷克雅未克 + 金圈\n2. Day3-4 南岸（瀑布/黑沙滩/冰河湖）\n3. Day5-6 杰古沙龙 + 蓝冰洞\n4. Day7 回城泡蓝湖'
          ),
        ],
      },
      {
        q: '租车开冬季路况靠谱吗',
        tokens: 2310,
        fragments: [
          readLink('https://www.road.is', 'Road and weather conditions'),
          answer(
            '走 1 号环岛公路没问题，F 类路冬季封闭。车必须带雪胎，查 road.is 每天出门前看路况色标。'
          ),
        ],
      },
      {
        q: '预算大概多少',
        tokens: 2950,
        fragments: [answer('两人 7 天约 ¥28,000：机票 9k、租车+油 5k、住宿 8k、吃 4k、活动 2k。')],
      },
      {
        q: '出发前还有什么容易踩的坑',
        tokens: 3230,
        fragments: [
          answer('风大必须车门反向开；温泉预约提前一周；超市自己做饭能省一半餐费。'),
          tip('出行前购买覆盖户外活动的旅行保险。', 'CAUTION'),
        ],
      },
    ],
  }),
  buildSession({
    id: 'mock-l2',
    title: '红烧肉做法',
    start: now - 15 * DAY,
    rounds: [
      {
        q: '红烧肉怎么做到肥而不腻',
        tokens: 560,
        fragments: [
          answer(
            '选三层五花肉，先焯水再干煸出油，糖色炒到枣红，啤酒代替料酒炖 90 分钟，最后大火收汁。'
          ),
        ],
      },
    ],
  }),
  buildSession({
    id: 'mock-l3',
    title: '长会话压测',
    start: now - 45 * DAY,
    rounds: Array.from({ length: 20 }, (_, i) => ({
      q: `第 ${i + 1} 轮：随机的测试提问 #${i + 1}`,
      tokens: 300 + i * 90,
      fragments: [
        answer(
          `第 ${i + 1} 轮的回答。用于测试右侧导航条在多轮会话下的折叠与跳转表现。` +
            '内容填充。'.repeat(3)
        ),
      ],
    })),
  }),
]

/** 会话 → ZIP 条目集合 */
function sessionEntries(sessions) {
  const entries = {}
  const index = []
  for (const session of sessions) {
    entries[`chat_sessions/${session.id}.json`] = strToU8(JSON.stringify(session))
    index.push({
      id: session.id,
      title: session.title,
      pinned: session.pinned,
      message_count: session.messages.length,
      inserted_at: session.inserted_at,
      updated_at: session.updated_at,
    })
  }
  return { entries, index }
}

function makeZip(fileName, sessions, colorNote) {
  const { entries, index } = sessionEntries(sessions)
  const zip = {
    'manifest.json': strToU8(JSON.stringify({ export_format_version: 3 })),
    // 官方归档里可能出现的账号文件；外部扫描必须跳过且不能抢走 DeepSeek 导入
    'user.json': strToU8(
      JSON.stringify({ id: 'PRIVATE_DEEPSEEK_USER', email: 'PRIVATE_DEEPSEEK_EMAIL' })
    ),
    ...entries,
    'chat_session_index.json': strToU8(JSON.stringify(index)),
  }
  // 图片附件：真实 PNG + 归档引用路径
  for (const session of sessions) {
    for (const message of session.messages) {
      for (const fragment of message.fragments) {
        if (fragment.type !== 'FILE') continue
        for (const file of fragment.files) {
          if (file.is_image && file.id.startsWith('mock-img')) {
            const dir = `chat_sessions/${session.id}_files/`
            file.export_path = `${dir}${file.id}_${file.file_name}`.normalize('NFC')
            zip[file.export_path] = new Uint8Array(tinyPng)
          }
        }
      }
    }
  }
  writeFileSync(path.join(outDir, fileName), zipSync(zip))
  console.log(
    `${fileName}: ${sessions.length} 会话 / ${sessions.reduce((n, s) => n + s.messages.length, 0)} 条消息 · ${colorNote}`
  )
}

makeZip(
  'mock-data.zip',
  [...workSessions, ...studySessions, ...lifeSessions],
  '工作 / 学习 / 生活三类，共 12 个会话'
)
// ---------- 外部格式样例：ChatGPT / Claude JSON ----------
const cgTime = (offset) => (now - 3 * 86400000 + offset) / 1000
const node = (id, parentId, role, text, index) => ({
  id,
  parent: parentId,
  children: [],
  message: {
    id,
    author: { role },
    content: { content_type: 'text', parts: [text] },
    create_time: cgTime(index * 60000),
  },
})
const n1 = node('cg-n1', null, 'system', 'You are a helpful assistant.', 0)
const n2 = node('cg-n2', 'cg-n1', 'user', 'Rust 的所有权解决了什么问题？', 1)
const n3 = node(
  'cg-n3',
  'cg-n2',
  'assistant',
  '所有权在编译期保证内存安全：每个值有唯一所有者，离开作用域自动释放。',
  2
)
const n4 = node('cg-n4', 'cg-n3', 'user', '那借用呢？', 3)
const n5 = node(
  'cg-n5',
  'cg-n4',
  'assistant',
  '借用通过引用临时访问值，同一时间要么多个不可变借用，要么一个可变借用。',
  4
)
n1.children = ['cg-n2']
n2.children = ['cg-n3']
n3.children = ['cg-n4']
n4.children = ['cg-n5']
const m1 = node('cg-m1', null, 'user', '煮鸡蛋几分钟？', 0)
const m2 = node('cg-m2', 'cg-m1', 'assistant', '冷水下锅水开后 6-8 分钟，喜欢溏心 5 分钟。', 1)
m1.children = ['cg-m2']
const chatgpt = [
  {
    id: 'cg-1',
    title: 'ChatGPT 示例：Rust 所有权',
    create_time: cgTime(0),
    update_time: cgTime(300000),
    current_node: 'cg-n5',
    mapping: Object.fromEntries([n1, n2, n3, n4, n5].map((item) => [item.id, item])),
  },
  {
    id: 'cg-2',
    title: 'ChatGPT 示例：早餐',
    create_time: cgTime(600000),
    update_time: cgTime(660000),
    current_node: 'cg-m2',
    mapping: Object.fromEntries([m1, m2].map((item) => [item.id, item])),
  },
]
writeFileSync(path.join(outDir, 'chatgpt-sample.json'), JSON.stringify(chatgpt, null, 2))
// 单独导入时应提示“无内容”的账号个人数据文件
writeFileSync(
  path.join(outDir, 'user.json'),
  JSON.stringify({ id: 'PRIVATE_PROFILE_ID', email: 'PRIVATE_PROFILE_EMAIL' })
)
writeFileSync(
  path.join(outDir, 'users.json'),
  JSON.stringify({ users: [{ uuid: 'private-user', memories: ['PRIVATE_USERS_MEMORY'] }] })
)
// 官方导出形态：ZIP 里包着 conversations.json
writeFileSync(
  path.join(outDir, 'chatgpt-sample.zip'),
  zipSync({
    'conversations.json': strToU8(JSON.stringify(chatgpt)),
    'conversation_summaries.json': strToU8(
      JSON.stringify({
        'summary-1': '用户偏好简洁直接的回答',
        'summary-2': '用户正在学习 Rust',
      })
    ),
    'user.json': strToU8(
      JSON.stringify({
        id: 'PRIVATE_PROFILE_ID',
        email: 'PRIVATE_PROFILE_EMAIL',
        phone: 'PRIVATE_PROFILE_PHONE',
        birth_year: 1990,
      })
    ),
    'user_settings.json': strToU8(
      JSON.stringify({
        settings: { theme: 'PRIVATE_SETTING_THEME', language: 'PRIVATE_SETTING_LANGUAGE' },
      })
    ),
  })
)

const claude = [
  {
    uuid: 'cl-1',
    name: 'Claude 示例：论文润色',
    summary: '**会话摘要**：这是一次论文润色对话，包含学术表达改写与精简要求。',
    created_at: new Date(now - 5 * 86400000).toISOString(),
    updated_at: new Date(now - 5 * 86400000 + 120000).toISOString(),
    chat_messages: [
      {
        uuid: 'cl-1-1',
        sender: 'human',
        text: '帮我把这句改学术一点：We did a lot of tests and the result is good.',
        content: [
          {
            type: 'injected_prompt_block',
            prompt: '<system-reminder>会话级注入的系统提示（示例记忆快照）。</system-reminder>',
            injection_source: 'memory_block_head',
            initial_turn_only: false,
            skip_on_truncated_continuation: false,
          },
          {
            type: 'text',
            text: '帮我把这句改学术一点：We did a lot of tests and the result is good.',
            citations: [],
          },
        ],
        created_at: new Date(now - 5 * 86400000).toISOString(),
        attachments: [],
        files: [{ file_uuid: 'cl-file-1', file_name: 'paper.png' }],
        parent_message_uuid: '00000000-0000-4000-8000-000000000000',
      },
      {
        uuid: 'cl-1-2',
        sender: 'assistant',
        // 真实导出：text 是思考 + 正文的拼接全文；结构化内容在 content 中
        text: 'I need to rewrite this sentence in an academic tone.\n\nWe conducted extensive experiments, and the results demonstrate strong performance.',
        content: [
          {
            type: 'thinking',
            thinking: 'I need to rewrite this sentence in an academic tone.',
            summaries: [{ summary: '改写为学术表达。' }],
            start_timestamp: new Date(now - 5 * 86400000 + 5000).toISOString(),
            stop_timestamp: new Date(now - 5 * 86400000 + 25000).toISOString(),
            flags: null,
            cut_off: false,
            truncated: true,
            hidden: false,
            thinking_hidden: false,
            signature: 'mock-signature-abc123',
          },
          {
            type: 'artifact',
            title: '示例 artifact',
            content: 'artifact 内容不会出现在导出中',
          },
          {
            type: 'text',
            text: 'We conducted extensive experiments, and the results demonstrate strong performance.',
            citations: [
              {
                type: 'web_search_result_location',
                url: 'https://example.com/paper',
                title: '示例论文来源',
                cited_text: 'extensive experiments demonstrate strong performance',
                encrypted_index: '',
              },
            ],
          },
        ],
        created_at: new Date(now - 5 * 86400000 + 30000).toISOString(),
        attachments: [],
        files: [],
        parent_message_uuid: 'cl-1-1',
      },
      {
        uuid: 'cl-1-3',
        sender: 'human',
        text: '再精简一点',
        created_at: new Date(now - 5 * 86400000 + 60000).toISOString(),
        attachments: [],
        files: [],
        parent_message_uuid: 'cl-1-2',
      },
      {
        uuid: 'cl-1-4',
        sender: 'assistant',
        text: 'Extensive experiments confirm the strong performance.',
        created_at: new Date(now - 5 * 86400000 + 70000).toISOString(),
        attachments: [],
        files: [],
        parent_message_uuid: 'cl-1-3',
      },
    ],
  },
]
writeFileSync(path.join(outDir, 'claude-sample.json'), JSON.stringify(claude, null, 2))
// 官方导出形态：ZIP 里 conversations.json + projects.json
writeFileSync(
  path.join(outDir, 'claude-sample.zip'),
  zipSync({
    'conversations.json': strToU8(JSON.stringify(claude)),
    'projects.json': strToU8(
      JSON.stringify({
        projects: [
          {
            uuid: 'proj-1',
            name: '论文项目',
            prompt_template: '你是学术写作助手，回答保持严谨、简洁。',
            docs: [{ uuid: 'doc-1', filename: '写作规范.md' }],
          },
        ],
      })
    ),
    'users.json': strToU8(
      JSON.stringify({
        users: [{ uuid: 'user-1', memories: ['PRIVATE_USERS_MEMORY'] }],
      })
    ),
    'login_history.json': strToU8(JSON.stringify([{ uuid: 'login-1', ip: 'PRIVATE_LOGIN_IP' }])),
    'memories/00000000-0000-4000-8000-000000000099.json': strToU8(
      JSON.stringify({
        conversations_memory: 'MEMORY_CONVERSATIONS_CONTENT',
        memory_files: [
          { path: '记忆/项目笔记.md', content: 'MEMORY_FILE_CONTENT', updated_at: null },
        ],
        account_uuid: '00000000-0000-4000-8000-000000000099',
      })
    ),
  })
)
const zai = {
  data: {
    chats: [
      {
        id: 'zai-1',
        name: 'z.ai 示例：GLM 问答',
        created_at: new Date(now - 4 * 86400000).toISOString(),
        updated_at: new Date(now - 4 * 86400000 + 60000).toISOString(),
        chat_history: [
          { role: 'system', content: '你是 GLM，一个乐于助人的 AI 助手。' },
          { role: 'user', content: '用一句话介绍 z.ai' },
          { role: 'assistant', content: 'z.ai 是智谱推出的 AI 助手平台。' },
          { role: 'user', content: '再短一点' },
          { role: 'assistant', content: '智谱的 AI 助手。' },
        ],
      },
    ],
  },
}
writeFileSync(path.join(outDir, 'zai-sample.json'), JSON.stringify(zai, null, 2))
// z.ai / OpenWebUI 原生形态：chat.history.messages 对象树 + currentId 分支
const zaiBase = Math.floor((now - 6 * 86400000) / 1000)
const zaiNative = [
  {
    id: 'zai-native-1',
    title: 'z.ai 原生：分支历史',
    timestamp: zaiBase,
    created_at: zaiBase,
    updated_at: zaiBase + 600,
    chat: {
      id: 'zai-native-chat',
      models: ['glm-4'],
      params: {},
      history: {
        currentId: 'zai-a2',
        messages: {
          'zai-u1': {
            id: 'zai-u1',
            parentId: null,
            childrenIds: ['zai-a1', 'zai-a2'],
            role: 'user',
            timestamp: zaiBase,
            content: '请解释一下什么是 RAG',
          },
          'zai-a1': {
            id: 'zai-a1',
            parentId: 'zai-u1',
            childrenIds: [],
            role: 'assistant',
            timestamp: zaiBase + 10,
            content: '旧分支回答（不应显示）',
          },
          'zai-a2': {
            id: 'zai-a2',
            parentId: 'zai-u1',
            childrenIds: [],
            role: 'assistant',
            timestamp: zaiBase + 20,
            content: '当前分支回答：RAG 是检索增强生成。',
          },
        },
      },
    },
  },
]
writeFileSync(path.join(outDir, 'zai-history-sample.json'), JSON.stringify(zaiNative, null, 2))

// turn_history 单会话封装（含 session_metadata / global_context，故意保留行注释）
const turnsBase = new Date(now - 3 * 86400000).toISOString()
const claudeTurns = {
  conversation_id: 'turns-1',
  title: 'Claude turn_history 示例',
  session_metadata: {
    source: 'native_export',
    timestamp_start: turnsBase,
    timestamp_end: new Date(now - 3 * 86400000 + 60000).toISOString(),
    status: 'COMPLETED',
  },
  turn_history: [
    {
      role: 'user',
      metadata: { uuid: 'turns-m1', sender: 'human', created_at: turnsBase },
      content: '把这段内容压缩成一句摘要。',
      attachments: [],
    },
    {
      role: 'assistant',
      metadata: { uuid: 'turns-m2', sender: 'AI Model', created_at: turnsBase },
      content: '这是压缩后的摘要结果。',
      citations: [],
      system_prompt_applied: true,
    },
  ],
  global_context: {
    system_instructions: '会话级系统指令：保持简洁。',
    user_profile_mock: '[Mock User Profile Details]',
  },
}
writeFileSync(path.join(outDir, 'claude-turns-sample.json'), JSON.stringify(claudeTurns, null, 2))

console.log('外部格式样例: chatgpt / claude / zai / zai-history / claude-turns')

console.log(`输出目录: ${outDir}`)
