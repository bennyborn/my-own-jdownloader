import * as Vue from 'vue'
import { computed, markRaw, ref, shallowRef, type Component } from 'vue'
import { withDevice } from './devices'
import { showError } from './toast'

export interface PluginSetting {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'boolean'
  description?: string
  required?: boolean
  options?: { value: string; label: string }[]
  value?: string | boolean
  set?: boolean
}

export interface PluginInfo {
  id: string
  name: string
  description?: string
  version?: string
  ui: boolean
  enabled: boolean
  configured: boolean
  error?: string
  settings: PluginSetting[]
}

export const plugins = ref<PluginInfo[]>([])
// Bumped when plugin settings change, so the blocks ask their plugins again.
export const pluginTick = ref(0)
const activeIds = computed(() => new Set(plugins.value.filter((p) => p.enabled && p.configured).map((p) => p.id)))

// --- Blocks -----------------------------------------------------------------------------------------------
// The core templates define named blocks with their own default content (see PackageSlot.vue). A plugin's
// UI module can extend a block (prepend / append) or replace it; a replacing component receives the default
// content as its slot and may render it again, like super() in template inheritance.
export type BlockMode = 'prepend' | 'append' | 'replace'
export interface BlockEntry {
  pluginId: string
  component: Component
  mode: BlockMode
}
export const blockEntries = shallowRef<Record<string, BlockEntry[]>>({})
// Only blocks of plugins that are switched on and set up are shown.
export const entriesOf = (name: string): BlockEntry[] => (blockEntries.value[name] ?? []).filter((e) => activeIds.value.has(e.pluginId))

const loadedUi = new Set<string>()
const loadUi = async (p: PluginInfo): Promise<void> => {
  if (!p.ui || loadedUi.has(p.id)) return
  loadedUi.add(p.id)
  try {
    const module = await import(/* @vite-ignore */ `/api/plugins/${p.id}/ui.js?v=${encodeURIComponent(p.version ?? '')}`)
    module.default({
      Vue,
      pluginId: p.id,
      block: (name: string, component: Component, mode: BlockMode = 'append') => {
        const next = { ...blockEntries.value }
        next[name] = [...(next[name] ?? []).filter((e) => !(e.pluginId === p.id && e.mode === mode)), { pluginId: p.id, component: markRaw(component), mode }]
        blockEntries.value = next
      }
    })
  } catch (e) {
    showError(`Plugin "${p.name}": its UI could not be loaded: ${e instanceof Error ? e.message : e}`)
  }
}
const loadUis = () => plugins.value.filter((p) => p.enabled && p.configured).forEach((p) => void loadUi(p))

export const loadPlugins = async (): Promise<void> => {
  try {
    const res = await fetch('/api/plugins')
    if (res.ok) plugins.value = await res.json()
    loadUis()
  } catch {
    /* the app works without plugins */
  }
}

export const savePlugin = async (id: string, change: { enabled?: boolean; values?: Record<string, string | boolean | null> }): Promise<void> => {
  const res = await fetch(`/api/plugins/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)
  const updated: PluginInfo = await res.json()
  plugins.value = plugins.value.map((p) => (p.id === id ? updated : p))
  packageData.clear()
  pluginTick.value++
  loadUis()
}

// The list a package is in.
export type PluginArea = 'downloads' | 'linkgrabber'

// What a plugin's backend part knows about a package (its own JSON, interpreted by its UI module).
const packageData = new Map<string, Promise<Record<string, unknown>>>()
export const fetchPackageData = (pluginId: string, name: string, uuid: number, area: PluginArea, device?: string): Promise<Record<string, unknown>> => {
  const key = `${pluginId}\0${device ?? ''}\0${area}\0${uuid}\0${name}`
  let job = packageData.get(key)
  if (!job) {
    job = fetch(withDevice(`/api/plugins/${pluginId}/package?name=${encodeURIComponent(name)}&uuid=${uuid}&area=${area}`, device))
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}))
    packageData.set(key, job)
  }
  return job
}
