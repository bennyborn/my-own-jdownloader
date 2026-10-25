import { decrypt, encrypt, hmacSha256Hex, sha256 } from './crypto.js'

const API_URL = 'https://api.jdownloader.org'
const APP_KEY = 'my-own-jdownloader'

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
    const res = await fetch(`${API_URL}${query}&signature=${signature}`)
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
    const res = await fetch(`${API_URL}${query}&signature=${signature}`)
    const data = JSON.parse(decrypt(await this.readBody(res), session.serverEncryptionToken))
    return data.list.map((d: Device) => ({ id: d.id, name: d.name, type: d.type, status: d.status }))
  }

  // Call an API action on a JDownloader device, e.g. callDevice(id, '/downloadsV2/queryPackages', [{...}]).
  // If the session has expired, reconnects once and retries.
  async callDevice<T = unknown>(deviceId: string, action: string, params: unknown[] = []): Promise<T> {
    try {
      return await this.sendDeviceCall<T>(deviceId, action, params)
    } catch (error) {
      if (!(error instanceof MyJdApiError) || !error.isSessionError) throw error
      await this.connect()
      return this.sendDeviceCall<T>(deviceId, action, params)
    }
  }

  private async sendDeviceCall<T>(deviceId: string, action: string, params: unknown[]): Promise<T> {
    const session = this.requireSession()
    const rid = this.nextRid()
    const body = encrypt(JSON.stringify({ url: action, params: params.map((p) => JSON.stringify(p)), rid, apiVer: 1 }), session.deviceEncryptionToken)
    const res = await fetch(`${API_URL}/t_${session.token}_${deviceId}${action}`, {
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
