import { ref } from 'vue'
import { settingsDevice, withDevice } from './devices'

export interface ConfigEntry {
  key: string
  label: string
  type: string
  value?: unknown
  defaultValue?: unknown
  docs?: string
  options?: { value: string; label: string }[]
  secret?: boolean
  set?: boolean
}
export interface ConfigGroup {
  interfaceName: string
  storage: string | null
  label: string
  note?: string
  noteTitle?: string
  entries: ConfigEntry[]
}
export interface ConfigCategory {
  id: string
  groups: ConfigGroup[]
}

// The settings of the JDownloader of the shown device, by category (see backend/src/jdconfig.ts).
export const jdConfig = ref<ConfigCategory[]>([])
export const jdConfigState = ref<'idle' | 'loading' | 'error'>('idle')
export const jdConfigError = ref('')
let loadedFor = ''

const failure = async (res: Response): Promise<Error> => new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)

export const loadJdConfig = async (force = false): Promise<void> => {
  const device = settingsDevice.value
  if (!device || (!force && loadedFor === device)) return
  jdConfigState.value = 'loading'
  try {
    const res = await fetch(withDevice('/api/jd-config', device))
    if (!res.ok) throw await failure(res)
    jdConfig.value = await res.json()
    loadedFor = device
    jdConfigState.value = 'idle'
  } catch (e) {
    jdConfigError.value = e instanceof Error ? e.message : String(e)
    jdConfigState.value = 'error'
  }
}

const find = (group: ConfigGroup, key: string) => group.entries.find((e) => e.key === key)

export const saveJdSetting = async (group: ConfigGroup, entry: ConfigEntry, value: unknown): Promise<void> => {
  const res = await fetch(withDevice('/api/jd-config', settingsDevice.value), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interfaceName: group.interfaceName, storage: group.storage, key: entry.key, value })
  })
  if (!res.ok) throw await failure(res)
  const target = find(group, entry.key)
  if (!target) return
  if (target.secret) target.set = value !== ''
  else target.value = value
}

export const resetJdSetting = async (group: ConfigGroup, entry: ConfigEntry): Promise<void> => {
  const res = await fetch(withDevice('/api/jd-config/reset', settingsDevice.value), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interfaceName: group.interfaceName, storage: group.storage, key: entry.key })
  })
  if (!res.ok) throw await failure(res)
  const target = find(group, entry.key)
  if (target) {
    if (target.secret) target.set = false
    else target.value = target.defaultValue
  }
}

// --- Plugins (hosters, crawlers, ...) -------------------------------------------------------------------
export interface PluginConfig {
  interfaceName: string
  storage: string
  host: string
  kind: string
  count: number
}

export const pluginConfigs = ref<PluginConfig[]>([])
export const pluginConfigsState = ref<'idle' | 'loading' | 'error'>('idle')
export const pluginConfigsError = ref('')

export const loadPluginConfigs = async (): Promise<void> => {
  if (!settingsDevice.value) return
  pluginConfigsState.value = 'loading'
  try {
    const res = await fetch(withDevice('/api/jd-plugins', settingsDevice.value))
    if (!res.ok) throw await failure(res)
    pluginConfigs.value = await res.json()
    pluginConfigsState.value = 'idle'
  } catch (e) {
    pluginConfigsError.value = e instanceof Error ? e.message : String(e)
    pluginConfigsState.value = 'error'
  }
}

export const fetchPluginGroup = async (p: PluginConfig): Promise<ConfigGroup> => {
  const res = await fetch(withDevice(`/api/jd-plugins/config?interfaceName=${encodeURIComponent(p.interfaceName)}&storage=${encodeURIComponent(p.storage)}`, settingsDevice.value))
  if (!res.ok) throw await failure(res)
  return res.json()
}
