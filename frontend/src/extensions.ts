import { ref } from 'vue'
import { settingsDevice, withDevice } from './devices'
import type { ConfigGroup } from './jdconfig'

export interface JdExtension {
  id: string
  name: string
  description: string
  installed: boolean
  enabled: boolean
  configInterface?: string
}

// The extensions of the shown device, see backend/src/extensions.ts.
export const extensions = ref<JdExtension[]>([])
export const extensionsState = ref<'idle' | 'loading' | 'error'>('idle')
export const extensionsError = ref('')

const failure = async (res: Response): Promise<Error> => new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)

export const loadExtensions = async (): Promise<void> => {
  if (!settingsDevice.value) return
  extensionsState.value = 'loading'
  try {
    const res = await fetch(withDevice('/api/extensions', settingsDevice.value))
    if (!res.ok) throw await failure(res)
    extensions.value = await res.json()
    extensionsState.value = 'idle'
  } catch (e) {
    extensionsError.value = e instanceof Error ? e.message : String(e)
    extensionsState.value = 'error'
  }
}

const post = async (url: string, body: unknown): Promise<void> => {
  const res = await fetch(withDevice(url, settingsDevice.value), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw await failure(res)
}
export const installExtension = async (id: string): Promise<void> => {
  await post('/api/extensions/install', { id })
  await loadExtensions()
}
export const setExtensionEnabled = async (id: string, enabled: boolean): Promise<void> => {
  await post('/api/extensions/enabled', { id, enabled })
  await loadExtensions()
}

// The settings of an installed extension, in the form the generic settings page shows.
export const fetchExtensionGroup = async (id: string): Promise<ConfigGroup> => {
  const res = await fetch(withDevice(`/api/extensions/config?id=${encodeURIComponent(id)}`, settingsDevice.value))
  if (!res.ok) throw await failure(res)
  return res.json()
}
