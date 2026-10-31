/**
 * dsh-search-hub — plugin entry (Host half).
 *
 * A management surface for the DSH web-search engine pool. This plugin does NOT
 * register a search provider: `dsh-free-search` already owns the `ctx.web`
 * search seam. This half only exposes an HTTP API so the browser half can:
 *
 *   - read which engines are configured / keyless / missing a key
 *   - write and remove engine API keys through the host credentials service
 *   - read and write the engine pool config (fallbackOrder / pools / provider)
 *   - read which search provider `ctx.web` currently points at
 *
 * Data layout:
 *   ~/.dsh/dsh-search-hub/apply-probe.txt   (proves this half ran)
 *
 * Routes (same origin as the client half):
 *   GET  /api/dsh-search-hub/status    engine table + provider selection
 *   POST /api/dsh-search-hub/key       { key, value }  -> credentials.set
 *   POST /api/dsh-search-hub/unkey     { key }         -> credentials.unset
 *   GET  /api/dsh-search-hub/config    pool config view
 *   POST /api/dsh-search-hub/config    { provider, fallbackOrder, zhPool, enPool }
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import https from 'node:https'
import { exec } from 'node:child_process'

/** Cordis plugin name. */
export const name = 'dsh-search-hub'

export const SEARCH_HUB_VERSION = '0.1.0'

/** Directory under the DSH home. */
export const DATA_DIR_NAME = 'dsh-search-hub'

/** The plugin that owns the search seam (its provider id is `ddg`). */
const OWNER_PLUGIN = 'dsh-free-search'
const OWNER_ENTRY_ID = 'web-search-free'
const OWNER_PROVIDER_ID = 'ddg'

/**
 * Engine catalogue. Mirrors `ALL_ENGINES` in dsh-free-search so the panel can
 * describe every engine without importing that package.
 *
 * `credRef` is the credential name the engine reads; engines with no credRef
 * work without a key.
 */
const ENGINES = [
  { id: 'bing', name: 'Bing', kind: 'free', credRef: null, url: 'https://www.bing.com', note: '默认引擎，中文优化（zh-CN）' },
  { id: 'anysearch', name: 'AnySearch', kind: 'free', credRef: 'ANYSEARCH_API_KEY', url: 'https://anysearch.com', note: '匿名额度；配 key 提额' },
  { id: 'exa', name: 'Exa', kind: 'free', credRef: 'EXA_API_KEY', url: 'https://exa.ai', note: '语义搜索；无 key 走 MCP 匿名' },
  { id: 'tavily', name: 'Tavily', kind: 'free', credRef: 'TAVILY_API_KEY', url: 'https://tavily.com', note: 'AI 专用；无 key 走 keyless 档' },
  { id: 'keenable', name: 'Keenable', kind: 'free', credRef: 'KEENABLE_API_KEY', url: 'https://keenable.ai', note: '无 key 走公开 MCP' },
  { id: 'firecrawl', name: 'Firecrawl', kind: 'free', credRef: 'FIRECRAWL_API_KEY', url: 'https://firecrawl.dev', note: 'keyless 按出口 IP 判定，VPN 会被拒' },
  { id: 'parallel', name: 'Parallel', kind: 'free', credRef: 'PARALLEL_API_KEY', url: 'https://parallel.ai', note: '无 key 走官方 MCP 匿名' },
  { id: 'you', name: 'You.com', kind: 'free', credRef: 'YOUCOM_API_KEY', url: 'https://you.com', note: '免 key 每天 100 次；需代理' },
  { id: 'searxng', name: 'SearXNG', kind: 'free', credRef: null, url: 'https://github.com/searxng/searxng', note: '元搜索，需自建实例或代理' },
  { id: 'ddg', name: 'DuckDuckGo', kind: 'free', credRef: null, url: 'https://duckduckgo.com', note: 'HTML 抓取，需代理' },
  { id: 'ddg-lite', name: 'DuckDuckGo Lite', kind: 'free', credRef: null, url: 'https://lite.duckduckgo.com/lite', note: '轻量版，需代理' },
  { id: 'baidu', name: '百度千帆', kind: 'key', credRef: 'BAIDU_API_KEY', url: 'https://console.bce.baidu.com/qianfan', note: '每日 50 次免费；必须 API Key (V2)' },
  { id: 'doubao', name: '豆包搜索（火山联网）', kind: 'key', credRef: 'DOUBAO_SEARCH_API_KEY', url: 'https://console.volcengine.com/search-infinity/web-search', note: '每月 500 次免费；非方舟 Ark key' },
  { id: 'aliyun', name: '阿里百炼', kind: 'key', credRef: 'DASHSCOPE_API_KEY', url: 'https://bailian.console.aliyun.com', note: '新用户 200 次包' },
  { id: 'kimi', name: 'Kimi 联网', kind: 'key', credRef: 'MOONSHOT_API_KEY', url: 'https://platform.kimi.com', note: '约 ¥0.01/次，返回正文' },
  { id: 'zhihu_global', name: '知乎全网', kind: 'key', credRef: 'ZHIHU_API_KEY', url: 'https://developer.zhihu.com', note: '每日 5000 次试用' },
  { id: 'zhihu_site', name: '知乎站内', kind: 'key', credRef: 'ZHIHU_API_KEY', url: 'https://developer.zhihu.com', note: '与知乎全网共享额度' },
  { id: 'serply', name: 'Serply（Google）', kind: 'key', credRef: 'SERPLY_API_KEY', url: 'https://serply.io', note: '30 天 2500 次免费' },
  { id: 'serpbase', name: 'SerpBase', kind: 'key', credRef: 'SERPBASE_API_KEY', url: 'https://serpbase.dev', note: '注册送 100 次' },
  { id: 'perplexity', name: 'Perplexity', kind: 'key', credRef: 'PERPLEXITY_API_KEY', url: 'https://perplexity.ai', note: '按量计费' },
  { id: 'tinyfish', name: 'TinyFish', kind: 'key', credRef: 'TINYFISH_API_KEY', url: 'https://tinyfish.ai', note: '免费层限速率' },
  { id: 'jina', name: 'Jina AI', kind: 'key', credRef: 'JINA_API_KEY', url: 'https://jina.ai', note: '新 key 送 10M tokens' },
  { id: 'deepseek-official', name: 'DeepSeek 官方', kind: 'key', credRef: 'DEEPSEEK_API_KEY', url: 'https://platform.deepseek.com', note: '模型轮次，按 token 计费' },
  { id: 'deepseek-tools', name: 'DeepSeek 原生 API', kind: 'key', credRef: 'DEEPSEEK_API_KEY', url: 'https://platform.deepseek.com', note: '直连约 0.3s，不耗 token' },
  { id: 'openai', name: 'OpenAI 内置搜索', kind: 'model', credRef: 'OPENAI_API_KEY', url: 'https://platform.openai.com', note: '按次计费，仅显式选中' },
  { id: 'gemini', name: 'Gemini Grounding', kind: 'model', credRef: 'GEMINI_API_KEY', url: 'https://ai.google.dev', note: '按次计费，仅显式选中' },
  { id: 'claude', name: 'Claude web_search', kind: 'model', credRef: 'ANTHROPIC_API_KEY', url: 'https://console.anthropic.com', note: '按次计费，仅显式选中' },
]

