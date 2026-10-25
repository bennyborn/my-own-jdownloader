import { ref } from 'vue'
import { settingsDevice, withDevice } from './devices'

export interface Account {
  uuid: number
  hostname: string
  username: string
  enabled: boolean
  valid: boolean
  error?: string
  errorString?: string
  validUntil?: number
  trafficLeft?: number
  trafficMax?: number
}

// The premium accounts of the shown device, see backend/src/accounts.ts.
export const accounts = ref<Account[]>([])
export const premiumHosters = ref<string[]>([])
export const accountsState = ref<'idle' | 'loading' | 'error'>('idle')
export const accountsError = ref('')

const failure = async (res: Response): Promise<Error> => new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)

const send = async (url: string, body: unknown): Promise<void> => {
  const res = await fetch(withDevice(url, settingsDevice.value), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw await failure(res)
}

export const loadAccounts = async (): Promise<void> => {
  if (!settingsDevice.value) return
  accountsState.value = 'loading'
  try {
    const res = await fetch(withDevice('/api/accounts', settingsDevice.value))
    if (!res.ok) throw await failure(res)
    accounts.value = await res.json()
    accountsState.value = 'idle'
  } catch (e) {
    accountsError.value = e instanceof Error ? e.message : String(e)
    accountsState.value = 'error'
  }
}

export const loadPremiumHosters = async (): Promise<void> => {
  try {
    const res = await fetch(withDevice('/api/accounts/hosters', settingsDevice.value))
    if (res.ok) premiumHosters.value = await res.json()
  } catch {
    /* only suggestions */
  }
}

export const addAccount = async (hostname: string, username: string, password: string): Promise<void> => {
  await send('/api/accounts', { hostname, username, password })
  await loadAccounts()
}
export const removeAccounts = async (ids: number[]): Promise<void> => {
  await send('/api/accounts/remove', { ids })
  await loadAccounts()
}
export const setAccountsEnabled = async (ids: number[], enabled: boolean): Promise<void> => {
  await send('/api/accounts/set-enabled', { ids, enabled })
  await loadAccounts()
}
export const setCredentials = async (id: number, username: string, password: string): Promise<void> => {
  await send('/api/accounts/credentials', { id, username, password })
  await loadAccounts()
}
// JD logs in again; the result takes a moment, so the list is read twice.
export const refreshAccounts = async (ids: number[]): Promise<void> => {
  await send('/api/accounts/refresh', { ids })
  await loadAccounts()
  setTimeout(() => void loadAccounts(), 4000)
}
