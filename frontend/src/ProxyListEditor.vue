<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue'
import { askConfirm } from './confirm'
import { ChevronDown, ChevronRight, Download, GripVertical, Plus, Trash2, Upload } from 'lucide-vue-next'

// Editor for the JDownloader's "Custom proxy list" (InternetConnectionSettings.CustomProxyList). It works on a
// copy and sends the whole list on "Save"; fields it does not know stay as they are.
interface ProxyData {
  address: string | null
  port: number
  type: string
  username: string | null
  password: string | null
  [key: string]: unknown
}
interface ProxyFilter {
  type: string
  entries: string[]
}
interface ProxyEntry {
  proxy: ProxyData
  enabled: boolean
  pac: boolean
  filter: ProxyFilter | null
  rangeRequestsSupported: boolean
  reconnectSupported: boolean
  [key: string]: unknown
}

const props = defineProps<{ value: unknown; busy: boolean }>()
const emit = defineEmits<{ save: [list: ProxyEntry[]] }>()

const TYPES = [
  { value: 'HTTP', label: 'HTTP' },
  { value: 'SOCKS5', label: 'SOCKS5' },
  { value: 'SOCKS4', label: 'SOCKS4' },
  { value: 'NONE', label: 'Direct (no proxy)' }
]
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const fromProps = (): ProxyEntry[] => (Array.isArray(props.value) ? clone(props.value as ProxyEntry[]) : [])

const rows = ref<ProxyEntry[]>(fromProps())
const saved = computed(() => JSON.stringify(props.value ?? []))
const dirty = computed(() => JSON.stringify(rows.value) !== saved.value)
// A change coming from the device (another client, a reload) replaces the copy unless it is being edited.
watch(saved, () => {
  if (!dirty.value) rows.value = fromProps()
})

// Unfolded entries, by object: they stay unfolded when the list is reordered.
const open = ref(new Set<ProxyEntry>())
const toggle = (p: ProxyEntry) => (open.value.has(p) ? open.value.delete(p) : open.value.add(p))
const reindexOpen = () => open.value.clear()

// A stable key per entry, so that reordering moves the rows instead of reusing them for other entries.
const keys = new WeakMap<object, number>()
let nextKey = 0
const keyOf = (p: ProxyEntry): number => {
  const raw = toRaw(p)
  if (!keys.has(raw)) keys.set(raw, nextKey++)
  return keys.get(raw)!
}

// --- Reordering by drag and drop (the handle arms the row, so that the fields in it stay selectable) -------
const armed = ref(-1)
const dragging = ref(-1)
const target = ref<{ index: number; after: boolean } | null>(null)
const onDragStart = (e: DragEvent, i: number) => {
  dragging.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
  }
}
const onDragOver = (e: DragEvent, i: number) => {
  if (dragging.value < 0) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
  target.value = { index: i, after: e.clientY > box.top + box.height / 2 }
}
const endDrag = () => {
  armed.value = -1
  dragging.value = -1
  target.value = null
}
const onDrop = () => {
  const from = dragging.value
  const t = target.value
  endDrag()
  if (from < 0 || !t) return
  let to = t.index + (t.after ? 1 : 0)
  if (to > from) to--
  if (to === from) return
  const [moved] = rows.value.splice(from, 1)
  rows.value.splice(to, 0, moved)
}

const isDirect = (p: ProxyEntry) => p.proxy.type === 'NONE' || p.proxy.type === 'DIRECT'
const types = (p: ProxyEntry) => (TYPES.some((t) => t.value === p.proxy.type) ? TYPES : [...TYPES, { value: p.proxy.type, label: p.proxy.type }])
// Disabled entries are not checked: they may be placeholders, e.g. to separate groups in the list.
const problem = (p: ProxyEntry): string => {
  if (!p.enabled || isDirect(p)) return ''
  if (!p.proxy.address?.trim()) return 'Address missing'
  if (!Number.isInteger(p.proxy.port) || p.proxy.port < 1 || p.proxy.port > 65535) return 'Port must be 1-65535'
  return ''
}
const problems = computed(() => rows.value.filter((p) => problem(p)).length)
const enabledCount = computed(() => rows.value.filter((p) => p.enabled).length)

