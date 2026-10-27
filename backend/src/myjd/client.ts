import { Shared } from '../shared.js'
import { decrypt, encrypt, hmacSha256Hex, sha256 } from './crypto.js'

const API_URL = 'https://api.jdownloader.org'
// A call that does not come back within this time fails (a hanging answer would otherwise block its caller, and the pollers with it).
const TIMEOUT_MS = 20_000
const APP_KEY = 'my-own-jdownloader'

// The MyJDownloader API is not ours: whatever the clients of this backend do, it sees little. Three rules, all here:
// 1. Reads that every client asks for all the time are answered from a short memory (READ_TTL_MS): any number of clients costs one call.
//    The memory of a device is dropped as soon as anything that could change it goes through (see callDevice).
// 2. At most MAX_PARALLEL calls at a time and a minimum gap between two starts; the rest waits its turn.
// 3. After a 429 ("too many requests") everything waits, longer each time it happens again.
const MAX_PARALLEL = 8
const MIN_GAP_MS = 30
const MAX_PAUSE_MS = 60_000

// Action -> how long (ms) the answer is kept. The lists the live views poll are short, configuration lives longer.
const READ_TTL_MS: Record<string, number> = {
  '/downloadsV2/queryPackages': 1000,
  '/downloadsV2/queryLinks': 1500,
  '/downloadsV2/getStopMark': 3000,
  '/downloadcontroller/getCurrentState': 1000,
  '/linkgrabberv2/queryPackages': 1500,
  '/linkgrabberv2/queryLinks': 1500,
  '/linkgrabberv2/isCollecting': 1500,
  '/linkgrabberv2/getDownloadFolderHistorySelectionBase': 30_000,
  '/captcha/list': 2000,
  '/config/list': 30_000,
  '/accountsV2/listAccounts': 10_000,
  '/accountsV2/listPremiumHoster': 60_000,
  '/update/isUpdateAvailable': 60_000
}
// Reads that are not kept but do not change anything either. Every other action may change something: it drops the memory.
const NEUTRAL = /\/(getSpeedInBps|getDownloadUrls|getVariants|getArchiveInfo|getArchiveSettings)$|^\/captcha\/get$/

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface Device {
  id: string
  name: string
  type: string
  status?: string
}

interface Session {
  token: string
  regainToken: string
  serverEncryptionToken: Buffer
  deviceEncryptionToken: Buffer
}

export class MyJdApiError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`MyJDownloader API error ${status}: ${body}`)
  }

  // Error bodies of device calls are encrypted like normal responses.
  withDecryptedBody(secret: Buffer): MyJdApiError {
    try {
      return new MyJdApiError(this.status, decrypt(this.body, secret))
    } catch {
      return this
    }
  }

  get isSessionError(): boolean {
    return this.status === 403 || /TOKEN_INVALID|AUTH_FAILED/.test(this.body)
  }
}

export class MyJdClient {
  private readonly loginSecret: Buffer
  private readonly deviceSecret: Buffer
  private session?: Session
  private reconnecting?: Promise<void>
  private readonly reads = new Shared()
  // Per device: counts the actions that may change something. Part of the key of a kept answer, so an answer from before the
  // change is never served after it (and one that was under way during it is not kept for the new state).
  private readonly epochs = new Map<string, number>()
  // Requests sent to the API so far (shown by /api/health: the way to see that an idle backend really is idle).
  calls = 0
  private active = 0
  private readonly waiting: (() => void)[] = []
  private lastStart = 0
  private pausedUntil = 0
  private pauseMs = 0
  private rid = Date.now()

  constructor(private readonly email: string, password: string) {
    const normalizedEmail = email.toLowerCase()
    this.loginSecret = sha256(Buffer.from(normalizedEmail + password + 'server'))
    this.deviceSecret = sha256(Buffer.from(normalizedEmail + password + 'device'))
  }

  private nextRid(): number {
    return ++this.rid
  }

  async connect(): Promise<void> {
    const query = `/my/connect?email=${encodeURIComponent(this.email)}&appkey=${APP_KEY}&rid=${this.nextRid()}`
    const signature = hmacSha256Hex(query, this.loginSecret)
    const res = await this.fetchLimited(`${API_URL}${query}&signature=${signature}`)
    const data = JSON.parse(decrypt(await this.readBody(res), this.loginSecret))
    const sessionToken = Buffer.from(data.sessiontoken, 'hex')
    this.session = {
      token: data.sessiontoken,
      regainToken: data.regaintoken,
      serverEncryptionToken: sha256(this.loginSecret, sessionToken),
      deviceEncryptionToken: sha256(this.deviceSecret, sessionToken)
    }
  }

