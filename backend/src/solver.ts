import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MyJdClient } from './myjd/client.js'

// JDownloader's (legacy) Anti-Captcha solver has a configurable server address. We register ourselves
// there, so that captchas JD cannot show in a browser (e.g. Cloudflare Turnstile) are sent to us.
// The previous settings are saved so they can be put back (solver-restore.ts).
const SETTINGS = ['ApiBase', 'ApiKey', 'Enabled'] as const
type Setting = (typeof SETTINGS)[number]

interface State {
  apiKey: string
  // The address we wrote into ApiBase last time, to recognise our own registration after JD_SOLVER_URL changed.
  base?: string
  previous?: Record<Setting, unknown>
}

interface Entry {
  interfaceName?: string
  storage?: string | null
  key?: string
  value?: unknown
}

// One registration per JDownloader device, each with its own state file and its own API key: the key JD sends
// in clientKey is what tells the Anti-Captcha endpoints which device a task belongs to.
export class SolverRegistration {
  private cached?: State

  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string,
    private readonly stateFile: string
  ) {}

  private load(): State {
    if (!this.cached) {
      this.cached = existsSync(this.stateFile) ? (JSON.parse(readFileSync(this.stateFile, 'utf8')) as State) : { apiKey: randomBytes(24).toString('hex') }
    }
    return this.cached
  }

  private save(state: State): void {
    this.cached = state
    mkdirSync(dirname(this.stateFile), { recursive: true })
    writeFileSync(this.stateFile, JSON.stringify(state), { mode: 0o600 })
  }

  // The key JD has to send in clientKey; our Anti-Captcha endpoints check it.
  get apiKey(): string {
    const state = this.load()
    if (!existsSync(this.stateFile)) this.save(state)
    return state.apiKey
  }

  private async entries(): Promise<Map<Setting, Entry>> {
    // pattern, returnDescription, returnValues, returnDefaultValues, returnEnumInfo
    const list = await this.client.callDevice<Entry[]>(this.deviceId, '/config/list', ['.*AntiCaptchaComConfigInterface.*', false, true, false, false])
    const found = new Map<Setting, Entry>()
    for (const e of list) if (SETTINGS.includes(e.key as Setting)) found.set(e.key as Setting, e)
    if (found.size !== SETTINGS.length) throw new Error('Anti-Captcha settings not found in the JDownloader config')
    return found
  }

  private set(entry: Entry, value: unknown): Promise<unknown> {
    return this.client.callDevice(this.deviceId, '/config/set', [entry.interfaceName, entry.storage ?? null, entry.key, value])
  }

  // Idempotent: only writes what differs. Never touches a JD where the user has set up an Anti-Captcha
  // service of their own (enabled, with a key, pointing somewhere other than here).
  async register(baseUrl: string): Promise<'registered' | 'unchanged' | 'own service in use'> {
    const state = this.load()
    const found = await this.entries()
    const wanted: Record<Setting, unknown> = { ApiBase: baseUrl.replace(/\/+$/, ''), ApiKey: state.apiKey, Enabled: true }
    const current = (k: Setting) => found.get(k)?.value
    const ours = current('ApiBase') === wanted.ApiBase || (state.base !== undefined && current('ApiBase') === state.base)
    if (!ours && current('Enabled') === true && typeof current('ApiKey') === 'string' && current('ApiKey') !== '') {
      // What we saved earlier is outdated now, restoring it later would overwrite the user's own setup.
      if (state.previous) {
        delete state.previous
        this.save(state)
      }
      return 'own service in use'
    }
    if (SETTINGS.every((k) => current(k) === wanted[k])) return 'unchanged'
    // Keep the original values only the first time (never overwrite them with our own).
    state.previous ??= Object.fromEntries(SETTINGS.map((k) => [k, found.get(k)?.value])) as Record<Setting, unknown>
    state.base = wanted.ApiBase as string
    this.save(state)
    for (const k of SETTINGS) if (found.get(k)?.value !== wanted[k]) await this.set(found.get(k)!, wanted[k])
    return 'registered'
  }

  async restore(): Promise<'restored' | 'nothing to restore'> {
    const state = this.load()
    if (!state.previous) return 'nothing to restore'
    const found = await this.entries()
    for (const k of SETTINGS) await this.set(found.get(k)!, state.previous[k])
    delete state.previous
    this.save(state)
    return 'restored'
  }
}

export interface SolverTask {
  id: number
  deviceId: string
  type: string
  websiteURL: string
  websiteKey: string
  created: number
  token?: string
}

// Captcha tasks JD sent to our Anti-Captcha endpoint. Only Turnstile: JD solves hCaptcha / reCAPTCHA
// through its own job list, which would otherwise show up twice. Kept in memory, they expire like JD's jobs.
export class SolverTasks {
  static readonly TTL_MS = 10 * 60 * 1000
  private readonly tasks = new Map<number, SolverTask>()
  private nextId = 1 // far below JD's own job ids (millisecond timestamps), so ids never collide

  static supports(type: unknown): boolean {
    return typeof type === 'string' && /^Turnstile/i.test(type)
  }

  private prune(): void {
    const limit = Date.now() - SolverTasks.TTL_MS
    for (const [id, t] of this.tasks) if (t.created < limit) this.tasks.delete(id)
  }

  // One list for all devices, so the ids stay unique across devices.
  create(deviceId: string, type: string, websiteURL: string, websiteKey: string): SolverTask {
    this.prune()
    const task: SolverTask = { id: this.nextId++, deviceId, type, websiteURL, websiteKey, created: Date.now() }
    this.tasks.set(task.id, task)
    return task
  }

  get(id: number): SolverTask | undefined {
    this.prune()
    return this.tasks.get(id)
  }

  has(id: number): boolean {
    return this.get(id) !== undefined
  }

  solve(id: number, token: string): boolean {
    const task = this.get(id)
    if (!task) return false
    task.token = token
    return true
  }

  // Unsolved tasks in the shape of the captcha job list.
  jobs(deviceId?: string): { id: number; hoster: string; challengeType: string; remaining: number; timeout: number; kind: 'widget'; source: 'solver' }[] {
    this.prune()
    return [...this.tasks.values()]
      .filter((t) => !t.token && (deviceId === undefined || t.deviceId === deviceId))
      .map((t) => ({
        id: t.id,
        hoster: new URL(t.websiteURL).hostname,
        challengeType: 'CloudflareTurnstile',
        remaining: Math.max(0, t.created + SolverTasks.TTL_MS - Date.now()),
        timeout: SolverTasks.TTL_MS,
        kind: 'widget' as const,
        source: 'solver' as const
      }))
  }

  details(task: SolverTask) {
    return { ...this.jobs().find((j) => j.id === task.id) ?? { id: task.id, hoster: new URL(task.websiteURL).hostname, challengeType: 'CloudflareTurnstile', remaining: 0, timeout: SolverTasks.TTL_MS, kind: 'widget' as const, source: 'solver' as const }, siteKey: task.websiteKey, siteUrl: task.websiteURL, boundToDomain: true, raw: { type: task.type } }
  }
}