const ENGINE_BY_ID = new Map(ENGINES.map((e) => [e.id, e]))

// ── engine brand icons (favicon proxy + local cache) ──────────────────────
const ICON_DOMAINS = {
  bing: 'www.bing.com',
  anysearch: 'anysearch.com',
  exa: 'exa.ai',
  tavily: 'tavily.com',
  keenable: 'keenable.ai',
  firecrawl: 'firecrawl.dev',
  parallel: 'parallel.ai',
  you: 'you.com',
  searxng: 'docs.searxng.org',
  ddg: 'duckduckgo.com',
  'ddg-lite': 'duckduckgo.com',
  baidu: 'www.baidu.com',
  doubao: 'www.volcengine.com',
  aliyun: 'www.aliyun.com',
  kimi: 'www.kimi.com',
  zhihu_global: 'www.zhihu.com',
  zhihu_site: 'www.zhihu.com',
  serply: 'serply.io',
  serpbase: 'serpbase.dev',
  perplexity: 'www.perplexity.ai',
  tinyfish: 'tinyfish.ai',
  jina: 'jina.ai',
  'deepseek-official': 'www.deepseek.com',
  'deepseek-tools': 'www.deepseek.com',
  openai: 'openai.com',
  gemini: 'aistudio.google.com',
  claude: 'www.anthropic.com',
}