  async listDevices(): Promise<Device[]> {
    const session = this.requireSession()
    const query = `/my/listdevices?sessiontoken=${session.token}&rid=${this.nextRid()}`
    const signature = hmacSha256Hex(query, session.serverEncryptionToken)
    const res = await this.fetchLimited(`${API_URL}${query}&signature=${signature}`)
    const data = JSON.parse(decrypt(await this.readBody(res), session.serverEncryptionToken))
    return data.list.map((d: Device) => ({ id: d.id, name: d.name, type: d.type, status: d.status }))
  }

  // Call an API action on a JDownloader device, e.g. callDevice(id, '/downloadsV2/queryPackages', [{...}]).
  // Reads from READ_TTL_MS are served from memory when they are young enough; any other action that is not known to be a pure read
  // counts as a change and makes the device forget what it kept.
  async callDevice<T = unknown>(deviceId: string, action: string, params: unknown[] = []): Promise<T> {
    const ttl = READ_TTL_MS[action]
    if (ttl) {
      const key = `${deviceId}\0${this.epoch(deviceId)}\0${action}\0${JSON.stringify(params)}`
      return this.reads.get(key, ttl, () => this.callDeviceNow<T>(deviceId, action, params))
    }
    if (NEUTRAL.test(action)) return this.callDeviceNow<T>(deviceId, action, params)
    this.epochs.set(deviceId, this.epoch(deviceId) + 1)
    try {
      return await this.callDeviceNow<T>(deviceId, action, params)
    } finally {
      this.epochs.set(deviceId, this.epoch(deviceId) + 1)
    }
  }

  // Changes counted so far for the device; the pollers use it to know whether a snapshot of theirs can still be true.
  epoch(deviceId: string): number {
    return this.epochs.get(deviceId) ?? 0
  }

  // If the session has expired, reconnects once and retries.
  private async callDeviceNow<T>(deviceId: string, action: string, params: unknown[]): Promise<T> {
    const used = this.session
    try {
      return await this.sendDeviceCall<T>(deviceId, action, params)
    } catch (error) {
      if (!(error instanceof MyJdApiError) || !error.isSessionError) throw error
      // Calls that fail at the same time share one login (and one that finds a newer session already in place just retries).
      if (this.session === used) await this.reconnect()
      return this.sendDeviceCall<T>(deviceId, action, params)
    }
  }

  private reconnect(): Promise<void> {
    this.reconnecting ??= this.connect().finally(() => {
      this.reconnecting = undefined
    })
    return this.reconnecting
  }

  private async sendDeviceCall<T>(deviceId: string, action: string, params: unknown[]): Promise<T> {
    const session = this.requireSession()
    const rid = this.nextRid()
    const body = encrypt(JSON.stringify({ url: action, params: params.map((p) => JSON.stringify(p)), rid, apiVer: 1 }), session.deviceEncryptionToken)
    const res = await this.fetchLimited(`${API_URL}/t_${session.token}_${deviceId}${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/aesjson-jd; charset=utf-8' },
      body
    })
    let text: string
    try {
      text = await this.readBody(res)
    } catch (error) {
      if (error instanceof MyJdApiError) throw error.withDecryptedBody(session.deviceEncryptionToken)
      throw error
    }
    let data: { data: T }
    try {
      data = JSON.parse(decrypt(text, session.deviceEncryptionToken))
    } catch (error) {
      // The Click'n'Load (flash) API answers in plain text, not encrypted; the call itself went through.
      if (/^\/flash\//i.test(action)) return undefined as T
      throw error
    }
    return data.data as T
  }

  // Every request to the API passes here: its turn (MAX_PARALLEL, MIN_GAP_MS, the pause after a 429) and the time limit.
  private async fetchLimited(url: string, init?: RequestInit): Promise<Response> {
    if (this.active >= MAX_PARALLEL) await new Promise<void>((resolve) => this.waiting.push(resolve)) // the call that ends hands its place over
    else this.active++
    try {
      const startAt = Math.max(Date.now(), this.pausedUntil, this.lastStart + MIN_GAP_MS)
      this.lastStart = startAt
      if (startAt > Date.now()) await sleep(startAt - Date.now())
      this.calls++
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
      // Only a 429 slows everybody down: a timeout or a 5xx is often one device that is offline, and the others must not suffer for it.
      if (res.status === 429) {
        this.pauseMs = Math.min(this.pauseMs ? this.pauseMs * 2 : 2000, MAX_PAUSE_MS)
        this.pausedUntil = Date.now() + this.pauseMs
      } else this.pauseMs = 0
      return res
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active--
    }
  }

  private requireSession(): Session {
    if (!this.session) throw new Error('Not connected, call connect() first')
    return this.session
  }

  private async readBody(res: Response): Promise<string> {
    const text = await res.text()
    if (!res.ok) throw new MyJdApiError(res.status, text.slice(0, 200))
    return text
  }
}
