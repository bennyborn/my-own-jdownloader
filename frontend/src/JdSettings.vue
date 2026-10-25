<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Link2, RotateCcw, Search } from 'lucide-vue-next'
import { settingsDevice } from './devices'
import { jdConfig, jdConfigError, jdConfigState, loadJdConfig, resetJdSetting, saveJdSetting, type ConfigEntry, type ConfigGroup } from './jdconfig'
import { showError } from './toast'

// Either a category of the core settings, or the groups to show (one plugin's settings).
const props = defineProps<{ category?: string; title: string; groups?: ConfigGroup[] }>()

if (!props.groups) {
  watch(settingsDevice, () => void loadJdConfig(true))
  void loadJdConfig()
}

const groups = computed(() => props.groups ?? jdConfig.value.find((c) => c.id === props.category)?.groups ?? [])
const query = ref('')
const matches = (e: ConfigEntry) => {
  const q = query.value.trim().toLowerCase()
  return !q || e.label.toLowerCase().includes(q) || e.key.toLowerCase().includes(q) || (e.docs ?? '').toLowerCase().includes(q)
}
const shown = computed(() => groups.value.map((g) => ({ group: g, entries: g.entries.filter(matches) })).filter((g) => g.entries.length))

// What the user typed into text-like fields before it is sent (on leaving the field).
const drafts = reactive<Record<string, string>>({})
const busy = reactive(new Set<string>())
const idOf = (g: ConfigGroup, e: ConfigEntry) => `${g.interfaceName}\0${g.storage ?? ''}\0${e.key}`

const isList = (e: ConfigEntry) => e.type === 'STRING_LIST' || e.type === 'INT_LIST'
const isNumber = (e: ConfigEntry) => e.type === 'INT' || e.type === 'LONG' || e.type === 'DOUBLE'
// Structured values, and any type this page does not know (a newer JDownloader): edited as raw JSON.
const SIMPLE = ['BOOLEAN', 'ENUM', 'INT', 'LONG', 'DOUBLE', 'STRING', 'STRING_LIST', 'INT_LIST']
const isJson = (e: ConfigEntry) => !SIMPLE.includes(e.type)
const text = (e: ConfigEntry): string => {
  if (isList(e)) return ((e.value as unknown[] | null) ?? []).join('\n')
  if (isJson(e)) return e.value === undefined ? '' : JSON.stringify(e.value, null, 2)
  return e.value == null ? '' : String(e.value)
}
const shownText = (g: ConfigGroup, e: ConfigEntry) => drafts[idOf(g, e)] ?? text(e)
const changed = (e: ConfigEntry) => (e.secret ? !!e.set : JSON.stringify(e.value) !== JSON.stringify(e.defaultValue))

const parse = (e: ConfigEntry, raw: string): unknown => {
  if (e.type === 'INT' || e.type === 'LONG') {
    if (!/^\s*-?\d+\s*$/.test(raw)) throw new Error('Not a whole number')
    return Number.parseInt(raw, 10)
  }
  if (e.type === 'DOUBLE') {
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n)) throw new Error('Not a number')
    return n
  }
  if (e.type === 'STRING_LIST') return raw.split('\n').map((l) => l.trim()).filter(Boolean)
  if (e.type === 'INT_LIST') {
    const parts = raw.split(/[\s,;]+/).filter(Boolean)
    if (!parts.every((p) => /^-?\d+$/.test(p))) throw new Error('Whole numbers only')
    return parts.map(Number)
  }
  if (isJson(e)) {
    try {
      return JSON.parse(raw)
    } catch {
      throw new Error('Not valid JSON')
    }
  }
  return raw
}

const commit = async (g: ConfigGroup, e: ConfigEntry, input: unknown) => {
  const id = idOf(g, e)
  busy.add(id)
  try {
    await saveJdSetting(g, e, input)
    delete drafts[id]
  } catch (err) {
    showError(`${e.label}: ${err instanceof Error ? err.message : err}`)
    delete drafts[id]
  } finally {
    busy.delete(id)
  }
}

// Text-like fields are sent when left, and only if the text really changed.
const commitText = async (g: ConfigGroup, e: ConfigEntry) => {
  const id = idOf(g, e)
  const raw = drafts[id]
  if (raw === undefined || raw === text(e)) return void delete drafts[id]
  try {
    await commit(g, e, parse(e, raw))
  } catch (err) {
    showError(`${e.label}: ${err instanceof Error ? err.message : err}`)
    delete drafts[id]
  }
}

const commitSecret = (g: ConfigGroup, e: ConfigEntry) => {
  const raw = drafts[idOf(g, e)]
  if (raw !== undefined) void commit(g, e, raw)
}

const reset = async (g: ConfigGroup, e: ConfigEntry) => {
  const id = idOf(g, e)
  busy.add(id)
  try {
    await resetJdSetting(g, e)
    delete drafts[id]
  } catch (err) {
    showError(`${e.label}: ${err instanceof Error ? err.message : err}`)
  } finally {
    busy.delete(id)
  }
}
</script>

