import { activity } from './activity.js'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BandwidthHistory } from './bandwidth.js'
import { Accounts } from './accounts.js'
import { Captchas } from './captcha.js'
import { JdConfig } from './jdconfig.js'
import { DownloadsPoller } from './downloads.js'
import { Linkgrabber } from './linkgrabber.js'
import { ListOps } from './listops.js'
import { SolverRegistration } from './solver.js'
import type { Device, MyJdClient } from './myjd/client.js'

// Everything that talks to one JDownloader device.
export class DeviceContext {
  readonly poller: DownloadsPoller
  readonly grabber: Linkgrabber
  readonly captchas: Captchas
  readonly bandwidth: BandwidthHistory
  readonly solver: SolverRegistration
  readonly config: JdConfig
  readonly accounts: Accounts
  readonly listOps: { downloads: ListOps; linkgrabber: ListOps }

  constructor(
    client: MyJdClient,
    readonly device: Device,
    solverStateFile: string,
    onStatus?: (context: DeviceContext, online: boolean) => void
  ) {
    this.poller = new DownloadsPoller(client, device.id)
    this.grabber = new Linkgrabber(client, device.id)
    this.captchas = new Captchas(client, device.id)
    this.bandwidth = new BandwidthHistory(client, device.id)
    this.bandwidth.mode = () => (this.poller.hasListeners() || activity.viewing ? 'fast' : 'off')
    this.bandwidth.onChange = (online) => onStatus?.(this, online)
    this.solver = new SolverRegistration(client, device.id, solverStateFile)
    this.config = new JdConfig(client, device.id)
    this.accounts = new Accounts(client, device.id)
    this.listOps = { downloads: new ListOps(client, device.id, 'downloads'), linkgrabber: new ListOps(client, device.id, 'linkgrabber') }
  }

  // MyJDownloader drops devices from its list soon after they went offline; we keep them (see DeviceRegistry).
  listed = true

  get id(): string {
    return this.device.id
  }

  // undefined until the first sample came back. The bandwidth sampler asks the device every few seconds (only while somebody watches, else looked up when asked (see BandwidthHistory.probe)) anyway,
  // so it doubles as the reachability check (the device list's own status field is always UNKNOWN).
  get online(): boolean | undefined {
    return this.listed ? this.bandwidth.online : false
  }
}

export interface DeviceInfo {
  id: string
  name: string
  type: string
  online: boolean | undefined
  default: boolean
}

export class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message)
  }
}

// How long a device may stay offline before we forget it.
const FORGET_AFTER_MS = 14 * 24 * 3600 * 1000

// All JDownloader devices of the account (optionally narrowed to a list of names) and their contexts.
// MyJDownloader stops listing a device soon after it went offline, but it should stay in the device choice
// (greyed out), so the devices we have seen are remembered in a file. The list is refreshed regularly,
// so devices that come or go show up without a restart.
export class DeviceRegistry {
  private readonly contexts = new Map<string, DeviceContext>()
  private readonly lastSeen = new Map<string, number>()
  private defaultId?: string
  private readonly knownFile: string

  constructor(
    private readonly client: MyJdClient,
    private readonly options: { only?: string[]; defaultName?: string; legacySolverFile: string; onOnline?: (context: DeviceContext) => void; onStatus?: (context: DeviceContext, online: boolean) => void }
  ) {
    this.knownFile = join(dirname(options.legacySolverFile), 'devices.json')
  }

  async start(): Promise<void> {
    await this.refresh()
    // Do not wait for devices that never answer, the first samples just fill in the online state.
    await Promise.race([Promise.all([...this.contexts.values()].map((c) => c.bandwidth.ready)), new Promise((resolve) => setTimeout(resolve, 8000))])
  }

  private loadKnown(): Device[] {
    try {
      const saved = JSON.parse(readFileSync(this.knownFile, 'utf8')) as (Device & { lastSeen: number })[]
      return saved.filter((d) => Date.now() - d.lastSeen < FORGET_AFTER_MS).map(({ lastSeen, ...device }) => (this.lastSeen.set(device.id, lastSeen), device))
    } catch {
      return []
    }
  }

  private saveKnown(): void {
    const saved = this.all().map((c) => ({ ...c.device, lastSeen: this.lastSeen.get(c.id) ?? Date.now() }))
    mkdirSync(dirname(this.knownFile), { recursive: true })
    writeFileSync(this.knownFile, JSON.stringify(saved), { mode: 0o600 })
  }

