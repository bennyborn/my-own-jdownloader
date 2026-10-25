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
}