<template>
  <p v-if="!groups.length && !props.groups && jdConfigState === 'error'" class="error">The JDownloader's settings could not be loaded: {{ jdConfigError }}</p>
  <p v-else-if="!props.groups && jdConfigState === 'loading' && !jdConfig.length" class="hint">Loading…</p>
  <template v-else>
    <div class="search">
      <Search :size="16" />
      <input v-model="query" type="search" placeholder="Filter settings" aria-label="Filter settings" />
    </div>
    <p v-if="!shown.length" class="hint">No settings found.</p>
    <section v-for="s in shown" :key="s.group.interfaceName + (s.group.storage ?? '')" class="group" :class="{ managed: s.group.note }">
      <p v-if="s.group.note" class="managed-note"><Link2 :size="14" /> <span><strong>{{ s.group.noteTitle }}</strong> {{ s.group.note }}</span></p>
      <h3 v-if="s.group.label.toLowerCase() !== title.toLowerCase()">{{ s.group.label }}</h3>
      <div v-for="e in s.entries" :key="e.key" class="field" :class="{ changed: changed(e), bool: e.type === 'BOOLEAN' }">
        <div class="line">
          <label :for="idOf(s.group, e)">{{ e.label }}</label>
          <button v-if="changed(e)" type="button" class="reset" :disabled="busy.has(idOf(s.group, e))" title="Reset to the default" aria-label="Reset to the default" @click="reset(s.group, e)"><RotateCcw :size="14" /></button>
        </div>
        <input v-if="e.type === 'BOOLEAN'" :id="idOf(s.group, e)" type="checkbox" :checked="e.value === true" :disabled="busy.has(idOf(s.group, e))" @change="commit(s.group, e, ($event.target as HTMLInputElement).checked)" />
        <select v-else-if="e.type === 'ENUM'" :id="idOf(s.group, e)" :value="e.value" :disabled="busy.has(idOf(s.group, e))" @change="commit(s.group, e, ($event.target as HTMLSelectElement).value)">
          <option v-for="o in e.options" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <div v-else-if="e.secret" class="secret">
          <input :id="idOf(s.group, e)" type="password" autocomplete="off" :placeholder="e.set ? 'set (type to replace)' : 'not set'" :value="drafts[idOf(s.group, e)] ?? ''" @input="drafts[idOf(s.group, e)] = ($event.target as HTMLInputElement).value" @keydown.enter="commitSecret(s.group, e)" @blur="commitSecret(s.group, e)" />
        </div>
        <textarea v-else-if="isList(e) || isJson(e)" :id="idOf(s.group, e)" :rows="Math.min(8, Math.max(2, shownText(s.group, e).split('\n').length))" spellcheck="false" :value="shownText(s.group, e)" @input="drafts[idOf(s.group, e)] = ($event.target as HTMLTextAreaElement).value" @blur="commitText(s.group, e)"></textarea>
        <input v-else :id="idOf(s.group, e)" type="text" :inputmode="isNumber(e) ? 'numeric' : undefined" :value="shownText(s.group, e)" @input="drafts[idOf(s.group, e)] = ($event.target as HTMLInputElement).value" @keydown.enter="($event.target as HTMLInputElement).blur()" @blur="commitText(s.group, e)" />
        <small v-if="e.docs" class="dim">{{ e.docs }}</small>
      </div>
    </section>
  </template>
</template>

<style scoped>
.hint, .dim { color: var(--muted); }
.hint { font-size: 0.85rem; }
.error { color: #d14343; font-size: 0.85rem; overflow-wrap: anywhere; }
.search { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 0 10px; background: var(--bg); color: var(--muted); border: 1px solid var(--border); border-radius: 6px; }
.search:focus-within { border-color: var(--accent); }
.search input { flex: 1; min-width: 0; padding: 7px 0; background: none; color: var(--text); border: 0; outline: 0; font: inherit; }
.group.managed { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
.managed-note { display: flex; gap: 8px; margin: 0; padding: 8px 10px; background: color-mix(in srgb, var(--accent) 12%, transparent); border-radius: 6px; font-size: 0.8rem; line-height: 1.45; }
.managed-note svg { flex: none; margin-top: 2px; color: var(--accent); }
.group { display: grid; gap: 12px; margin-bottom: 12px; padding: 14px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
h3 { margin: 0; font-size: 0.95rem; }
.field { display: grid; gap: 4px; }
.field.changed .line label { font-weight: 600; }
.line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.line label { font-size: 0.85rem; }
.field small { font-size: 0.78rem; line-height: 1.4; }
input[type='text'], input[type='password'], select, textarea { width: 100%; box-sizing: border-box; padding: 7px 10px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; }
textarea { font-family: ui-monospace, monospace; font-size: 0.85rem; resize: vertical; }
input[type='checkbox'] { justify-self: start; }
/* A switch sits left of its label, in one row. */
.field.bool { grid-template-columns: auto minmax(0, 1fr); align-items: center; column-gap: 10px; row-gap: 2px; }
.field.bool > input { grid-area: 1 / 1; margin: 0; }
.field.bool > .line { grid-area: 1 / 2; justify-content: flex-start; }
.field.bool > .line label { cursor: pointer; }
.field.bool > small { grid-column: 2; }
.reset { display: inline-flex; padding: 3px; background: none; border: 0; border-radius: 4px; color: var(--muted); cursor: pointer; }
.reset:hover { color: var(--text); background: var(--hover); }
.reset:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