const blank = (type = 'HTTP'): ProxyEntry => ({
  proxy: { address: '', port: 80, type, username: null, password: null, connectMethodPrefered: false, preferNativeImplementation: false, resolveHostName: false },
  enabled: true,
  pac: false,
  filter: null,
  rangeRequestsSupported: true,
  reconnectSupported: false
})
const add = () => {
  rows.value.push(blank())
}
const remove = (i: number) => {
  open.value.delete(rows.value[i])
  rows.value.splice(i, 1)
}
const plural = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`
const setAll = async (enabled: boolean) => {
  const n = rows.value.filter((p) => p.enabled !== enabled).length
  const label = enabled ? 'Enable all' : 'Disable all'
  if (!(await askConfirm({ title: label, message: `${plural(n)} will be ${enabled ? 'enabled' : 'disabled'}. This is only saved with "Save".`, confirmLabel: label }))) return
  rows.value.forEach((p) => (p.enabled = enabled))
}
const removeDisabled = async () => {
  const n = rows.value.filter((p) => !p.enabled).length
  if (!(await askConfirm({ title: 'Remove disabled', message: `${plural(n)} will be removed from the list. This is only saved with "Save".`, confirmLabel: 'Remove', danger: true }))) return
  rows.value = rows.value.filter((p) => p.enabled)
  reindexOpen()
}

const setPort = (p: ProxyEntry, raw: string) => (p.proxy.port = /^\d+$/.test(raw.trim()) ? Number(raw) : Number.NaN)
const setText = (p: ProxyEntry, field: 'address' | 'username' | 'password', raw: string) => (p.proxy[field] = raw)

const filterType = (p: ProxyEntry) => p.filter?.type ?? ''
const setFilterType = (p: ProxyEntry, type: string) => {
  if (!type) p.filter = null
  else p.filter = { entries: p.filter?.entries ?? [], type }
}
const setFilterEntries = (p: ProxyEntry, raw: string) => {
  if (p.filter) p.filter.entries = raw.split('\n').map((l) => l.trim())
}

// --- Import: one proxy per line --------------------------------------------------------------------------
const importing = ref(false)
const importText = ref('')
const importType = ref('HTTP')
const importNote = ref('')

const SCHEMES: Record<string, string> = { http: 'HTTP', https: 'HTTP', socks: 'SOCKS5', socks5: 'SOCKS5', socks5h: 'SOCKS5', socks4: 'SOCKS4', socks4a: 'SOCKS4' }
// scheme://user:pass@host:port, user:pass@host:port, host:port, host:port:user:pass
const parseLine = (line: string, fallback: string): ProxyEntry | undefined => {
  let s = line.trim()
  if (!s || s.startsWith('#') || s.startsWith('//')) return undefined
  let type = fallback
  const scheme = /^([a-z0-9]+):\/\//i.exec(s)
  if (scheme) {
    type = SCHEMES[scheme[1].toLowerCase()] ?? fallback
    s = s.slice(scheme[0].length)
  }
  s = s.replace(/\/+$/, '')
  let user: string | null = null
  let pass: string | null = null
  const at = s.lastIndexOf('@')
  if (at >= 0) {
    const cred = s.slice(0, at)
    const colon = cred.indexOf(':')
    user = colon >= 0 ? cred.slice(0, colon) : cred
    pass = colon >= 0 ? cred.slice(colon + 1) : ''
    s = s.slice(at + 1)
  }
  const parts = s.split(':')
  if (parts.length < 2) return undefined
  const [host, port] = parts
  if (parts.length >= 4 && at < 0) {
    user = parts[2]
    pass = parts.slice(3).join(':')
  }
  if (!host || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return undefined
  const entry = blank(type)
  entry.proxy.address = host
  entry.proxy.port = Number(port)
  entry.proxy.username = user
  entry.proxy.password = pass
  return entry
}
const runImport = () => {
  const lines = importText.value.split('\n').filter((l) => l.trim() && !/^\s*(#|\/\/)/.test(l))
  const known = new Set(rows.value.map((p) => `${p.proxy.type}|${p.proxy.address}|${p.proxy.port}`))
  let added = 0
  let skipped = 0
  let invalid = 0
  for (const line of lines) {
    const entry = parseLine(line, importType.value)
    if (!entry) {
      invalid++
      continue
    }
    const id = `${entry.proxy.type}|${entry.proxy.address}|${entry.proxy.port}`
    if (known.has(id)) {
      skipped++
      continue
    }
    known.add(id)
    rows.value.push(entry)
    added++
  }
  importNote.value = `${added} added${skipped ? `, ${skipped} already in the list` : ''}${invalid ? `, ${invalid} not understood` : ''}.`
  if (!invalid) importText.value = ''
  else importText.value = lines.filter((l) => !parseLine(l, importType.value)).join('\n')
}

const discard = () => {
  rows.value = fromProps()
  reindexOpen()
}
// The list as it is sent to the JDownloader (a port that is not a number, possible in disabled entries, becomes 0).
const serialized = (): ProxyEntry[] => rows.value.map((p) => ({ ...clone(p), proxy: { ...clone(p.proxy), port: Number.isNaN(p.proxy.port) ? 0 : p.proxy.port } }))
const save = () => emit('save', serialized())

// --- Export: the list as JSON, as it is now (saved or not) -----------------------------------------------
const exporting = ref(false)
const exportText = computed(() => (exporting.value ? JSON.stringify(serialized(), null, 2) : ''))
const copied = ref(false)
const copy = async () => {
  try {
    await navigator.clipboard.writeText(exportText.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // No clipboard access (plain http): the text is selected so that it can be copied by hand.
    exportArea.value?.select()
  }
}
const exportArea = ref<HTMLTextAreaElement>()
const download = () => {
  const url = URL.createObjectURL(new Blob([exportText.value], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'proxy-list.json'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="proxies">
    <span class="tally">{{ rows.length }} {{ rows.length === 1 ? 'entry' : 'entries' }}, {{ enabledCount }} enabled</span>
    <div class="toolbar">
      <button type="button" @click="add"><Plus :size="14" /> Add</button>
      <button type="button" :class="{ on: importing }" @click="importing = !importing"><Upload :size="14" /> Import</button>
      <button type="button" :class="{ on: exporting }" :disabled="!rows.length" @click="exporting = !exporting"><Download :size="14" /> Export</button>
      <button type="button" :disabled="enabledCount === rows.length" @click="setAll(true)">Enable all</button>
      <button type="button" :disabled="!enabledCount" @click="setAll(false)">Disable all</button>
      <button type="button" :disabled="enabledCount === rows.length" @click="removeDisabled">Remove disabled</button>
    </div>

    <div v-if="importing" class="import">
      <textarea v-model="importText" rows="6" spellcheck="false" placeholder="One proxy per line:&#10;1.2.3.4:8080&#10;socks5://user:pass@1.2.3.4:1080&#10;1.2.3.4:3128:user:pass" aria-label="Proxies to import"></textarea>
      <div class="import-actions">
        <label>Type without a scheme
          <select v-model="importType">
            <option v-for="t in TYPES.slice(0, 3)" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </label>
        <button type="button" class="primary" :disabled="!importText.trim()" @click="runImport">Add to the list</button>
        <span v-if="importNote" class="dim">{{ importNote }}</span>
      </div>
    </div>

    <div v-if="exporting && rows.length" class="import">
      <textarea ref="exportArea" :value="exportText" rows="10" readonly spellcheck="false" aria-label="The proxy list as JSON" @focus="($event.target as HTMLTextAreaElement).select()"></textarea>
      <div class="import-actions">
        <button type="button" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
        <button type="button" @click="download">Download .json</button>
        <span class="dim">Passwords are included.</span>
      </div>
    </div>

    <p v-if="!rows.length" class="dim">No proxies. Downloads use the direct connection.</p>
    <ul v-else class="list">
      <li v-for="(p, i) in rows" :key="keyOf(p)" class="entry" :class="{ off: !p.enabled, bad: problem(p), dragging: dragging === i, before: target?.index === i && !target.after && dragging !== i, after: target?.index === i && target.after && dragging !== i }" :draggable="armed === i" @dragstart="onDragStart($event, i)" @dragover="onDragOver($event, i)" @drop.prevent="onDrop" @dragend="endDrag">
        <div class="main">
          <span class="grip" title="Drag to reorder" aria-hidden="true" @pointerdown="armed = i" @pointerup="armed = -1" @pointercancel="armed = -1"><GripVertical :size="16" /></span>
          <input v-model="p.enabled" type="checkbox" :aria-label="`Proxy ${i + 1} enabled`" title="Enabled" />
          <select v-model="p.proxy.type" :aria-label="`Proxy ${i + 1} type`">
            <option v-for="t in types(p)" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <template v-if="!isDirect(p)">
            <input class="addr" type="text" placeholder="Address" autocomplete="off" spellcheck="false" :value="p.proxy.address ?? ''" :aria-label="`Proxy ${i + 1} address`" @input="setText(p, 'address', ($event.target as HTMLInputElement).value)" />
            <input class="port" type="text" inputmode="numeric" placeholder="Port" :value="Number.isNaN(p.proxy.port) ? '' : p.proxy.port" :aria-label="`Proxy ${i + 1} port`" @input="setPort(p, ($event.target as HTMLInputElement).value)" />
          </template>
          <span v-else class="direct">The connection without a proxy{{ p.filter ? ' (with a filter)' : '' }}</span>
          <button type="button" class="icon" :aria-expanded="open.has(p)" :title="open.has(p) ? 'Hide details' : 'Details'" @click="toggle(p)">
            <component :is="open.has(p) ? ChevronDown : ChevronRight" :size="16" />
          </button>
          <button type="button" class="icon danger" title="Remove" :aria-label="`Remove proxy ${i + 1}`" @click="remove(i)"><Trash2 :size="15" /></button>
        </div>
        <p v-if="problem(p)" class="problem">{{ problem(p) }}</p>
        <div v-if="open.has(p)" class="details">
          <template v-if="!isDirect(p)">
            <label class="f">Username
              <input type="text" autocomplete="off" spellcheck="false" :value="p.proxy.username ?? ''" @input="setText(p, 'username', ($event.target as HTMLInputElement).value)" />
            </label>
            <label class="f">Password
              <input type="password" autocomplete="new-password" :value="p.proxy.password ?? ''" @input="setText(p, 'password', ($event.target as HTMLInputElement).value)" />
            </label>
          </template>
          <label class="chk"><input v-model="p.reconnectSupported" type="checkbox" /> Reconnect supported <small class="dim">(the proxy keeps working through a reconnect of the router)</small></label>
          <label class="chk"><input v-model="p.rangeRequestsSupported" type="checkbox" /> Range requests supported <small class="dim">(needed to resume and to load in several chunks)</small></label>
          <label v-if="!isDirect(p)" class="chk"><input v-model="p.proxy.resolveHostName" type="checkbox" /> Resolve host names at the proxy</label>
          <label class="f full">Use for
            <select :value="filterType(p)" @change="setFilterType(p, ($event.target as HTMLSelectElement).value)">
              <option value="">All hosts</option>
              <option value="WHITELIST">Only these hosts</option>
              <option value="BLACKLIST">All hosts except these</option>
            </select>
          </label>
          <label v-if="p.filter" class="f full">Hosts, one per line <small class="dim">(# or // starts a comment)</small>
            <textarea rows="4" spellcheck="false" :value="p.filter.entries.join('\n')" @input="setFilterEntries(p, ($event.target as HTMLTextAreaElement).value)"></textarea>
          </label>
        </div>
      </li>
    </ul>

    <div class="footer" :class="{ sticky: dirty }">
      <span v-if="problems" class="problem">{{ problems }} {{ problems === 1 ? 'entry needs' : 'entries need' }} fixing before it can be saved.</span>
      <span v-else-if="dirty" class="dim">Unsaved changes.</span>
      <button type="button" :disabled="!dirty || busy" @click="discard">Discard</button>
      <button type="button" class="primary" :disabled="!dirty || busy || problems > 0" @click="save">Save</button>
    </div>
  </div>
</template>

<style scoped>
.proxies { display: grid; gap: 10px; }
.dim { color: var(--muted); }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.tally { margin: 0; font-size: 0.8rem; color: var(--muted); }
button { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; font-size: 0.8rem; cursor: pointer; }
button:hover:not(:disabled) { background: var(--hover); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.on { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--accent); }
button.icon { padding: 4px; background: none; border-color: transparent; color: var(--muted); }
button.icon:hover:not(:disabled) { color: var(--text); }
button.danger:hover:not(:disabled) { color: #d14343; }
input[type='text'], input[type='password'], select, textarea { box-sizing: border-box; padding: 6px 8px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; font-size: 0.85rem; min-width: 0; }
textarea { width: 100%; font-family: ui-monospace, monospace; resize: vertical; }
.import { display: grid; gap: 8px; padding: 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; }
.import-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.8rem; }
.import-actions label { display: inline-flex; align-items: center; gap: 6px; }
.list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.entry { padding: 6px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; }
.entry.off .main > :not(:first-child):not(.icon) { opacity: 0.55; }
.entry.bad { border-color: #d14343; }
.entry.dragging { opacity: 0.4; }
.entry.before { box-shadow: 0 -2px 0 var(--accent); }
.entry.after { box-shadow: 0 2px 0 var(--accent); }
.grip { display: inline-flex; flex: none; margin-left: -4px; color: var(--muted); cursor: grab; touch-action: none; }
.grip:hover { color: var(--text); }
.entry.dragging .grip { cursor: grabbing; }
.main { display: flex; align-items: center; gap: 6px; }
.main select { flex: none; width: 9.5em; }
.addr { flex: 1; }
.port { flex: none; width: 5.5em; }
.direct { flex: 1; font-size: 0.85rem; color: var(--muted); }
.problem { margin: 4px 0 0; color: #d14343; font-size: 0.78rem; }
.details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.f { display: grid; gap: 3px; font-size: 0.8rem; }
.f.full, .chk { grid-column: 1 / -1; }
.chk { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 0.8rem; }
.footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; font-size: 0.8rem; }
.footer .dim, .footer .problem { margin: 0 auto 0 0; }
.footer.sticky { position: sticky; bottom: 0; padding: 8px 0; background: var(--card); }
@media (max-width: 640px) {
  .main { flex-wrap: wrap; }
  .addr { flex: 1 1 100%; order: 5; }
  .details { grid-template-columns: 1fr; }
}
</style>
