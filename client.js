/**
 * dsh-search-hub — browser half.
 *
 * Registers TWO surfaces, mirroring how dshmarket does it:
 *
 *   1. `sidebar.panellist` — an icon row in the left sidebar.
 *   2. `main`               — the page that row opens (key = panel id).
 *   3. `settings.section`   — the same content as a Settings section, so it is
 *                             reachable from either place.
 *
 * All data comes from the host half's same-origin `/api/dsh-search-hub/*`.
 *
 * Hand-written ModuleLoader bundle: no build step, no dependency beyond the
 * `react` the shell already provides.
 *
 * NOTE: every const lives INSIDE the factory. DSH's web boot may execute a
 * plugin's client.js more than once in the same global scope; a top-level
 * `const` then throws "Identifier has already been declared", which is a
 * parse-time SyntaxError that blanks every plugin-backed page.
 */

window.__ModuleLoader__.load({
  id: 'dsh-search-hub',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect, useCallback, useRef, useMemo } = React

    const PANEL_ID = 'dsh-search-hub'
    const API = '/api/dsh-search-hub'
    const NS = 'searchHub'

    // ── styles ────────────────────────────────────────────────────────────
    const HUB_STYLES = `
.sh-hub {
  --sh-border: var(--dsw-alias-border-l1, #e6e7ea);
  --sh-border-strong: var(--dsw-alias-border-l2, #d6d8dd);
  --sh-text: var(--dsw-alias-label-primary, #1d2129);
  --sh-text-2: var(--dsw-alias-label-secondary, #4e5969);
  --sh-text-3: var(--dsw-alias-label-tertiary, #86909c);
  --sh-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --sh-bg-2: var(--dsw-alias-bg-layer-2, #f6f7f9);
  --sh-brand: var(--dsw-alias-brand-primary, #165dff);
  --sh-success: var(--dsw-alias-state-success-primary, #00b42a);
  --sh-warn: var(--dsw-alias-state-warning-primary, #ff7d00);
  --sh-danger: var(--dsw-alias-state-error-primary, #f53f3f);
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: max(520px, calc(100vh - 150px));
  min-height: 0;
  padding: 18px 20px 24px;
  overflow-y: auto;
  color: var(--sh-text);
  font: 13px/1.55 var(--dsw-font-family, -apple-system, "Segoe UI", system-ui, sans-serif);
  background: var(--sh-bg);
}
/* CRITICAL: flex column + fixed height shrinks children by default
   (flex-shrink:1), crushing the engine list, fallback chips and the
   default-engine buttons into invisibility with a dead scrollbar
   (scrollHeight == clientHeight). Children must not shrink; overflow
   must scroll. */
.sh-hub > * { flex-shrink: 0; }
.sh-hub *, .sh-hub *::before, .sh-hub *::after { box-sizing: border-box; }

.sh-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.sh-title { font-size: 17px; font-weight: 600; margin: 0; }
.sh-sub { font-size: 12.5px; color: var(--sh-text-3); margin: 4px 0 0; }
.sh-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.sh-btn {
  border: 1px solid var(--sh-border-strong); border-radius: 8px;
  padding: 5px 13px; background: var(--sh-bg); color: var(--sh-text);
  font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
  white-space: nowrap; transition: border-color .15s, background .15s;
}
.sh-btn:hover:not(:disabled) { border-color: var(--sh-text-3); background: var(--sh-bg-2); }
.sh-btn:disabled { opacity: .55; cursor: not-allowed; }
.sh-btn-primary { border-color: transparent; color: #fff; background: var(--sh-brand); }
.sh-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--sh-brand) 88%, #000); }
.sh-btn-danger { border-color: var(--sh-danger); color: var(--sh-danger); }

.sh-banner {
  border: 1px solid var(--sh-border); border-radius: 10px;
  padding: 11px 15px; background: var(--sh-bg-2);
  font-size: 12.5px; color: var(--sh-text-2); line-height: 1.65;
}
.sh-banner.is-warn { border-color: var(--sh-warn); background: color-mix(in srgb, var(--sh-warn) 8%, var(--sh-bg)); }
.sh-banner.is-bad { border-color: var(--sh-danger); background: color-mix(in srgb, var(--sh-danger) 8%, var(--sh-bg)); }
.sh-banner code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px; background: var(--sh-bg); padding: 1px 5px; border-radius: 4px;
  border: 1px solid var(--sh-border);
}

.sh-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; }
.sh-kpi { border: 1px solid var(--sh-border); border-radius: 10px; padding: 11px 14px; background: var(--sh-bg); }
.sh-kpi-label { font-size: 11.5px; color: var(--sh-text-3); }
.sh-kpi-value { font-size: 21px; font-weight: 600; line-height: 1.3; margin-top: 2px; }

.sh-group { border: 1px solid var(--sh-border); border-radius: 11px; overflow: hidden; background: var(--sh-bg); }
.sh-group-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 15px; background: var(--sh-bg-2); border-bottom: 1px solid var(--sh-border);
}
.sh-group-title { font-size: 13px; font-weight: 600; }
.sh-group-count { font-size: 11.5px; color: var(--sh-text-3); }

.sh-row {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1.5fr) auto;
  align-items: center; gap: 12px;
  padding: 10px 15px; border-top: 1px solid var(--sh-border);
}
.sh-row:first-of-type { border-top: none; }
.sh-row:hover { background: var(--sh-bg-2); }
.sh-row-main { min-width: 0; }
.sh-row-name { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 500; }
.sh-engine-icon { position: relative; width: 18px; height: 18px; border-radius: 4px; overflow: hidden; flex-shrink: 0; background: color-mix(in srgb, var(--sh-brand) 14%, transparent); display: inline-flex; align-items: center; justify-content: center; }
.sh-engine-icon-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.sh-engine-icon-letter { font-size: 10px; font-weight: 600; color: var(--sh-brand); line-height: 1; }
.sh-engine-link { color: var(--sh-brand); text-decoration: none; cursor: pointer; }
.sh-engine-link:hover { text-decoration: underline; }
.sh-row-note { font-size: 11.5px; color: var(--sh-text-3); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sh-row-probe { font-size: 11px; margin-top: 3px; line-height: 1.35; }
.sh-row-probe.is-ok { color: var(--sh-success); }
.sh-row-probe.is-no-key, .sh-row-probe.is-unknown { color: var(--sh-text-3); }
.sh-row-probe.is-key-invalid, .sh-row-probe.is-unreachable { color: var(--sh-danger); }
.sh-row-probe.is-quota, .sh-row-probe.is-reachable { color: var(--sh-warn); }
.sh-key-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.sh-key-item { display: flex; align-items: center; gap: 8px; font-size: 11.5px; flex-wrap: wrap; }
.sh-key-mask { font-family: ui-monospace, Consolas, monospace; color: var(--sh-text-2); letter-spacing: 1px; }
.sh-key-name { cursor: pointer; border-bottom: 1px dashed color-mix(in srgb, var(--sh-text-3) 45%, transparent); padding: 0 2px; }
.sh-key-name.has-name { color: var(--sh-text-1); font-weight: 500; }
.sh-key-actions { display: inline-flex; gap: 4px; }
.sh-btn-xs { padding: 1px 8px; font-size: 11px; min-height: 0; }
.sh-input-xs { padding: 2px 6px; font-size: 11.5px; width: 150px; }
.sh-row-key { min-width: 0; display: flex; align-items: center; gap: 6px; }
.sh-row-actions { display: flex; gap: 6px; justify-content: flex-end; }

.sh-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.sh-dot.is-ready { background: var(--sh-success); }
.sh-dot.is-keyless { background: var(--sh-brand); }
.sh-dot.is-needs-key { background: var(--sh-warn); }
.sh-dot.is-disabled { background: var(--sh-text-3); opacity: .5; }

.sh-tag {
  font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 4px;
  letter-spacing: .2px; text-transform: uppercase; flex: none;
}
.sh-tag.is-free { background: color-mix(in srgb, var(--sh-brand) 12%, transparent); color: var(--sh-brand); }
.sh-tag.is-key { background: color-mix(in srgb, var(--sh-warn) 14%, transparent); color: var(--sh-warn); }
.sh-tag.is-model { background: color-mix(in srgb, var(--sh-danger) 12%, transparent); color: var(--sh-danger); }

.sh-input {
  width: 100%; min-width: 0;
  border: 1px solid var(--sh-border-strong); border-radius: 7px;
  padding: 4px 9px; font: inherit; font-size: 12px;
  background: var(--sh-bg); color: var(--sh-text);
}
.sh-input:focus { outline: none; border-color: var(--sh-brand); }
.sh-input::placeholder { color: var(--sh-text-3); }

.sh-empty { padding: 26px 15px; text-align: center; font-size: 12.5px; color: var(--sh-text-3); }
.sh-hint { font-size: 11.5px; color: var(--sh-text-3); }
.sh-msg { font-size: 12px; padding: 7px 12px; border-radius: 8px; }
.sh-msg.is-ok { background: color-mix(in srgb, var(--sh-success) 12%, transparent); color: var(--sh-success); }
.sh-msg.is-err { background: color-mix(in srgb, var(--sh-danger) 12%, transparent); color: var(--sh-danger); }
`

    function injectStyles() {
      const id = 'dsh-search-hub-styles'
      if (typeof document === 'undefined') return
      if (typeof document.head === 'undefined' || document.head === null) return
      if (document.getElementById(id) !== null) return
      const el = document.createElement('style')
      el.id = id
      el.textContent = HUB_STYLES
      document.head.appendChild(el)
    }

    // ── api ───────────────────────────────────────────────────────────────
    async function apiFetch(pathname, init) {
      const res = await fetch(API + pathname, {
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        ...init,
      })
      const text = await res.text()
      let data
      try {
        data = text === '' ? {} : JSON.parse(text)
      } catch {
        throw new Error(`bad JSON from ${pathname}: ${text.slice(0, 120)}`)
      }
      if (!res.ok) throw new Error((data && data.error && data.error.message) || `HTTP ${res.status}`)
      return data
    }

    // ── engine row ────────────────────────────────────────────────────────
    function probeText(p) {
      if (!p) return ''
      if (Array.isArray(p.keys)) {
        const ok = p.keys.filter((k) => k.status === 'ok').length
        const bad = p.keys.filter((k) => k.status === 'key-invalid' || k.status === 'unreachable').length
        const quotaTxt = p.quota && p.quota.text ? ` · ${p.quota.text}` : ''
        if (p.status === 'ok') return `可用 ${p.ms}ms · ${ok}/${p.keys.length} 个 key 可用${quotaTxt}`
        return `${p.detail ?? '探测异常'}${quotaTxt}`
      }
      return {
        ok: `可用 ${p.ms}ms${p.quota && p.quota.text ? ' · ' + p.quota.text : ''}`,
        'no-key': '未配置 key',
        'key-invalid': `key 无效（${p.detail}）`,
        quota: `额度/限流（${p.detail}）`,
        unreachable: `不可达（${p.detail}）`,
        reachable: `服务可达（${p.detail}）`,
        unknown: '未知',
      }[p.status] ?? p.status
    }

    function EngineRow({ engine, busy, onSave, onClear, probe, keys, onAddKey, onRemoveKey, onClearKeys, onRenameKey, onEditKey }) {
      const [draft, setDraft] = useState('')
      const [editing, setEditing] = useState(false)
      const [keysOpen, setKeysOpen] = useState(false)
      const [renaming, setRenaming] = useState(null)
      const [editingKey, setEditingKey] = useState(null)
      const canKey = engine.credRef !== null
      const isBusy = busy === engine.id
      const keyList = Array.isArray(keys) ? keys : []

      const stateLabel = {
        ready: keyList.length > 1 ? `${keyList.length} 个 key` : '已配置',
        keyless: '免 key',
        'needs-key': '缺 key',
        disabled: '已禁用',
      }[engine.state] ?? engine.state

      const kindLabel = { free: 'FREE', key: 'KEY', model: 'MODEL' }[engine.kind] ?? engine.kind

      return h('div', { className: 'sh-row' },
        h('div', { className: 'sh-row-main' },
          h('div', { className: 'sh-row-name' },
            h('span', { className: `sh-dot is-${engine.state}` }),
            h('span', { className: 'sh-engine-icon' },
              h('img', {
                className: 'sh-engine-icon-img',
                src: `/api/dsh-search-hub/icon?id=${encodeURIComponent(engine.id)}`,
                alt: '',
                loading: 'lazy',
                onError: (e) => { e.currentTarget.style.visibility = 'hidden' },
              }),
              h('span', { className: 'sh-engine-icon-letter' }, (engine.name || '?').slice(0, 1).toUpperCase()),
            ),
            engine.url
              ? h('a', {
                  className: 'sh-engine-link',
                  href: engine.url,
                  target: '_blank',
                  rel: 'noreferrer',
                  title: `打开官网：${engine.url}`,
                  onClick: (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void fetch('/api/dsh-search-hub/open-url', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ url: engine.url }),
                    }).catch(() => {})
                  },
                }, engine.name)
              : h('span', null, engine.name),
            h('span', { className: `sh-tag is-${engine.kind}` }, kindLabel),
            engine.inFallback ? h('span', { className: 'sh-hint' }, '· 回退链') : null,
          ),
          h('div', { className: 'sh-row-note', title: engine.note }, engine.note),
          probe
            ? h('div', { className: `sh-row-probe is-${probe.status}` }, probeText(probe))
            : null,
        ),

        canKey
          ? h('div', { className: 'sh-row-key' },
              editing
                ? h('input', {
                    className: 'sh-input',
                    type: 'password',
                    autoFocus: true,
                    placeholder: `粘贴 ${engine.credRef}（多个 key 用逗号/换行分隔）`,
                    value: draft,
                    onChange: (e) => setDraft(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === 'Enter' && draft.trim() !== '') {
                        onAddKey(engine.credRef, draft.trim())
                        setDraft('')
                        setEditing(false)
                      }
                      if (e.key === 'Escape') { setDraft(''); setEditing(false) }
                    },
                  })
                : h('span', { className: 'sh-hint' },
                    keyList.length === 0
                      ? `${engine.credRef} · 未设置`
                      : `${engine.credRef} · ${keyList.length} 个 key`,
                  ),
              keysOpen && keyList.length > 0
                ? h('div', { className: 'sh-key-list' },
                    keyList.map((k) =>
                      h('div', { key: k.index, className: 'sh-key-item' },
                        editingKey && editingKey.index === k.index
                          ? [
                              h('input', {
                                key: 'in', className: 'sh-input sh-input-xs', type: 'password', autoFocus: true,
                                placeholder: '输入新 key 值替换',
                                value: editingKey.draft,
                                onChange: (e) => setEditingKey({ index: k.index, draft: e.target.value }),
                                onKeyDown: (e) => {
                                  if (e.key === 'Enter' && editingKey.draft.trim() !== '') {
                                    onEditKey(engine.credRef, k.index, editingKey.draft.trim())
                                    setEditingKey(null)
                                  }
                                  if (e.key === 'Escape') setEditingKey(null)
                                },
                              }),
                              h('button', {
                                key: 'save', className: 'sh-btn sh-btn-primary sh-btn-xs', type: 'button', disabled: isBusy || editingKey.draft.trim() === '',
                                onClick: () => { onEditKey(engine.credRef, k.index, editingKey.draft.trim()); setEditingKey(null) },
                              }, isBusy ? '保存中…' : '保存'),
                              h('button', {
                                key: 'cancel', className: 'sh-btn sh-btn-xs', type: 'button',
                                onClick: () => setEditingKey(null),
                              }, '取消'),
                            ]
                          : renaming && renaming.index === k.index
                            ? [
                                h('input', {
                                  key: 'in', className: 'sh-input sh-input-xs', type: 'text', autoFocus: true,
                                  placeholder: '账户名称（如：主账号）',
                                  value: renaming.name,
                                  onChange: (e) => setRenaming({ index: k.index, name: e.target.value }),
                                  onKeyDown: (e) => {
                                    if (e.key === 'Enter') { onRenameKey(engine.credRef, k.index, renaming.name); setRenaming(null) }
                                    if (e.key === 'Escape') setRenaming(null)
                                  },
                                }),
                                h('button', {
                                  key: 'save', className: 'sh-btn sh-btn-primary sh-btn-xs', type: 'button', disabled: isBusy,
                                  onClick: () => { onRenameKey(engine.credRef, k.index, renaming.name); setRenaming(null) },
                                }, '保存'),
                                h('button', {
                                  key: 'cancel', className: 'sh-btn sh-btn-xs', type: 'button',
                                  onClick: () => setRenaming(null),
                                }, '取消'),
                              ]
                            : [
                                h('span', {
                                  key: 'name', className: `sh-key-name${k.name ? ' has-name' : ''}`, title: '点击改名',
                                  onClick: () => setRenaming({ index: k.index, name: k.name || '' }),
                                }, k.name || `账户 ${k.index + 1}`),
                                h('span', { key: 'mask', className: 'sh-key-mask' }, `•••• •••• ${k.tail}`),
                                h('span', { key: 'actions', className: 'sh-key-actions' },
                                  h('button', {
                                    className: 'sh-btn sh-btn-xs', type: 'button', disabled: isBusy,
                                    onClick: () => { setRenaming({ index: k.index, name: k.name || '' }) },
                                  }, '改名'),
                                  h('button', {
                                    className: 'sh-btn sh-btn-xs', type: 'button', disabled: isBusy,
                                    onClick: () => { setEditingKey({ index: k.index, draft: '' }); setRenaming(null) },
                                  }, '编辑'),
                                  h('button', {
                                    className: 'sh-btn sh-btn-danger sh-btn-xs', type: 'button', disabled: isBusy,
                                    onClick: () => { onRemoveKey(engine.credRef, k.index); setKeysOpen(false) },
                                  }, '删除'),
                                ),
                              ],
                      ),
                    ),
                  )
                : null,
            )
          : h('div', { className: 'sh-row-key' }, h('span', { className: 'sh-hint' }, stateLabel)),

        h('div', { className: 'sh-row-actions' },
          canKey
            ? (editing
                ? [
                    h('button', {
                      key: 'save', className: 'sh-btn sh-btn-primary', type: 'button',
                      disabled: isBusy || draft.trim() === '',
                      onClick: () => { onAddKey(engine.credRef, draft.trim()); setDraft(''); setEditing(false) },
                    }, isBusy ? '保存中…' : '保存'),
                    h('button', {
                      key: 'cancel', className: 'sh-btn', type: 'button',
                      onClick: () => { setDraft(''); setEditing(false) },
                    }, '取消'),
                  ]
                : [
                    h('button', {
                      key: 'edit', className: 'sh-btn', type: 'button', disabled: isBusy,
                      onClick: () => { setEditing(true); setKeysOpen(false) },
                    }, keyList.length === 0 ? '填写' : '添加 key'),
                    keyList.length > 0
                      ? h('button', {
                          key: 'manage', className: 'sh-btn', type: 'button', disabled: isBusy,
                          onClick: () => { setKeysOpen(!keysOpen); setEditing(false) },
                        }, keysOpen ? '收起' : `管理 ${keyList.length} 个 key`)
                      : null,
                    keyList.length > 0
                      ? h('button', {
                          key: 'clear', className: 'sh-btn sh-btn-danger', type: 'button', disabled: isBusy,
                          onClick: () => { onClearKeys(engine.credRef); setKeysOpen(false) },
                        }, '清除全部')
                      : null,
                  ])
            : h('span', { className: 'sh-hint' }, stateLabel),
        ),
      )
    }

    // ── main page ─────────────────────────────────────────────────────────
    function SearchHubPage(props) {
      const [status, setStatus] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [msg, setMsg] = useState(null)
      const [filter, setFilter] = useState('all')
      const [probes, setProbes] = useState(null)
      const [probing, setProbing] = useState(false)

      const load = useCallback(async () => {
        try {
          const data = await apiFetch('/status')
          setStatus(data)
          setError('')
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        }
      }, [])

      useEffect(() => {
        void load()
        const timer = setInterval(() => { void load() }, 20000)
        return () => clearInterval(timer)
      }, [load])

      const engineRefOf = useCallback((engineId) => {
        const e = status && status.engines ? status.engines.find((x) => x.id === engineId) : null
        return e && e.credRef
      }, [status])

      const saveKey = useCallback(async (engineId, value) => {
        const ref = engineRefOf(engineId)
        if (!ref) return
        setBusy(engineId)
        setMsg(null)
        try {
          await apiFetch('/keys', { method: 'POST', body: JSON.stringify({ ref, action: 'add', key: value }) })
          setMsg({ kind: 'ok', text: '已保存，下一次搜索即生效（无需重启）' })
          await load()
        } catch (e) {
          setMsg({ kind: 'err', text: String(e && e.message ? e.message : e) })
        } finally {
          setBusy('')
        }
      }, [engineRefOf, load])

      const clearKey = useCallback(async (engineId) => {
        const ref = engineRefOf(engineId)
        if (!ref) return
        setBusy(engineId)
        setMsg(null)
        try {
          await apiFetch('/keys', { method: 'POST', body: JSON.stringify({ ref, action: 'replace', keys: [] }) })
          setMsg({ kind: 'ok', text: '已清除该引擎的全部 key' })
          await load()
        } catch (e) {
          setMsg({ kind: 'err', text: String(e && e.message ? e.message : e) })
        } finally {
          setBusy('')
        }
      }, [engineRefOf, load])

      const addKey = useCallback(async (ref, key) => {
        if (!ref || !key || !key.trim()) return
        setBusy(ref)
        setMsg(null)
        try {
          await apiFetch('/keys', { method: 'POST', body: JSON.stringify({ ref, action: 'add', key }) })
          setMsg({ kind: 'ok', text: 'key 已添加' })
          await load()
        } catch (e) {
          setMsg({ kind: 'err', text: String(e && e.message ? e.message : e) })
        } finally {
          setBusy('')
        }
      }, [load])

      const removeKey = useCallback(async (ref, index) => {
        if (!ref) return
        setBusy(ref)
        setMsg(null)
        try {
          await apiFetch('/keys', { method: 'POST', body: JSON.stringify({ ref, action: 'remove', index }) })
          setMsg({ kind: 'ok', text: 'key 已删除' })
          await load()
        } catch (e) {
          setMsg({ kind: 'err', text: String(e && e.message ? e.message : e) })
        } finally {
          setBusy('')
        }
      }, [load])

      const clearKeys = useCallback(async (ref) => {
        if (!ref) return
        setBusy(ref)
        setMsg(null)
        try {
          await apiFetch('/keys', { method: 'POST', body: JSON.stringify({ ref, action: 'replace', keys: [] }) })
          setMsg({ kind: 'ok', text: '已清除该引擎的全部 key' })
          await load()
        } catch (e) {
          setMsg({ kind: 'err', text: String(e && e.message ? e.message : e) })
        } finally {
          setBusy('')
        }
      }, [load])

      const editKey = useCallback(async (ref, index, key) => {
        if (!ref || !Number.isInteger(index) || !key || !key.trim()) return
        setBusy(ref)
        setMsg(null)
        try {
          await apiFetch('/keys', { method: 'POST', body: JSON.stringify({ ref, action: 'edit', index, key: key.trim() }) })
          setMsg({ kind: 'ok', text: 'key 已更新' })
          await load()
        } catch (e) {
          setMsg({ kind: 'err', text: String(e && e.message ? e.message : e) })
        } finally {
          setBusy('')
        }
      }, [load])

      const renameKey = useCallback(async (ref, index, name) => {
        if (!ref || !Number.isInteger(index)) return
        setBusy(ref)
        setMsg(null)
        try {
          await apiFetch('/keys', { method: 'POST', body: JSON.stringify({ ref, action: 'rename', index, name: name ?? '' }) })
          setMsg({ kind: 'ok', text: '账户名称已保存' })
          await load()
        } catch (e) {
          setMsg({ kind: 'err', text: String(e && e.message ? e.message : e) })
        } finally {
          setBusy('')
        }
      }, [load])

      const setDefault = useCallback(async (engineId) => {
        setBusy('provider')
        setMsg(null)
        try {
          await apiFetch('/config', { method: 'POST', body: JSON.stringify({ provider: engineId }) })
          setMsg({ kind: 'ok', text: `默认引擎已切换为 ${engineId}` })
          await load()
        } catch (e) {
          setMsg({ kind: 'err', text: String(e && e.message ? e.message : e) })
        } finally {
          setBusy('')
        }
      }, [load])

      const runProbe = useCallback(async () => {
        setProbing(true)
        setMsg(null)
        try {
          const data = await apiFetch('/probe?ids=all')
          setProbes(data.probes || {})
          const list = Object.values(data.probes || {})
          const bad = list.filter((p) => p.status === 'unreachable' || p.status === 'key-invalid' || p.status === 'quota').length
          const noKey = list.filter((p) => p.status === 'no-key').length
          setMsg({ kind: bad === 0 ? 'ok' : 'err', text: `探测完成：${list.length} 个引擎 · ${list.length - bad - noKey} 可用 · ${bad} 异常 · ${noKey} 未配 key` })
        } catch (e) {
          setMsg({ kind: 'err', text: String(e && e.message ? e.message : e) })
        } finally {
          setProbing(false)
        }
      }, [])

      if (status === null) {
        return h('div', { className: 'sh-hub' },
          h('div', { className: 'sh-head' },
            h('div', null,
              h('h2', { className: 'sh-title' }, '搜索渠道'),
              h('p', { className: 'sh-sub' }, '正在读取引擎状态…'),
            ),
          ),
          error !== '' ? h('div', { className: 'sh-banner is-bad' }, error) : null,
        )
      }

      const engines = status.engines
      const shown = engines.filter((e) => {
        if (filter === 'all') return true
        if (filter === 'ready') return e.state === 'ready' || e.state === 'keyless'
        if (filter === 'needs-key') return e.state === 'needs-key'
        return true
      })

      const providerOk = status.provider.matchesOwner

      return h('div', { className: 'sh-hub' },
        // header
        h('div', { className: 'sh-head' },
          h('div', null,
            h('h2', { className: 'sh-title' }, '搜索渠道'),
            h('p', { className: 'sh-sub' },
              `共 ${status.summary.total} 个引擎 · ${status.summary.ready} 个可用 · ${status.summary.needsKey} 个缺 key`,
            ),
          ),
          h('div', { className: 'sh-actions' },
            h('button', {
              className: 'sh-btn', type: 'button', disabled: busy !== '' || probing,
              onClick: () => { void runProbe() },
            }, probing ? '探测中…' : '探测全部'),
            h('button', {
              className: 'sh-btn', type: 'button', disabled: busy !== '',
              onClick: () => { void load() },
            }, '刷新'),
            h('button', {
              className: 'sh-btn', type: 'button',
              onClick: () => setFilter(filter === 'all' ? 'needs-key' : 'all'),
            }, filter === 'all' ? '只看缺 key' : '显示全部'),
          ),
        ),

        // provider binding warning
        providerOk
          ? null
          : h('div', { className: 'sh-banner is-warn' },
              h('strong', null, '搜索 seam 未指向本插件的引擎池'),
              h('br'),
              '当前 ',
              h('code', null, 'searchProvider'),
              ' = ',
              h('code', null, String(status.provider.current ?? '(未设置)')),
              '，期望 ',
              h('code', null, status.provider.expected),
              '。请在 profile 的 ',
              h('code', null, 'cordis.patch.yml'),
              ' 中设置：',
              h('br'),
              h('code', null, `- id: web  →  config: searchProvider: ${status.provider.expected}`),
            ),

        // credentials unavailable
        status.credentialsAvailable
          ? null
          : h('div', { className: 'sh-banner is-warn' },
              '凭据服务不可用，无法读写 API Key。请确认宿主已挂载 ',
              h('code', null, 'ctx.credentials'),
              '。',
            ),

        msg !== null ? h('div', { className: `sh-msg is-${msg.kind === 'ok' ? 'ok' : 'err'}` }, msg.text) : null,
        error !== '' ? h('div', { className: 'sh-banner is-bad' }, error) : null,

        // kpis
        h('div', { className: 'sh-kpis' },
          h('div', { className: 'sh-kpi' },
            h('div', { className: 'sh-kpi-label' }, '可用引擎'),
            h('div', { className: 'sh-kpi-value' }, String(status.summary.ready)),
          ),
          h('div', { className: 'sh-kpi' },
            h('div', { className: 'sh-kpi-label' }, '缺 key'),
            h('div', { className: 'sh-kpi-value' }, String(status.summary.needsKey)),
          ),
          h('div', { className: 'sh-kpi' },
            h('div', { className: 'sh-kpi-label' }, '默认引擎'),
            h('div', { className: 'sh-kpi-value', style: { fontSize: '15px' } }, String(status.pool.defaultEngine ?? '—')),
          ),
          h('div', { className: 'sh-kpi' },
            h('div', { className: 'sh-kpi-label' }, '回退链长度'),
            h('div', { className: 'sh-kpi-value' }, String(status.pool.fallbackOrder.length)),
          ),
        ),

        // engine table
        h('div', { className: 'sh-group' },
          h('div', { className: 'sh-group-head' },
            h('div', { className: 'sh-group-title' }, filter === 'all' ? '全部引擎' : '缺 key 的引擎'),
            h('div', { className: 'sh-group-count' }, `${shown.length} 项`),
          ),
          shown.length === 0
            ? h('div', { className: 'sh-empty' }, '没有符合条件的引擎')
            : shown.map((engine) => h(EngineRow, {
                key: engine.id,
                engine,
                busy,
                onSave: saveKey,
                onClear: clearKey,
                probe: probes ? probes[engine.id] : null,
                keys: engine.credRef && status.keys ? status.keys[engine.credRef] ?? [] : [],
                onAddKey: addKey,
                onRemoveKey: removeKey,
                onClearKeys: clearKeys,
                onRenameKey: renameKey,
                onEditKey: editKey,
              })),
        ),

        // fallback order
        h('div', { className: 'sh-group' },
          h('div', { className: 'sh-group-head' },
            h('div', { className: 'sh-group-title' }, '回退顺序'),
            h('div', { className: 'sh-group-count' }, status.pool.fallbackOrder.length === 0 ? '未配置' : `${status.pool.fallbackOrder.length} 个`),
          ),
          h('div', { style: { padding: '12px 15px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            status.pool.fallbackOrder.length === 0
              ? h('span', { className: 'sh-hint' }, '未配置回退链，将由引擎自身的默认顺序处理')
              : status.pool.fallbackOrder.map((id, i) =>
                  h('span', {
                    key: id,
                    className: 'sh-hint',
                    style: {
                      border: '1px solid var(--sh-border)',
                      borderRadius: '6px',
                      padding: '2px 8px',
                      background: 'var(--sh-bg-2)',
                    },
                  }, `${i + 1}. ${id}`),
                ),
          ),
        ),

        // default engine quick switch
        h('div', { className: 'sh-group' },
          h('div', { className: 'sh-group-head' },
            h('div', { className: 'sh-group-title' }, '切换默认引擎'),
            h('div', { className: 'sh-group-count' }, '点击即写入 profile'),
          ),
          h('div', { style: { padding: '12px 15px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            ['auto', 'multi'].map((id) =>
              h('button', {
                key: id,
                className: `sh-btn${status.pool.defaultEngine === id ? ' sh-btn-primary' : ''}`,
                type: 'button',
                disabled: busy !== '',
                onClick: () => { void setDefault(id) },
              }, id),
            ),
            engines.map((e) =>
              h('button', {
                key: e.id,
                className: `sh-btn${status.pool.defaultEngine === e.id ? ' sh-btn-primary' : ''}`,
                type: 'button',
                disabled: busy !== '',
                onClick: () => { void setDefault(e.id) },
              }, e.id),
            ),
          ),
          h('div', { style: { padding: '0 15px 12px' } },
            h('span', { className: 'sh-hint' },
              '提示：',
              h('code', null, 'auto'),
              ' 按任务类型（新闻/学术/代码/购物/图片）+ 语言智能选路，',
              h('code', null, 'multi'),
              ' 按任务池并发多引擎合并去重（成倍消耗额度）。',
            ),
          ),
        ),

        // footer
        h('div', { className: 'sh-hint', style: { marginTop: '4px' } },
          `v${status.version} · 配置文件：${status.pool.file ?? '未找到'} · 引擎池由 ${status.owner.plugin} 提供`,
        ),
      )
    }

    // ── sidebar icon ──────────────────────────────────────────────────────
    function SearchHubLogo(owner) {
      const size = (owner && owner.size) || 16
      // A magnifier over three stacked source rows: "many channels, one query".
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { display: 'block' },
      },
        h('circle', { cx: 6.5, cy: 6.5, r: 4.2 }),
        h('line', { x1: 9.6, y1: 9.6, x2: 13.4, y2: 13.4 }),
        h('line', { x1: 4.2, y1: 5.2, x2: 8.8, y2: 5.2, opacity: 0.55 }),
        h('line', { x1: 4.2, y1: 7.8, x2: 7.4, y2: 7.8, opacity: 0.55 }),
      )
    }

    // ── registration ──────────────────────────────────────────────────────
    function apply(ctx) {
      const t = ctx.locale?.bind?.(NS) ?? ((k) => k)
      const label = () => {
        const v = t('nav')
        return v && v !== 'nav' ? v : '搜索渠道'
      }

      // 1. sidebar row
      const offRow = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 2,
        label,
        locale: NS,
      }, (owner) => h(SearchHubLogo, owner ?? {})))

      // 2. the page that the row opens
      const offPanel = ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ t }),
      }, () => h(SearchHubPage, {})))

      // 3. settings section
      const offSection = ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: PANEL_ID,
        order: 46,
        label,
        locale: NS,
      }, (props) => h(SearchHubPage, props)))

      if (typeof offRow === 'function') ctx.effect(() => offRow, 'dsh-search-hub: sidebar row')
      if (typeof offPanel === 'function') ctx.effect(() => offPanel, 'dsh-search-hub: main panel')
      if (typeof offSection === 'function') ctx.effect(() => offSection, 'dsh-search-hub: settings section')

      injectStyles()
    }

const inject = ['slots', 'locale']

    exports.apply = apply
    exports.inject = inject
    exports.name = 'dsh-search-hub'
    return module.exports
  },
})
