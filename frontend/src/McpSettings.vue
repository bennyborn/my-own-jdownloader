<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { showError } from './toast'

interface McpTool {
  name: string
  description: string
  write: boolean
}

interface LogEntry {
  id: number
  at: number
  kind: 'rpc' | 'tool'
  name: string
  device?: string
  from?: { client?: string; user?: string; ip?: string; userAgent?: string }
  args?: unknown
  ms?: number
  ok?: boolean
  result?: string
  error?: string
}

const write = ref(false)
const debug = ref(false)
const log = ref<LogEntry[]>([])
const logBox = ref<HTMLElement>()
const follow = ref(true)
const openIds = ref(new Set<number>())
let source: EventSource | undefined
const tools = ref<McpTool[]>([])
const saving = ref(false)
const loaded = ref(false)

const url = computed(() => `${location.origin}/mcp`)
const command = computed(() => `claude mcp add --transport http jd ${url.value} --header "Authorization: Basic <base64 of user:password>"`)

const apply = (data: { write: boolean; debug: boolean; tools: McpTool[] }) => {
  write.value = data.write
  debug.value = data.debug
  tools.value = data.tools
}

const scrollDown = async () => {
  await nextTick()
  if (follow.value && logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
}

// The stream replays what was recorded and then sends every change; the browser reconnects it on its own.
const listen = () => {
  if (source) return
  source = new EventSource('/api/mcp/log')
  source.addEventListener('entries', (e) => {
    log.value = JSON.parse((e as MessageEvent).data)
    void scrollDown()
  })
  source.addEventListener('entry', (e) => {
    const entry: LogEntry = JSON.parse((e as MessageEvent).data)
    const i = log.value.findIndex((x) => x.id === entry.id)
    if (i >= 0) log.value[i] = entry
    else log.value.push(entry)
    if (log.value.length > 200) log.value.shift()
    void scrollDown()
  })
}
const stopListening = () => {
  source?.close()
  source = undefined
}
watch(debug, (on) => {
  if (on) listen()
  else {
    stopListening()
    log.value = []
  }
})
onBeforeUnmount(stopListening)

const who = (e: LogEntry) => [e.from?.client, e.from?.user && `user ${e.from.user}`, e.from?.ip].filter(Boolean).join(' · ')
const time = (at: number) => new Date(at).toLocaleTimeString()
const pretty = (json: string | undefined) => {
  if (!json) return ''
  try {
    return JSON.stringify(JSON.parse(json), null, 1)
  } catch {
    return json
  }
}
const toggle = (id: number) => {
  const next = new Set(openIds.value)
  if (!next.delete(id)) next.add(id)
  openIds.value = next
}
const clearLog = async () => {
  log.value = []
  await fetch('/api/mcp/log', { method: 'DELETE' }).catch(() => undefined)
}

onMounted(async () => {
  try {
    const res = await fetch('/api/mcp')
    if (res.ok) apply(await res.json())
    loaded.value = res.ok
    if (debug.value) listen()
  } catch {
    /* the section stays empty */
  }
})

const change = async (body: { write?: boolean; debug?: boolean }) => {
  saving.value = true
  try {
    const res = await fetch('/api/mcp', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)
    apply(await res.json())
  } catch (e) {
    showError(`Saving failed: ${e instanceof Error ? e.message : e}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <p class="hint">The MCP server lets an assistant look things up and, if you allow it, change things on your JDownloaders. It uses the same password as this page. It never stops, pauses or deletes downloads.</p>

  <section class="block">
    <label class="switch">
      <input type="checkbox" :checked="write" :disabled="!loaded || saving" @change="change({ write: ($event.target as HTMLInputElement).checked })" />
      <strong>Allow changes</strong>
    </label>
    <p class="hint">Off: read only. On: the assistant may also change and reset JDownloader settings and add links to the linkgrabber. Secrets and settings this app manages itself stay protected. Applies to the next request.</p>
  </section>

  <section class="block">
    <h3>Connect</h3>
    <p class="hint">Address: <code>{{ url }}</code> (Streamable HTTP, HTTP Basic auth with any user name and the password of this page).</p>
    <pre>{{ command }}</pre>
  </section>

  <section class="block">
    <h3>Debug log</h3>
    <label class="switch">
      <input type="checkbox" :checked="debug" :disabled="!loaded || saving" @change="change({ debug: ($event.target as HTMLInputElement).checked })" />
      <strong>Record calls</strong>
    </label>
    <p class="hint">The user name of the connection is not checked, so give every client its own (e.g. in the <code>--header</code> of the connect command) to tell them apart here. Shows what the assistant asks and what it gets back, live. Arguments and answers are kept in memory only (the last 200) and forgotten when this is switched off or the server restarts. Values of settings that look like secrets are hidden.</p>
    <template v-if="debug">
      <div class="logbar">
        <label class="switch"><input v-model="follow" type="checkbox" /> Auto-scroll</label>
        <button type="button" :disabled="!log.length" @click="clearLog">Clear</button>
      </div>
      <p v-if="!log.length" class="hint">Nothing yet: waiting for the assistant.</p>
      <div v-else ref="logBox" class="log" role="log">
        <div v-for="e in log" :key="e.id" class="entry" :class="{ error: e.ok === false, pending: e.kind === 'tool' && e.ok === undefined }">
          <button type="button" class="line" :aria-expanded="openIds.has(e.id)" @click="toggle(e.id)">
            <span class="time">{{ time(e.at) }}</span>
            <code class="name">{{ e.name }}</code>
            <span v-if="e.device" class="dev">{{ e.device }}</span>
            <span v-if="e.from" class="from">{{ who(e) }}</span>
            <span class="state">{{ e.kind === 'rpc' ? '' : e.ok === undefined ? 'running' : e.ok ? `${e.ms} ms` : `failed, ${e.ms} ms` }}</span>
          </button>
          <div v-if="openIds.has(e.id)" class="detail">
            <template v-if="e.from"><small>From</small><pre>{{ [e.from.client && `Client: ${e.from.client}`, e.from.user && `User name: ${e.from.user}`, e.from.ip && `Address: ${e.from.ip}`, e.from.userAgent && `User agent: ${e.from.userAgent}`].filter(Boolean).join('\n') }}</pre></template>
            <template v-if="e.args !== undefined"><small>Arguments</small><pre>{{ JSON.stringify(e.args, null, 1) }}</pre></template>
            <template v-if="e.error"><small>Error</small><pre>{{ e.error }}</pre></template>
            <template v-if="e.result"><small>Answer</small><pre>{{ pretty(e.result) }}</pre></template>
            <small v-if="e.args === undefined && !e.error && !e.result">No details.</small>
          </div>
        </div>
      </div>
    </template>
  </section>

  <section class="block">
    <h3>Tools</h3>
    <ul>
      <li v-for="t in tools" :key="t.name" :class="{ off: t.write && !write }">
        <code>{{ t.name }}</code><span v-if="t.write" class="tag">{{ write ? 'changes' : 'changes, off' }}</span>
        <small>{{ t.description }}</small>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.hint { margin: 0 0 12px; color: var(--muted); font-size: 0.85rem; line-height: 1.5; }
.block { display: grid; gap: 8px; margin-bottom: 12px; padding: 14px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
.block .hint { margin: 0; }
h3 { margin: 0; font-size: 0.95rem; }
.switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
pre { margin: 0; padding: 8px 10px; overflow-x: auto; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-size: 0.8rem; }
ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
li { display: grid; gap: 2px; }
li.off { opacity: 0.55; }
li small { color: var(--muted); line-height: 1.4; }
.tag { margin-left: 8px; padding: 1px 6px; border-radius: 4px; background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); font-size: 0.72rem; }
code { font-size: 0.85em; }
.logbar { display: flex; align-items: center; justify-content: space-between; }
.logbar button { padding: 4px 12px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
.logbar button:disabled { opacity: 0.5; cursor: default; }
.log { max-height: 420px; overflow-y: auto; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; }
.entry { border-bottom: 1px solid var(--border); }
.entry:last-child { border-bottom: 0; }
.line { display: flex; align-items: baseline; gap: 10px; width: 100%; padding: 5px 10px; background: none; border: 0; color: var(--text); font: inherit; font-size: 0.82rem; text-align: left; cursor: pointer; }
.line:hover { background: var(--hover); }
.line:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.time, .dev, .from, .state { color: var(--muted); font-size: 0.78rem; }
.from { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.state { margin-left: auto; flex: none; }
.entry.error .state { color: #d14343; }
.entry.pending .state { color: var(--accent); }
.detail { display: grid; gap: 2px; padding: 0 10px 8px; }
.detail small { color: var(--muted); }
.detail pre { max-height: 240px; overflow: auto; border: 0; padding: 6px 8px; background: var(--card); white-space: pre-wrap; overflow-wrap: anywhere; }
input[type='checkbox']:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
