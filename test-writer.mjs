// Test harness for dsh-search-hub's pool-config writer.
// Copies the live profile patch into a sandbox and asserts that writing one
// key never disturbs the others.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const LIVE = process.env.DSH_PROFILE || path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')
const SANDBOX = path.join(os.tmpdir(), 'shub-writer-test')
const FILE = path.join(SANDBOX, 'cordis.patch.yml')

// ── exact copy of writePoolConfig from index.js (file passed in) ──────────
function writePoolConfig(file, update) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  const fmtList = (key, values) => `    ${key}: [${values.join(', ')}]`
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

    const mScalar = line.match(/^    (provider|fallbackOrder|zhPool|enPool|disabledEngines):(.*)$/)
    if (mScalar !== null) {
      const k = mScalar[1]
      const replacing = update[k] !== undefined
      skipBlock = replacing && mScalar[2].trim() === ''
      if (replacing) {
        out.push(k === 'provider' ? `    provider: ${update.provider}` : fmtList(k, update[k]))
      } else {
        out.push(line)
      }
      continue
    }

    if (skipBlock && /^      - /.test(line)) continue
    if (skipBlock && !/^      - /.test(line) && line.trim() !== '') skipBlock = false

    out.push(line)
  }

  if (!sawEntry) throw new Error('no `- id: web-search-free` entry')
  fs.writeFileSync(file, out.join('\n'), 'utf8')
  return { ok: true }
}

// ── minimal YAML reader for the two keys we care about ────────────────────
function readEntry(file) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  const res = { provider: null, fallbackOrder: [], zhPool: [], enPool: [], disabledEngines: [] }
  let inEntry = false
  let listKey = null
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ')
    if (/^- id: web-search-free$/.test(line.trim())) { inEntry = true; listKey = null; continue }
    if (/^- /.test(line) && !/^- id: web-search-free$/.test(line.trim())) { inEntry = false; listKey = null; continue }
    if (!inEntry) continue
    const inline = line.match(/^    ([A-Za-z]+): \[([^\]]*)\]$/)
    if (inline !== null) {
      const k = inline[1]
      const vals = inline[2].split(',').map((s) => s.trim()).filter(Boolean)
      if (k in res) res[k] = vals
      listKey = null
      continue
    }
    const scalar = line.match(/^    ([A-Za-z]+): (.+)$/)
    if (scalar !== null) {
      const k = scalar[1]
      if (k === 'provider') res.provider = scalar[2].replace(/^['"]|['"]$/g, '').trim()
      listKey = null
      continue
    }
    const head = line.match(/^    ([A-Za-z]+):$/)
    if (head !== null) { listKey = head[1]; continue }
    const item = line.match(/^      - ([^#].*)$/)
    if (item !== null && listKey !== null && listKey in res) {
      res[listKey].push(item[1].trim().replace(/^['"]|['"]$/g, ''))
    }
  }
  return res
}

// ── run cases ──────────────────────────────────────────────────────────────
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(SANDBOX, { recursive: true })

function reset() { fs.copyFileSync(LIVE, FILE) }

const baseline = (() => { reset(); return readEntry(FILE) })()
console.log('BASELINE:', JSON.stringify(baseline))

let failures = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) {
    console.log('   expected:', JSON.stringify(expected))
    console.log('   actual  :', JSON.stringify(actual))
    failures++
  }
}

// 1. only zhPool -> fallbackOrder must be untouched
reset()
writePoolConfig(FILE, { zhPool: ['doubao', 'baidu', 'bing', 'anysearch'] })
const a1 = readEntry(FILE)
check('1a zhPool written', a1.zhPool, ['doubao', 'baidu', 'bing', 'anysearch'])
check('1b fallbackOrder preserved', a1.fallbackOrder, baseline.fallbackOrder)
check('1c provider preserved', a1.provider, baseline.provider)
check('1d enPool preserved', a1.enPool, baseline.enPool)

// 2. replace fallbackOrder (block -> inline)
reset()
writePoolConfig(FILE, { fallbackOrder: ['doubao', 'baidu', 'bing', 'exa'] })
const a2 = readEntry(FILE)
check('2a fallbackOrder replaced', a2.fallbackOrder, ['doubao', 'baidu', 'bing', 'exa'])
check('2b zhPool preserved', a2.zhPool, baseline.zhPool)

// 3. provider only
reset()
writePoolConfig(FILE, { provider: 'auto' })
const a3 = readEntry(FILE)
check('3a provider written', a3.provider, 'auto')
check('3b fallbackOrder preserved', a3.fallbackOrder, baseline.fallbackOrder)

// 4. everything at once
reset()
writePoolConfig(FILE, {
  provider: 'multi',
  fallbackOrder: ['bing', 'exa'],
  zhPool: ['doubao', 'baidu'],
  enPool: ['exa', 'tavily'],
})
const a4 = readEntry(FILE)
check('4a provider', a4.provider, 'multi')
check('4b fallbackOrder', a4.fallbackOrder, ['bing', 'exa'])
check('4c zhPool', a4.zhPool, ['doubao', 'baidu'])
check('4d enPool', a4.enPool, ['exa', 'tavily'])

// 5. idempotent: writing the same value twice changes nothing
reset()
writePoolConfig(FILE, { zhPool: baseline.zhPool })
const before = fs.readFileSync(FILE, 'utf8')
writePoolConfig(FILE, { zhPool: baseline.zhPool })
const after = fs.readFileSync(FILE, 'utf8')
check('5 idempotent', before === after, true)

// 6. entry count and overall structure survive
const origIds = fs.readFileSync(LIVE, 'utf8').split(/\r?\n/).filter((l) => /^- id:/.test(l)).length
const newIds = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter((l) => /^- id:/.test(l)).length
check('6 top-level entry count preserved', newIds, origIds)

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