  // The list of devices of the account, looked up when somebody asks and the last look is older than maxAgeMs (no timer: a backend nobody
  // talks to does not ask MyJDownloader). Callers at the same time share one call.
  private lastRefreshAt = 0
  private refreshing?: Promise<void>

  freshen(maxAgeMs = 60_000): Promise<void> {
    if (Date.now() - this.lastRefreshAt < maxAgeMs) return Promise.resolve()
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  async refresh(): Promise<void> {
    this.lastRefreshAt = Date.now()
    const wanted = (d: Device) => !this.options.only?.length || this.options.only.includes(d.name)
    const listed = (await this.client.listDevices()).filter(wanted)
    const listedIds = new Set(listed.map((d) => d.id))
    const first = this.contexts.size === 0
    const now = Date.now()
    for (const d of listed) this.lastSeen.set(d.id, now)

    // A device that logs in again under a new id (e.g. a recreated container) leaves its old entry behind;
    // an offline device whose name is taken by a listed one is that leftover.
    const listedNames = new Set(listed.map((d) => d.name))
    const superseded = (d: Device) => !listedIds.has(d.id) && listedNames.has(d.name)
    // Devices that are currently offline: the remembered ones, as long as they are not too old.
    const remembered = first ? this.loadKnown().filter((d) => wanted(d) && !listedIds.has(d.id) && !superseded(d)) : []
    for (const [id, context] of this.contexts) {
      if (!listedIds.has(id) && (superseded(context.device) || now - (this.lastSeen.get(id) ?? 0) >= FORGET_AFTER_MS)) {
        context.bandwidth.stop()
        this.contexts.delete(id)
        this.lastSeen.delete(id)
      }
    }

    const preferred = listed.find((d) => d.name === this.options.defaultName) ?? listed[0]
    if (!this.defaultId || (!listedIds.has(this.defaultId) && preferred)) this.defaultId = preferred?.id ?? this.defaultId
    const defaultOf = (id: string) => id === (this.defaultId ?? remembered.find((d) => d.name === this.options.defaultName)?.id)

    for (const device of [...listed, ...remembered]) {
      const isListed = listedIds.has(device.id)
      let context = this.contexts.get(device.id)
      if (!context) {
        context = new DeviceContext(this.client, { ...device }, this.solverStateFile(device.id, defaultOf(device.id)), this.options.onStatus)
        context.listed = isListed
        this.contexts.set(device.id, context)
        if (isListed) context.bandwidth.start()
        if (isListed) this.options.onOnline?.(context)
        continue
      }
      context.device.name = device.name
      if (isListed && !context.listed) {
        // Back again.
        context.listed = true
        context.bandwidth.start()
        this.options.onOnline?.(context)
      }
    }
    // Gone from the list: keep the context, but stop asking it.
    for (const context of this.contexts.values()) {
      if (listedIds.has(context.id) || !context.listed) continue
      context.listed = false
      context.bandwidth.stop()
    }
    this.saveKnown()
  }

  // Before several devices were supported there was one state file; it belongs to the device used back then.
  private solverStateFile(deviceId: string, isDefault: boolean): string {
    const file = join(dirname(this.options.legacySolverFile), `solver-${deviceId.replace(/[^\w-]/g, '_')}.json`)
    if (isDefault && !existsSync(file) && existsSync(this.options.legacySolverFile)) renameSync(this.options.legacySolverFile, file)
    return file
  }

  all(): DeviceContext[] {
    return [...this.contexts.values()]
  }

  list(): DeviceInfo[] {
    return this.all().map((c) => ({ id: c.id, name: c.device.name, type: c.device.type, online: c.online, default: c.id === this.defaultId }))
  }

  // The device of a request: the given id, or the default device.
  resolve(id?: string): DeviceContext {
    const context = this.contexts.get(id || this.defaultId || '')
    if (!context) throw new HttpError(id ? 404 : 503, id ? 'Unknown device' : 'No JDownloader device found on this account')
    return context
  }

  // The device a captcha solver key belongs to.
  bySolverKey(key: unknown): DeviceContext | undefined {
    if (typeof key !== 'string' || !key) return undefined
    return this.all().find((c) => c.solver.apiKey === key)
  }

  stop(): void {
    for (const c of this.contexts.values()) c.bandwidth.stop()
  }
}

export const legacySolverFile = (): string => process.env.SOLVER_STATE_FILE ?? './data/solver.json'