function iconsDir() {
  return path.join(dataDir(), 'icons')
}
function iconCachePath(id) {
  return path.join(iconsDir(), `${id}.ico`)
}
function httpsGet(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      },
    }, (res) => {
      if (res.statusCode >= 400) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return }
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        resolve(httpsGet(new URL(res.headers.location, url).toString(), timeoutMs))
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', (e) => reject(e))
    req.setTimeout(timeoutMs, () => req.destroy(new Error('icon fetch timeout')))
  })
}
function isImageBuffer(buf) {
  if (!buf || buf.length < 8) return false
  return (
    (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) || // ico
    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) || // png
    (buf[0] === 0xff && buf[1] === 0xd8) || // jpeg
    (buf.length > 16 && buf.toString('latin1', 0, 8).trimStart().toLowerCase().startsWith('<svg')) // svg
  )
}
async function fetchIcon(domain) {
  const tries = [
    `https://${domain}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ]
  for (const url of tries) {
    try {
      const buf = await httpsGet(url, 6000)
      if (isImageBuffer(buf)) return buf
    } catch {
      // try next source
    }
  }
  return null
}

/** Credentials this panel is allowed to write (whitelist). */
const WRITABLE_REFS = new Set(ENGINES.map((e) => e.credRef).filter(Boolean))

function homeDir() {
  return os.homedir()
}

function dataDir() {
  return path.join(homeDir(), '.dsh', DATA_DIR_NAME)
}

function profilePatchPath() {
  // The desktop profile is the one the app manages; fall back to `web`.
  const candidates = ['desktop', 'web', 'default']
  for (const p of candidates) {
    const f = path.join(homeDir(), '.dsh', 'profiles', p, 'cordis.patch.yml')
    if (fs.existsSync(f)) return f
  }
  return null
}

async function readJsonBody(request) {
  try {
    if (typeof request?.json === 'function') return await request.json()
    const chunks = []
    for await (const chunk of request ?? []) chunks.push(chunk)
    if (chunks.length === 0) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

/** Read the current engine-pool config out of the profile patch file. */
function readPoolConfig() {
  const file = profilePatchPath()
  if (file === null) return { available: false, reason: 'profile patch not found' }
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    return { available: false, reason: `read failed: ${String(error?.message ?? error)}` }
  }

  // Tiny targeted parse: find the `- id: web-search-free` entry and read the
  // keys we care about. Avoids pulling a YAML dependency into the host.
  const out = {
    available: true,
    file,
    provider: null,
    fallbackOrder: [],
    zhPool: [],
    enPool: [],
    disabledEngines: [],
    searchProvider: null,
    fetchProvider: null,
  }

  const lines = text.split(/\r?\n/)
  let inEntry = false
  let listKey = null
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ')

    if (/^- id: (web|web-search-free)$/.test(line.trim())) {
      inEntry = line.trim()
      listKey = null
      continue
    }
    // Any other top-level entry ends the block we were reading.
    if (/^- /.test(line) && !/^- id: (web|web-search-free)$/.test(line.trim())) {
      inEntry = false
      listKey = null
      continue
    }
    if (!inEntry) continue

    const inlineList = line.match(/^    ([A-Za-z]+): \[([^\]]*)\]$/)
    if (inlineList !== null) {
      const [, k, body] = inlineList
      const vals = body.split(',').map((s) => s.trim()).filter(Boolean)
      if (k === 'fallbackOrder') out.fallbackOrder = vals
      if (k === 'zhPool') out.zhPool = vals
      if (k === 'enPool') out.enPool = vals
      if (k === 'disabledEngines') out.disabledEngines = vals
      listKey = null
      continue
    }

    const scalar = line.match(/^    ([A-Za-z]+): (.+)$/)
    if (scalar !== null) {
      const [, k, v] = scalar
      const val = v.replace(/^['"]|['"]$/g, '').trim()
      if (k === 'provider') out.provider = val
      if (k === 'searchProvider') out.searchProvider = val
      if (k === 'fetchProvider') out.fetchProvider = val
      listKey = null
      continue
    }

    const listHead = line.match(/^    ([A-Za-z]+):$/)
    if (listHead !== null) {
      listKey = listHead[1]
      continue
    }

    const item = line.match(/^      - ([^#].*)$/)
    if (item !== null && listKey !== null) {
      const val = item[1].trim().replace(/^['"]|['"]$/g, '')
      if (listKey === 'fallbackOrder') out.fallbackOrder.push(val)
      if (listKey === 'zhPool') out.zhPool.push(val)
      if (listKey === 'enPool') out.enPool.push(val)
      if (listKey === 'disabledEngines') out.disabledEngines.push(val)
    }
  }

  return out
}

/** Resolve the host credentials service at call time, never at apply time:
 *  it may mount after this plugin (cross-bundle ordering), mirroring how
 *  dsh-free-search does it (`ctx.get("credentials")`). */
function getCredentials(ctx) {
  try {
    return ctx?.get?.('credentials') ?? null
  } catch {
    return null
  }
}

/** Ask the host's credentials service which engine keys are configured.
 *  Fully defensive: the service may not be injected; any access failure
 *  is treated as "unavailable" instead of aborting the whole request. */
async function credentialStatus(ctx) {
  const configured = {}
  const credentials = getCredentials(ctx)
  const available = credentials !== null
  for (const engine of ENGINES) {
    if (engine.credRef === null) {
      configured[engine.credRef ?? engine.id] = null
      continue
    }
    if (!available) {
      configured[engine.credRef] = false
      continue
    }
    try {
      const info = await credentials.describe(engine.credRef)
      configured[engine.credRef] = Boolean(info && info.configured)
    } catch {
      configured[engine.credRef] = false
    }
  }
  return { available, configured }
}

/** Split a stored key field into individual API keys (mirrors dsh-free-search splitApiKeys). */
function splitKeys(raw) {
  return String(raw ?? '').split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean)
}

/** Read every configured API key for a credential ref (multi-key support). */
async function readRefKeys(credentials, ref) {
  if (!credentials || !ref) return []
  try {
    const info = await credentials.describe(ref)
    if (!info || !info.configured) return []
    const resolved = await credentials.resolve(ref)
    return splitKeys(resolved?.value)
  } catch {
    return []
  }
}

/** Masked key summaries for the panel: [{ tail, index, name }]. */
async function refKeySummaries(credentials, ref) {
  const keys = await readRefKeys(credentials, ref)
  const names = readKeyNames()[ref] ?? []
  return keys.map((k, index) => ({ tail: k.length > 4 ? k.slice(-4) : k, index, name: names[index] ?? '' }))
}

// ── per-key friendly names ──────────────────────────────────────────────
// Names are stored separately from the credential value (which must stay a
// plain comma-separated string for dsh-free-search's key-ring rotation).
function keyNamesFile() {
  return path.join(dataDir(), 'key-names.json')
}
function readKeyNames() {
  try {
    const data = JSON.parse(fs.readFileSync(keyNamesFile(), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}
function writeKeyNames(map) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.writeFileSync(keyNamesFile(), JSON.stringify(map, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/** Build the engine table the panel renders. */
async function statusPayload(ctx) {
  const pool = readPoolConfig()
  const creds = await credentialStatus(ctx)
  const credentials = getCredentials(ctx)

  // Multi-key summaries per credential ref (masked tails only, never full keys).
  const keys = {}
  for (const engine of ENGINES) {
    if (engine.credRef && creds.available) {
      keys[engine.credRef] = await refKeySummaries(credentials, engine.credRef)
    }
  }

  const engines = ENGINES.map((engine) => {
    const hasKey = engine.credRef === null ? null : Boolean(creds.configured[engine.credRef])
    const enabled = !pool.disabledEngines.includes(engine.id)
    let state
    if (!enabled) state = 'disabled'
    else if (engine.credRef === null) state = 'keyless'
    else if (hasKey) state = 'ready'
    else state = 'needs-key'
    return {
      id: engine.id,
      name: engine.name,
      kind: engine.kind,
      note: engine.note,
      url: engine.url ?? null,
      credRef: engine.credRef,
      hasKey,
      enabled,
      state,
      inFallback: pool.fallbackOrder.includes(engine.id),
    }
  })

  const ready = engines.filter((e) => e.state === 'ready' || e.state === 'keyless').length
  const needsKey = engines.filter((e) => e.state === 'needs-key').length

  return {
    ok: true,
    version: SEARCH_HUB_VERSION,
    credentialsAvailable: creds.available,
    owner: { plugin: OWNER_PLUGIN, entryId: OWNER_ENTRY_ID, providerId: OWNER_PROVIDER_ID },
    provider: {
      // What ctx.web is actually pinned to (null = not read yet).
      current: pool.searchProvider,
      expected: OWNER_PROVIDER_ID,
      matchesOwner: pool.searchProvider === OWNER_PROVIDER_ID,
      fetchProvider: pool.fetchProvider,
    },
    pool: {
      available: pool.available,
      file: pool.file ?? null,
      defaultEngine: pool.provider,
      fallbackOrder: pool.fallbackOrder,
      zhPool: pool.zhPool,
      enPool: pool.enPool,
    },
    engines,
    keys,
    summary: { total: engines.length, ready, needsKey, disabled: engines.filter((e) => e.state === 'disabled').length },
  }
}

/** Write the engine pool config back into the profile patch file. */
function writePoolConfig(update) {
  const file = profilePatchPath()
  if (file === null) throw new Error('profile patch not found')

  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)

  const fmtList = (key, values) =>
    `    ${key}: [${values.join(', ')}]`

  let sawEntry = false
  const out = []
  let inEntry = false
  let skipBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (/^- id: web-search-free$/.test(trimmed)) {
      sawEntry = true
      inEntry = true
      skipBlock = false
      out.push(line)
      continue
    }

    if (inEntry && /^- /.test(line) && !/^- id: web-search-free$/.test(trimmed)) {
      inEntry = false
      skipBlock = false
      out.push(line)
      continue
    }

    if (!inEntry) {
      out.push(line)
      continue
    }

    // Inside the entry: replace the keys we manage, keep everything else.
    const mScalar = line.match(/^    (provider|fallbackOrder|zhPool|enPool|disabledEngines):(.*)$/)
    if (mScalar !== null) {
      const k = mScalar[1]
      const replacing = update[k] !== undefined
      // Only swallow the following block items when we are actually replacing
      // this key. Otherwise `fallbackOrder:` (block form) would lose its items
      // even though the caller only touched `zhPool`.
      skipBlock = replacing && mScalar[2].trim() === ''
      if (replacing) {
        out.push(k === 'provider' ? `    provider: ${update.provider}` : fmtList(k, update[k]))
      } else {
        out.push(line)
      }
      continue
    }

    // Block-list items belonging to a replaced key.
    if (skipBlock && /^      - /.test(line)) {
      continue
    }
    if (skipBlock && !/^      - /.test(line) && line.trim() !== '') {
      skipBlock = false
    }

    out.push(line)
  }

  if (!sawEntry) {
    throw new Error('no `- id: web-search-free` entry in the profile patch; install dsh-free-search first')
  }

  // Atomic-ish write: temp file then rename.
  const tmp = `${file}.tmp-${Date.now()}`
  fs.writeFileSync(tmp, out.join('\n'), 'utf8')
  fs.renameSync(tmp, file)
  return { file, written: true }
}

// ── availability & quota probes ──────────────────────────────────────────
// 参考 one-api/new-api 的「渠道测试 + 余额查询」思路：可用性 = 对每个引擎发
// 最小请求（尽量零消耗：models 列表 / 1 条搜索 / MCP initialize）；额度 = 有
// 官方 usage API 的引擎精确查询（tavily / firecrawl / kimi），其余按响应错误
// 码推断（401/403 = key 无效、402/429 = 额度/限流、2xx = 可用）。
const PROBE_TIMEOUT_MS = 6000
const PROBE_UA = 'deepseek-harness/dsh-search-hub-probe'

/** Per-engine probe spec. keyHeader = header carrying the API key (Bearer
 *  prefixed unless keyPrefix set); keyQuery = query param for the key
 *  (gemini). quota = optional official usage/balance endpoint. */
const PROBES = {
  bing: { url: 'https://www.bing.com/search', method: 'GET', params: { q: 'dsh-probe' } },
  ddg: { url: 'https://html.duckduckgo.com/html/', method: 'GET', params: { q: 'dsh-probe' } },
  'ddg-lite': { url: 'https://lite.duckduckgo.com/lite/', method: 'GET', params: { q: 'dsh-probe' } },
  searxng: { url: 'https://searx.be/search', method: 'GET', params: { q: 'dsh-probe', format: 'json' } },
  anysearch: { url: 'https://api.anysearch.com/v1/search', method: 'POST', json: { query: 'dsh-probe', max_results: 1 }, keyHeader: 'Authorization', keyPrefix: 'Bearer ' },
  exa: { url: 'https://api.exa.ai/search', method: 'POST', json: { query: 'dsh-probe', numResults: 1 }, keyHeader: 'x-api-key' },
  tavily: { url: 'https://api.tavily.com/search', method: 'POST', json: { query: 'dsh-probe', max_results: 1 }, keyHeader: 'Authorization', keyPrefix: 'Bearer ', quota: { url: 'https://api.tavily.com/usage', keyHeader: 'Authorization', keyPrefix: 'Bearer ' } },
  keenable: { url: 'https://api.keenable.ai/v1/search', method: 'POST', json: { query: 'dsh-probe', max_results: 1 }, keyHeader: 'Authorization', keyPrefix: 'Bearer ' },
  firecrawl: { url: 'https://api.firecrawl.dev/v2/search', method: 'POST', json: { query: 'dsh-probe', limit: 1 }, keyHeader: 'Authorization', keyPrefix: 'Bearer ', quota: { url: 'https://api.firecrawl.dev/v1/team/credit-usage', keyHeader: 'Authorization', keyPrefix: 'Bearer ' } },
  parallel: { url: 'https://api.parallel.ai/v1/search', method: 'POST', json: { objective: 'dsh-probe', search_queries: ['dsh-probe'], mode: 'fast', advanced_settings: { max_results: 1 } }, keyHeader: 'x-api-key' },
  you: { url: 'https://api.you.com/v1/agents/search', method: 'GET', params: { query: 'dsh-probe', count: '1' }, keyHeader: 'X-API-Key' },
  serpbase: { url: 'https://api.serpbase.dev/google/search', method: 'POST', json: { q: 'dsh-probe', hl: 'zh-cn', gl: 'cn', page: 1 }, keyHeader: 'X-API-Key' },
  serply: { url: 'https://api.serply.io/v1/search', method: 'GET', params: { q: 'dsh-probe', num: '1', hl: 'zh-cn', gl: 'cn' }, keyHeader: 'X-Api-Key' },
  perplexity: { url: 'https://api.perplexity.ai/v1/models', method: 'GET', keyHeader: 'Authorization', keyPrefix: 'Bearer ' },
  'deepseek-official': { url: 'https://api.deepseek.com/v1/models', method: 'GET', keyHeader: 'Authorization', keyPrefix: 'Bearer ' },
  'deepseek-tools': { url: 'https://api.deepseek.com/v1/tools/search', method: 'POST', json: { query: 'dsh-probe' }, keyHeader: 'Authorization', keyPrefix: 'Bearer ' },
  baidu: { url: 'https://qianfan.baidubce.com/v2/ai_search/web_search', method: 'POST', json: { query: 'dsh-probe', count: 1 }, keyHeader: 'Authorization', keyPrefix: 'Bearer ' },
  kimi: { url: 'https://api.moonshot.cn/v1/tools/search', method: 'POST', json: { query: 'dsh-probe', max_results: 1 }, keyHeader: 'Authorization', keyPrefix: 'Bearer ', quota: { url: 'https://api.moonshot.cn/v1/users/me/balance', keyHeader: 'Authorization', keyPrefix: 'Bearer ' } },
  aliyun: { url: 'https://dashscope.aliyuncs.com/api/v1/mcps/EnhancedSearch/mcp', method: 'POST', json: { method: 'initialize', params: {}, id: 1, jsonrpc: '2.0' }, keyHeader: 'Authorization', keyPrefix: 'Bearer ' },
  doubao: { url: 'https://open.feedcoopapi.com/search_api/web_search', method: 'POST', json: { Query: 'dsh-probe', SearchType: 'web', Count: 1, NeedSummary: false, Filter: { NeedUrl: true } }, keyHeader: 'Authorization', keyPrefix: 'Bearer ', extraHeaders: { 'X-Traffic-Tag': 'dsh-search-hub-probe' } },
  tinyfish: { url: 'https://api.search.tinyfish.ai', method: 'GET', params: { query: 'dsh-probe' }, keyHeader: 'X-API-Key' },
  jina: { url: 'https://s.jina.ai/', method: 'GET', params: { q: 'dsh-probe' }, keyHeader: 'Authorization', keyPrefix: 'Bearer ', timeout: 20000 },
  zhihu_global: { url: 'https://developer.zhihu.com/api/mcp/v1', method: 'POST', json: { method: 'initialize', params: {}, id: 1, jsonrpc: '2.0' }, keyHeader: 'Authorization', keyPrefix: 'Bearer ' },
  zhihu_site: { url: 'https://developer.zhihu.com/api/mcp/v1', method: 'POST', json: { method: 'initialize', params: {}, id: 1, jsonrpc: '2.0' }, keyHeader: 'Authorization', keyPrefix: 'Bearer ' },
  openai: { url: 'https://api.openai.com/v1/models', method: 'GET', keyHeader: 'Authorization', keyPrefix: 'Bearer ' },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/models', method: 'GET', keyQuery: 'key' },
  claude: { url: 'https://api.anthropic.com/v1/models', method: 'GET', keyHeader: 'x-api-key', extraHeaders: { 'anthropic-version': '2023-06-01' } },
}

/** Resolve a credential value from the host credentials service. */
async function resolveKey(credentials, ref) {
  try {
    if (!credentials || !ref) return null
    const info = await credentials.resolve(ref)
    return (info && info.value) || null
  } catch {
    return null
  }
}

/** One minimal request against an engine; classify reachability & key validity. */
async function probeOne(id, key) {
  const spec = PROBES[id]
  if (!spec) return { id, status: 'unknown', ms: 0, detail: 'no probe spec' }
  const t0 = Date.now()
  const headers = { accept: 'application/json', 'user-agent': PROBE_UA, ...(spec.extraHeaders || {}) }
  if (spec.keyHeader && key) headers[spec.keyHeader] = (spec.keyPrefix || '') + key
  let url = spec.url
  if (spec.keyQuery && key) url += (url.includes('?') ? '&' : '?') + `${spec.keyQuery}=${encodeURIComponent(key)}`
  const init = {
    method: spec.method || 'GET',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(spec.timeout || PROBE_TIMEOUT_MS),
  }
  if (spec.json) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(spec.json)
  } else if (spec.params) {
    url += (url.includes('?') ? '&' : '?') + new URLSearchParams(spec.params).toString()
  }
  try {
    const res = await fetch(url, init)
    const ms = Date.now() - t0
    if (res.status >= 200 && res.status < 300) return { id, status: 'ok', ms, detail: `HTTP ${res.status}` }
    if (res.status === 401 || res.status === 403) return { id, status: 'key-invalid', ms, detail: `HTTP ${res.status}（key 无效或未授权）` }
    if (res.status === 402 || res.status === 429) return { id, status: 'quota', ms, detail: `HTTP ${res.status}（额度耗尽或限流）` }
    if (res.status >= 500) return { id, status: 'unreachable', ms, detail: `HTTP ${res.status}` }
    return { id, status: 'reachable', ms, detail: `HTTP ${res.status}` }
  } catch (error) {
    const ms = Date.now() - t0
    const msg = String(error?.message || error).slice(0, 120)
    if (/abort|timeout|timed out/i.test(msg)) return { id, status: 'unreachable', ms, detail: '请求超时' }
    return { id, status: 'unreachable', ms, detail: msg }
  }
}

/** Query the official usage/balance endpoint (tavily / firecrawl / kimi). */
async function probeQuota(id, key, spec) {
  const q = spec && spec.quota
  if (!q || !key) return null
  try {
    const res = await fetch(q.url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': PROBE_UA, [q.keyHeader]: (q.keyPrefix || '') + key },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    const data = await res.json().catch(() => null)
    if (!data) return { ok: true, detail: 'usage ok' }
    if (id === 'tavily') {
      // { plan, current_month_usage: { total }, current_month_limit: { total } }
      const plan = data.plan || ''
      const used = data.current_month_usage?.total ?? data.usage?.total
      const limit = data.current_month_limit?.total ?? data.limit?.total
      return { ok: true, text: [plan && `计划:${plan}`, used != null && `已用:${used}`, limit != null && `上限:${limit}`].filter(Boolean).join(' · ') || 'usage ok' }
    }
    if (id === 'firecrawl') {
      // { totalCredits, usedCredits, remainingCredits, ... }
      const remain = data.remainingCredits ?? data.remaining_credits ?? data.totalCredits - data.usedCredits
      const used = data.usedCredits ?? data.used_credits
      const total = data.totalCredits ?? data.total_credits
      return { ok: true, text: [remain != null && `剩余:${remain}`, used != null && `已用:${used}`, total != null && `总量:${total}`].filter(Boolean).join(' · ') || 'usage ok' }
    }
    if (id === 'kimi') {
      // { data: [ { available_balance, voucher_balance, cash_balance, currency } ] }
      const arr = data.data ?? data.available ?? []
      const row = Array.isArray(arr) ? arr[0] : arr
      const avail = row?.available_balance ?? row?.availableBalance
      const cash = row?.cash_balance ?? row?.cashBalance
      return { ok: true, text: [avail != null && `余额:${avail}`, cash != null && `现金:${cash}`, row?.currency && `(${row.currency})`].filter(Boolean).join(' ') || 'balance ok' }
    }
    return { ok: true, text: 'usage ok' }
  } catch (error) {
    return { ok: false, detail: String(error?.message || error).slice(0, 80) }
  }
}

/**
 * Serve the panel API under the host's web server, same origin as the client.
 */
function registerApiRoutes(ctx, scoped) {
  const server = scoped.webServer
  const handler = async (req, res) => {
    let pathname = ''
    try {
      const raw = typeof req.url === 'string' ? req.url : String(req.url ?? '')
      pathname = new URL(raw, 'http://localhost').pathname
    } catch {
      pathname = ''
    }
    const rest = pathname.replace(/^\/api\/dsh-search-hub\/?/, '')
    const method = typeof req.method === 'string' ? req.method : 'GET'
    const body = await readJsonBody(req)

    const send = (status, payload) => {
      res.writeHead?.(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end?.(JSON.stringify(payload))
    }

    try {
      if (rest === 'status' && method === 'GET') {
        return send(200, await statusPayload(ctx))
      }

      if (rest === 'config' && method === 'GET') {
        return send(200, { ok: true, ...readPoolConfig() })
      }

      if (rest === 'config' && method === 'POST') {
        const update = {}
        if (Array.isArray(body.fallbackOrder)) update.fallbackOrder = body.fallbackOrder.filter((x) => ENGINE_BY_ID.has(x))
        if (Array.isArray(body.zhPool)) update.zhPool = body.zhPool.filter((x) => ENGINE_BY_ID.has(x))
        if (Array.isArray(body.enPool)) update.enPool = body.enPool.filter((x) => ENGINE_BY_ID.has(x))
        if (Array.isArray(body.disabledEngines)) update.disabledEngines = body.disabledEngines.filter((x) => ENGINE_BY_ID.has(x))
        // auto/multi are routing MODES (not engines) that free-search natively
        // supports as `provider` (see dsh-free-search SEARCH_MODES).
        const PROVIDER_MODES = new Set(['auto', 'multi'])
        if (typeof body.provider === 'string' && (ENGINE_BY_ID.has(body.provider) || PROVIDER_MODES.has(body.provider))) update.provider = body.provider
        const result = writePoolConfig(update)
        return send(200, { ok: true, ...result, status: await statusPayload(ctx) })
      }

      if (rest === 'key' && method === 'POST') {
        const { key, value } = body ?? {}
        const engine = ENGINE_BY_ID.get(key)
        if (engine === undefined) return send(400, { ok: false, error: { code: 'UNKNOWN_ENGINE', message: `unknown engine "${key}"` } })
        const ref = engine.credRef
        if (ref === null) return send(400, { ok: false, error: { code: 'NO_CREDENTIAL', message: `${engine.name} needs no key` } })
        if (!WRITABLE_REFS.has(ref)) return send(400, { ok: false, error: { code: 'NOT_WRITABLE', message: `${ref} is not writable from this panel` } })
        if (typeof value !== 'string' || value.trim() === '') return send(400, { ok: false, error: { code: 'VALUE_REQUIRED', message: 'value is required' } })
        let credentials = getCredentials(ctx)
        if (!credentials) return send(503, { ok: false, error: { code: 'CREDENTIALS_UNAVAILABLE', message: 'credentials service not available' } })
        await credentials.set(ref, value.trim())
        return send(200, { ok: true, ref, set: true })
      }

      if (rest === 'unkey' && method === 'POST') {
        const { key } = body ?? {}
        const engine = ENGINE_BY_ID.get(key)
        if (engine === undefined) return send(400, { ok: false, error: { code: 'UNKNOWN_ENGINE', message: `unknown engine "${key}"` } })
        const ref = engine.credRef
        if (ref === null) return send(400, { ok: false, error: { code: 'NO_CREDENTIAL', message: `${engine.name} needs no key` } })
        let credentials = getCredentials(ctx)
        if (!credentials) return send(503, { ok: false, error: { code: 'CREDENTIALS_UNAVAILABLE', message: 'credentials service not available' } })
        await credentials.unset(ref)
        return send(200, { ok: true, ref, set: false })
      }

      if (rest === 'keys' && method === 'GET') {
        const credentials = getCredentials(ctx)
        if (!credentials) return send(503, { ok: false, error: { code: 'CREDENTIALS_UNAVAILABLE', message: 'credentials service not available' } })
        const refs = {}
        for (const ref of WRITABLE_REFS) refs[ref] = await refKeySummaries(credentials, ref)
        return send(200, { ok: true, refs })
      }

      if (rest === 'keys' && method === 'POST') {
        const { ref, action, key, index, keys, name } = body ?? {}
        if (!WRITABLE_REFS.has(ref)) return send(400, { ok: false, error: { code: 'NOT_WRITABLE', message: `${ref} is not writable from this panel` } })
        const credentials = getCredentials(ctx)
        if (!credentials) return send(503, { ok: false, error: { code: 'CREDENTIALS_UNAVAILABLE', message: 'credentials service not available' } })
        let current = await readRefKeys(credentials, ref)
        const namesMap = readKeyNames()
        const names = namesMap[ref] ?? []
        if (action === 'add') {
          if (typeof key !== 'string' || key.trim() === '') return send(400, { ok: false, error: { code: 'KEY_REQUIRED', message: 'key is required' } })
          current = [...current, key.trim()]
          names.push('')
        } else if (action === 'remove') {
          if (!Number.isInteger(index) || index < 0 || index >= current.length) return send(400, { ok: false, error: { code: 'BAD_INDEX', message: 'index out of range' } })
          current.splice(index, 1)
          names.splice(index, 1)
        } else if (action === 'replace') {
          if (!Array.isArray(keys)) return send(400, { ok: false, error: { code: 'KEYS_REQUIRED', message: 'keys array is required' } })
          current = keys.map((s) => String(s).trim()).filter(Boolean)
          names.length = 0
          for (let i = 0; i < current.length; i++) names.push('')
        } else if (action === 'rename') {
          if (!Number.isInteger(index) || index < 0 || index >= current.length) return send(400, { ok: false, error: { code: 'BAD_INDEX', message: 'index out of range' } })
          names[index] = typeof name === 'string' ? name.trim().slice(0, 40) : ''
          namesMap[ref] = names
          writeKeyNames(namesMap)
          return send(200, { ok: true, ref, count: current.length, keys: await refKeySummaries(credentials, ref) })
        } else if (action === 'edit') {
          if (!Number.isInteger(index) || index < 0 || index >= current.length) return send(400, { ok: false, error: { code: 'BAD_INDEX', message: 'index out of range' } })
          if (typeof key !== 'string' || key.trim() === '') return send(400, { ok: false, error: { code: 'KEY_REQUIRED', message: 'key is required' } })
          current[index] = key.trim()
        } else {
          return send(400, { ok: false, error: { code: 'BAD_ACTION', message: 'action must be add/remove/edit/replace/rename' } })
        }
        namesMap[ref] = names
        writeKeyNames(namesMap)
        if (current.length === 0) await credentials.unset(ref)
        else await credentials.set(ref, current.join(','))
        return send(200, { ok: true, ref, count: current.length, keys: await refKeySummaries(credentials, ref) })
      }

      if (rest === 'probe' && method === 'GET') {
        const qs = new URL(pathname + (typeof req.url === 'string' ? (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '') : ''), 'http://localhost').searchParams
        const wanted = qs.get('ids') === 'all'
          ? ENGINES.map((e) => e.id)
          : (qs.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
        if (wanted.length === 0) return send(400, { ok: false, error: { code: 'NO_IDS', message: 'ids required (all or comma list)' } })
        const credentials = getCredentials(ctx)
        const probes = {}
        const rank = { ok: 5, reachable: 4, quota: 3, 'key-invalid': 2, unreachable: 1 }
        await Promise.all(wanted.map(async (id) => {
          const eng = ENGINE_BY_ID.get(id)
          if (!eng) { probes[id] = { id, status: 'unknown', ms: 0, detail: 'unknown engine' }; return }
          if (eng.credRef !== null) {
            const keyList = await readRefKeys(credentials, eng.credRef)
            if (keyList.length === 0) { probes[id] = { id, status: 'no-key', ms: 0, detail: `${eng.credRef} 未配置` }; return }
            const perKey = []
            let best = null
            for (const k of keyList) {
              const p = await probeOne(id, k)
              if (p.status === 'ok') {
                const quota = await probeQuota(id, k, PROBES[id])
                if (quota) p.quota = quota
              }
              perKey.push({ tail: k.length > 4 ? k.slice(-4) : k, status: p.status, ms: p.ms, detail: p.detail, quota: p.quota ?? null })
              if (!best || (rank[p.status] ?? 0) > (rank[best.status] ?? 0)) best = p
            }
            probes[id] = {
              id,
              status: best.status,
              ms: best.ms,
              detail: `${perKey.length} 个 key · ${perKey.filter((x) => x.status === 'ok').length} 可用`,
              keys: perKey,
              ...(best.quota ? { quota: best.quota } : {}),
            }
            return
          }
          probes[id] = await probeOne(id, null)
        }))
        return send(200, { ok: true, probes })
      }

      if (rest === 'open-url' && method === 'POST') {
        const { url: target } = body ?? {}
        if (typeof target !== 'string' || !/^https?:\/\//i.test(target) || target.length > 300) {
          return send(400, { ok: false, error: { code: 'BAD_URL', message: 'url must be an http(s) link' } })
        }
        try {
          // Open in the system default browser (Windows).
          exec(`start "" "${target.replace(/"/g, '""')}"`, { windowsHide: true }, (err) => {
            if (err) console.error('[dsh-search-hub] open-url exec failed:', err.message)
          })
          return send(200, { ok: true, url: target })
        } catch (error) {
          return send(500, { ok: false, error: { code: 'OPEN_FAILED', message: String(error?.message ?? error) } })
        }
      }

      if (rest === 'icon' && method === 'GET') {
        let id = ''
        try {
          id = String(new URL(String(req.url ?? ''), 'http://localhost').searchParams.get('id') ?? '')
        } catch {
          id = ''
        }
        const domain = ICON_DOMAINS[id]
        if (!domain) return send(404, { ok: false, error: { code: 'NO_ICON', message: `no icon for ${id}` } })
        const cached = iconCachePath(id)
        if (fs.existsSync(cached)) {
          res.writeHead?.(200, { 'content-type': 'image/x-icon', 'cache-control': 'public, max-age=86400' })
          res.end?.(fs.readFileSync(cached))
          return
        }
        try {
          const buf = await fetchIcon(domain)
          if (buf) {
            try {
              fs.mkdirSync(iconsDir(), { recursive: true })
              fs.writeFileSync(cached, buf)
            } catch {
              // cache is best-effort
            }
            res.writeHead?.(200, { 'content-type': 'image/x-icon', 'cache-control': 'public, max-age=86400' })
            res.end?.(buf)
            return
          }
        } catch {
          // fall through to 404
        }
        return send(404, { ok: false, error: { code: 'ICON_FETCH_FAILED', message: `failed to fetch icon for ${id}` } })
      }

      return send(404, { ok: false, error: { code: 'NOT_FOUND', message: `unknown route: /${rest}` } })
    } catch (error) {
      return send(500, { ok: false, error: { code: 'INTERNAL', message: String(error?.message ?? error) } })
    }
  }

  scoped.effect(
    () => server.register({ kind: 'prefix', path: '/api/dsh-search-hub', handler }),
    'dsh-search-hub: api routes',
  )
}

/** @type {import('@deepseek-ai/cordis').Plugin} */
export function apply(ctx, config) {
  try {
    const dir = dataDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'apply-probe.txt'),
      `applied at ${new Date().toISOString()}\n`,
      'utf8',
    )
  } catch {
    /* ignore */
  }

  ctx.inject?.(['webServer'], (scoped) => {
    try {
      registerApiRoutes(ctx, scoped)
    } catch (error) {
      try {
        ctx.logger?.warn?.('dsh-search-hub: webServer routes failed: ' + String(error?.message ?? error))
      } catch {
        /* ignore */
      }
    }
  })
}

export { ENGINES, WRITABLE_REFS, DATA_DIR_NAME as dataDirName }
export default apply
