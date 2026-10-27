import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionBundle } from './extension.js'

// Release Firefox installs only extensions signed by Mozilla. Everybody signs for themselves: the backend sends its Firefox package to
// addons.mozilla.org (AMO, unlisted: not published, signed only) with the AMO API keys of the owner and serves the signed file. Needs
// AMO_JWT_ISSUER / AMO_JWT_SECRET (addons.mozilla.org > Tools > Manage API Keys) and PUBLIC_URL (https, Firefox updates only over it).
// An add-on id belongs to one AMO account, so every installation has an id of its own (made once, or EXTENSION_FIREFOX_ID).

const AMO = 'https://addons.mozilla.org/api/v5'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface FirefoxEnv {
  publicUrl: string
  issuer?: string
  secret?: string
  firefoxId: string
}

// The id from EXTENSION_FIREFOX_ID, else one made at the first start and kept in the data folder.
export const firefoxIdFor = (dataDir: string): string => {
  if (process.env.EXTENSION_FIREFOX_ID) return process.env.EXTENSION_FIREFOX_ID
  const file = join(dataDir, 'firefox-id.txt')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const id = `extension-${randomBytes(6).toString('hex')}@my-own-jdownloader.local`
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(file, id + '\n')
  return id
}

// PUBLIC_URL without a trailing slash; empty (no Firefox package) unless it is an https address.
export const publicUrlFrom = (value: string | undefined): string => {
  const url = (value ?? '').trim().replace(/\/+$/, '')
  return url.startsWith('https://') ? url : ''
}

interface Meta {
  version: string
  fingerprint: string
  id: string
}

export type FirefoxState = { state: 'ready' } | { state: 'signing' } | { state: 'error'; error: string }

export class FirefoxPackage {
  private status: FirefoxState = { state: 'signing' }
  private signed?: { data: Buffer; sha256: string }
  private readonly dir: string

  constructor(
    private readonly bundle: ExtensionBundle,
    private readonly env: FirefoxEnv,
    dataDir: string,
    private readonly log: (message: string) => void
  ) {
    this.dir = join(dataDir, 'firefox')
  }

  get state(): FirefoxState {
    return this.status
  }

  get data(): Buffer | undefined {
    return this.signed?.data
  }

  // What Firefox asks at the `update_url`: the newest version and where to get it (the hash makes the download safe).
  updateManifest() {
    if (!this.signed) return undefined
    return {
      addons: {
        [this.env.firefoxId]: {
          updates: [{ version: this.bundle.version, update_link: `${this.env.publicUrl}/api/extension/firefox/extension.xpi`, update_hash: `sha256:${this.signed.sha256}` }]
        }
      }
    }
  }

  // Takes the signed package kept from an earlier start or has it signed; runs in the background, the state tells how far it is.
  async start(): Promise<void> {
    try {
      if (!this.env.issuer || !this.env.secret) throw new Error('AMO_JWT_ISSUER and AMO_JWT_SECRET are not set')
      const file = join(this.dir, `${this.bundle.version}.xpi`)
      const metaFile = join(this.dir, `${this.bundle.version}.json`)
      const meta: Meta = { version: this.bundle.version, fingerprint: this.bundle.fingerprint, id: this.env.firefoxId }
      let data: Buffer
      if (existsSync(file) && existsSync(metaFile)) {
        const kept = JSON.parse(readFileSync(metaFile, 'utf8')) as Meta
        // AMO signs every version of an add-on once: a changed package needs a new version.
        if (kept.fingerprint !== meta.fingerprint || kept.id !== meta.id)
          throw new Error(`Version ${meta.version} was signed before with other contents, address or id: raise "version" in extension/manifest.json`)
        data = readFileSync(file)
      } else {
        this.log(`Firefox extension ${meta.version}: signing at addons.mozilla.org…`)
        data = await this.sign(this.env.issuer, this.env.secret)
        mkdirSync(this.dir, { recursive: true })
        writeFileSync(file, data)
        writeFileSync(metaFile, JSON.stringify(meta))
      }
      this.signed = { data, sha256: createHash('sha256').update(data).digest('hex') }
      this.status = { state: 'ready' }
      this.log(`Firefox extension ${meta.version}: signed and ready`)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      this.status = { state: 'error', error }
      this.log(`Firefox extension: ${error} (a restart tries again)`)
    }
  }

  private token(issuer: string, secret: string): string {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const head = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 120 })}`
    return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`
  }

  private async amo(issuer: string, secret: string, path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(path.startsWith('http') ? path : AMO + path, {
      ...init,
      headers: { Authorization: `JWT ${this.token(issuer, secret)}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(60_000)
    })
  }

  private async json(res: Response, what: string): Promise<any> {
    const text = await res.text()
    if (!res.ok) throw new Error(`AMO: ${what} failed (${res.status}): ${text.slice(0, 400)}`)
    return JSON.parse(text)
  }

  // upload -> validation -> new add-on or new version of it -> the signed file.
  private async sign(issuer: string, secret: string): Promise<Buffer> {
    const { version } = this.bundle
    const id = this.env.firefoxId
    const form = new FormData()
    form.set('upload', new Blob([new Uint8Array(this.bundle.pack())]), `my-own-jdownloader-${version}.zip`)
    form.set('channel', 'unlisted')
    const upload = await this.json(await this.amo(issuer, secret, '/addons/upload/', { method: 'POST', body: form }), 'upload')

    let checked = upload
    for (let i = 0; !checked.processed && i < 100; i++) {
      await sleep(3000)
      checked = await this.json(await this.amo(issuer, secret, `/addons/upload/${upload.uuid}/`), 'validation')
    }
    if (!checked.processed) throw new Error('AMO: the validation takes too long')
    if (!checked.valid) {
      const errors = (checked.validation?.messages ?? []).filter((m: { type: string }) => m.type === 'error').map((m: { message: string }) => m.message)
      throw new Error(`AMO rejected the package: ${errors.join('; ') || 'invalid'}`)
    }

    const exists = await this.amo(issuer, secret, `/addons/addon/${encodeURIComponent(id)}/`)
    const json = { 'Content-Type': 'application/json' }
    if (exists.ok) {
      await this.json(await this.amo(issuer, secret, `/addons/addon/${encodeURIComponent(id)}/versions/`, { method: 'POST', headers: json, body: JSON.stringify({ upload: upload.uuid }) }), 'new version')
    } else if (exists.status === 404) {
      await this.json(await this.amo(issuer, secret, '/addons/addon/', { method: 'POST', headers: json, body: JSON.stringify({ version: { upload: upload.uuid } }) }), 'new add-on')
    } else {
      throw new Error(`AMO: asking for the add-on failed (${exists.status}): ${(await exists.text()).slice(0, 400)}`)
    }

    // Unlisted versions are signed automatically, mostly within a minute.
    let status = ''
    for (let i = 0; i < 120; i++) {
      const info = await this.json(await this.amo(issuer, secret, `/addons/addon/${encodeURIComponent(id)}/versions/v${version}/`), 'version')
      status = info.file?.status ?? ''
      if (info.file?.url && status === 'public') {
        const res = await this.amo(issuer, secret, info.file.url)
        if (!res.ok) throw new Error(`AMO: the signed file could not be fetched (${res.status})`)
        const data = Buffer.from(await res.arrayBuffer())
        if (!data.includes('META-INF/')) throw new Error('AMO: the file that came back carries no signature')
        return data
      }
      await sleep(5000)
    }
    throw new Error(`AMO: the version was not signed in time (status "${status}"): see its page at addons.mozilla.org/developers`)
  }
}
