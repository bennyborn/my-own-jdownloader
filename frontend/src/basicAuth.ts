import { ref } from 'vue'
import { settingsDevice, withDevice } from './devices'

export type BasicAuthType = 'HTTP' | 'FTP'
export interface BasicAuth {
  id: number
  type: BasicAuthType
  hostmask: string
  username: string
  enabled: boolean
}

// The HTTP / FTP logins of the shown device, see backend/src/accounts.ts.
export const logins = ref<BasicAuth[]>([])
export const loginsState = ref<'idle' | 'loading' | 'error'>('idle')
export const loginsError = ref('')

const failure = async (res: Response): Promise<Error> => new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)

const send = async (url: string, body: unknown): Promise<void> => {
  const res = await fetch(withDevice(url, settingsDevice.value), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw await failure(res)
}

export const loadLogins = async (): Promise<void> => {
  if (!settingsDevice.value) return
  loginsState.value = 'loading'
  try {
    const res = await fetch(withDevice('/api/basic-auth', settingsDevice.value))
    if (!res.ok) throw await failure(res)
    logins.value = await res.json()
    loginsState.value = 'idle'
  } catch (e) {
    loginsError.value = e instanceof Error ? e.message : String(e)
    loginsState.value = 'error'
  }
}

export const addLogin = async (type: BasicAuthType, hostmask: string, username: string, password: string): Promise<void> => {
  await send('/api/basic-auth', { type, hostmask, username, password })
  await loadLogins()
}
// Only the given fields change; an empty password keeps the old one.
export const updateLogin = async (id: number, change: Partial<Omit<BasicAuth, 'id'>> & { password?: string }): Promise<void> => {
  await send('/api/basic-auth/update', { id, ...change })
  await loadLogins()
}
export const removeLogins = async (ids: number[]): Promise<void> => {
  await send('/api/basic-auth/remove', { ids })
  await loadLogins()
}
