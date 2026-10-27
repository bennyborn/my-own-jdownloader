import type { MyJdClient } from './myjd/client.js'

// The premium accounts of one JDownloader (/accountsV2). Passwords only ever go to the device, never back.
export interface Account {
  uuid: number
  hostname: string
  username: string
  enabled: boolean
  valid: boolean
  // e.g. EXPIRED, INVALID, TEMP_DISABLED, as JD names them; errorString is its own text, if any
  error?: string
  errorString?: string
  // Epoch ms; absent when unlimited / unknown
  validUntil?: number
  // Bytes; absent when unlimited / unknown
  trafficLeft?: number
  trafficMax?: number
}

interface RawAccount {
  uuid: number
  hostname?: string
  username?: string
  enabled?: boolean
  valid?: boolean
  errorType?: string
  errorString?: string
  validUntil?: number
  trafficLeft?: number
  trafficMax?: number
}

const QUERY = { startAt: 0, maxResults: -1, userName: true, validUntil: true, trafficLeft: true, trafficMax: true, enabled: true, valid: true, error: true }

// JD leaves out false and -1, so a missing flag means "no".
const known = (n: number | undefined): number | undefined => (typeof n === 'number' && n >= 0 ? n : undefined)

const toAccount = (a: RawAccount): Account => ({
  uuid: a.uuid,
  hostname: a.hostname ?? '',
  username: a.username ?? '',
  enabled: a.enabled === true,
  valid: a.valid === true,
  error: a.errorType,
  errorString: a.errorString,
  validUntil: known(a.validUntil),
  trafficLeft: known(a.trafficLeft),
  trafficMax: known(a.trafficMax)
})

// A login for plain HTTP / FTP sites (JD: "Basic authentication"). The list never contains the passwords.
export const BASIC_AUTH_TYPES = ['HTTP', 'FTP'] as const
export type BasicAuthType = (typeof BASIC_AUTH_TYPES)[number]
export interface BasicAuth {
  id: number
  type: BasicAuthType
  hostmask: string
  username: string
  enabled: boolean
}
export interface BasicAuthChange {
  type: BasicAuthType
  hostmask: string
  username: string
  // Empty on an edit keeps the old one
  password: string
  enabled: boolean
}

const HOSTERS_TTL_MS = 3600 * 1000

export class Accounts {
  private hosters?: { at: number; list: string[] }

  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string
  ) {}

  async list(): Promise<Account[]> {
    const raw = await this.client.callDevice<RawAccount[]>(this.deviceId, '/accountsV2/listAccounts', [QUERY])
    return raw.map(toAccount)
  }

  // The hosters JD has a premium plugin for (the choice when adding an account).
  async premiumHosters(): Promise<string[]> {
    if (!this.hosters || Date.now() - this.hosters.at > HOSTERS_TTL_MS) {
      this.hosters = { at: Date.now(), list: await this.client.callDevice<string[]>(this.deviceId, '/accountsV2/listPremiumHoster', []) }
    }
    return this.hosters.list
  }

  add(hostname: string, username: string, password: string): Promise<unknown> {
    return this.client.callDevice(this.deviceId, '/accountsV2/addAccount', [hostname, username, password])
  }

  remove(ids: number[]): Promise<unknown> {
    return this.client.callDevice(this.deviceId, '/accountsV2/removeAccounts', [ids])
  }

  setEnabled(ids: number[], enabled: boolean): Promise<unknown> {
    return this.client.callDevice(this.deviceId, enabled ? '/accountsV2/enableAccounts' : '/accountsV2/disableAccounts', [ids])
  }

  setCredentials(id: number, username: string, password: string): Promise<unknown> {
    return this.client.callDevice(this.deviceId, '/accountsV2/setUserNameAndPassword', [id, username, password])
  }

  // Makes JD log in again and update validity and traffic.
  refresh(ids: number[]): Promise<unknown> {
    return this.client.callDevice(this.deviceId, '/accountsV2/refreshAccounts', [ids])
  }

  async basicAuths(): Promise<BasicAuth[]> {
    const raw = await this.client.callDevice<{ id: number; type?: string; hostmask?: string; username?: string; enabled?: boolean }[]>(this.deviceId, '/accountsV2/listBasicAuth', [])
    return raw.map((a) => ({ id: a.id, type: a.type === 'FTP' ? 'FTP' : 'HTTP', hostmask: a.hostmask ?? '', username: a.username ?? '', enabled: a.enabled === true }))
  }

  addBasicAuth(a: Pick<BasicAuthChange, 'type' | 'hostmask' | 'username' | 'password'>): Promise<unknown> {
    return this.client.callDevice(this.deviceId, '/accountsV2/addBasicAuth', [a.type, a.hostmask, a.username, a.password])
  }

  // Only the given fields change (JD leaves out the rest); an empty password stays as it is.
  updateBasicAuth(id: number, change: Partial<BasicAuthChange>): Promise<unknown> {
    const { password, ...rest } = change
    return this.client.callDevice(this.deviceId, '/accountsV2/updateBasicAuth', [{ id, ...rest, ...(password ? { password } : {}) }])
  }

  removeBasicAuths(ids: number[]): Promise<unknown> {
    return this.client.callDevice(this.deviceId, '/accountsV2/removeBasicAuths', [ids])
  }
}
