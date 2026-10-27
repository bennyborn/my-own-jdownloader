import { ref } from 'vue'
import { settingsDevice, withDevice } from './devices'

export interface JdSystemInfo {
  version: number
  coreRevision: number
  uptime: number
  os: string
  osFamily: string
  arch: string
  java: string
  javaVendor: string
  heapUsed: number
  heapCommitted: number
  heapMax: number
  docker: boolean
  headless: boolean
  storage: { path: string; free: number; size: number; error?: string }[]
}

export type PowerAction = 'restart-jd' | 'exit-jd' | 'shutdown' | 'standby' | 'hibernate'

// The system information of the shown device, see backend/src/jdsystem.ts.
export const systemInfo = ref<JdSystemInfo | null>(null)
export const systemState = ref<'idle' | 'loading' | 'error'>('idle')
export const systemError = ref('')

const failure = async (res: Response): Promise<Error> => new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)

export const loadSystemInfo = async (): Promise<void> => {
  if (!settingsDevice.value) return
  systemState.value = 'loading'
  try {
    const res = await fetch(withDevice('/api/jd-system', settingsDevice.value))
    if (!res.ok) throw await failure(res)
    systemInfo.value = await res.json()
    systemState.value = 'idle'
  } catch (e) {
    systemError.value = e instanceof Error ? e.message : String(e)
    systemState.value = 'error'
  }
}

const post = async (url: string, body?: unknown): Promise<void> => {
  const res = await fetch(withDevice(url, settingsDevice.value), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  if (!res.ok) throw await failure(res)
}
export const checkForUpdates = (): Promise<void> => post('/api/jd-system/check-update')
export const powerAction = (action: PowerAction): Promise<void> => post('/api/jd-system/power', { action })
