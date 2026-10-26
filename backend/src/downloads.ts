import type { MyJdClient } from './myjd/client.js'

// What JD reports about unpacking: queued / running, done (successful) or failed. Undefined: nothing to unpack.
export type Extraction = 'queued' | 'running' | 'done' | 'error'

const extractionOf = (status?: string, text?: string): Extraction | undefined => {
  if (status === 'RUNNING' || /^extracting/i.test(text ?? '')) return 'running'
  if (status === 'QUEUED') return 'queued'
  if (status === 'SUCCESSFUL' || /^extraction ok/i.test(text ?? '')) return 'done'
  if (status?.startsWith('ERROR') || /^extraction error/i.test(text ?? '')) return 'error'
  return undefined
}

export interface DownloadPackage {
  uuid: number
  name: string
  saveTo?: string
  enabled: boolean
  running: boolean
  finished: boolean
  extraction?: Extraction
  status?: string
  speed: number
  eta?: number
  bytesLoaded: number
  bytesTotal: number
  childCount: number
  hosts: string[]
  // Hosts of the links that are running right now (downloading, waiting or waiting for a captcha)
  activeHosts: string[]
  stopMarked?: boolean // JD stops before this package's downloads (a stop mark sits on the package itself)
}

export interface DownloadsSnapshot {
  updatedAt: number
  packages: DownloadPackage[]
  totalSpeed: number
  linkCount: number
  runningDownloads: number
}

export interface DownloadLink {
  uuid: number
  name: string
  host?: string
  enabled: boolean
  running: boolean
  finished: boolean
  skipped: boolean
  extraction?: Extraction
  status?: string
  speed: number
  eta?: number
  bytesLoaded: number
  bytesTotal: number
  forced?: boolean // force-started through us and not finished yet
  stopMarked?: boolean // JD stops at this link
}

type Listener = (snapshot: DownloadsSnapshot) => void

// Polls the device only while at least one listener is subscribed (read-only).
export class DownloadsPoller {
  private snapshot: DownloadsSnapshot = { updatedAt: 0, packages: [], totalSpeed: 0, linkCount: 0, runningDownloads: 0 }
  private listeners = new Set<Listener>()
  private timer?: NodeJS.Timeout
  private polling = false
  private snapshotEpoch = -1 // what the client's change counter said when the snapshot was taken

  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string,
    private readonly intervalMs = 3000
  ) {}

  getSnapshot(): DownloadsSnapshot {
    return this.snapshot
  }

  // Whether anybody watches (a page with the live view open): the speed sampler is quicker then.
  hasListeners(): boolean {
    return this.listeners.size > 0
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (!this.timer) {
      void this.poll()
      this.timer = setInterval(() => void this.poll(), this.intervalMs)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = undefined
      }
    }
  }

  // JD's API does not say which links were force-started, so we remember what was forced through us (until the backend restarts).
  private readonly forcedLinks = new Map<number, number>() // link uuid -> time of the force
  private readonly forcedPackages = new Map<number, number>()

  markForced(linkIds: number[], packageIds: number[]): void {
    const now = Date.now()
    for (const id of linkIds) this.forcedLinks.set(id, now)
    for (const id of packageIds) this.forcedPackages.set(id, now)
  }

  // A forced item that is neither running nor finished shortly after the force was dropped by JD, so the mark ends there.
  private isForced(l: { uuid: number; running: boolean; finished: boolean }, packageUuid: number): boolean {
    const since = this.forcedLinks.get(l.uuid) ?? this.forcedPackages.get(packageUuid)
    if (since === undefined) return false
    if (l.finished || (!l.running && Date.now() - since > 30_000)) {
      this.forcedLinks.delete(l.uuid)
      return false
    }
    return true
  }

  // Read-only: uuid of the link or package carrying JD's stop mark (there is at most one); -1 when there is none.
  private async getStopMark(): Promise<number> {
    try {
      const mark = await this.client.callDevice<number>(this.deviceId, '/downloadsV2/getStopMark', [])
      return typeof mark === 'number' ? mark : -1
    } catch {
      return -1
    }
  }

  // Read-only: links (parts) of a single package.
  async getLinks(packageUuid: number): Promise<DownloadLink[]> {
    const stopMark = await this.getStopMark()
    const raw = await this.client.callDevice<(Partial<DownloadLink> & { extractionStatus?: string })[]>(this.deviceId, '/downloadsV2/queryLinks', [
      {
        packageUUIDs: [packageUuid],
        maxResults: -1,
        startAt: 0,
        host: true,
        bytesLoaded: true,
        bytesTotal: true,
        status: true,
        finished: true,
        running: true,
        skipped: true,
        extractionStatus: true,
        speed: true,
        eta: true,
        enabled: true
      }
    ])
    return raw.map((l) => ({
      uuid: l.uuid ?? 0,
      name: l.name ?? '',
      host: l.host,
      enabled: l.enabled === true,
      running: l.running ?? false,
      finished: l.finished ?? false,
      skipped: l.skipped ?? false,
      extraction: extractionOf(l.extractionStatus, l.status),
      status: l.status,
      speed: l.speed ?? 0,
      eta: l.eta,
      bytesLoaded: l.bytesLoaded ?? 0,
      bytesTotal: l.bytesTotal ?? 0,
      forced: this.isForced({ uuid: l.uuid ?? 0, running: l.running ?? false, finished: l.finished ?? false }, packageUuid),
      stopMarked: l.uuid !== undefined && l.uuid === stopMark
    }))
  }

  // Read-only: the source URLs of a package's links.
  async getUrls(packageUuid: number): Promise<string[]> {
    const raw = await this.client.callDevice<{ url?: string }[]>(this.deviceId, '/downloadsV2/queryLinks', [
      { packageUUIDs: [packageUuid], maxResults: -1, startAt: 0, url: true }
    ])
    return [...new Set(raw.map((l) => l.url).filter((u): u is string => typeof u === 'string' && u !== ''))]
  }

  // Reorders packages in the download list. afterPackageId -1 means "to the top".
  // Only changes the order; running downloads are not touched.
  async movePackages(packageIds: number[], afterPackageId: number): Promise<void> {
    // One call per package: the order of several ids in a single call is up to JD.
    for (let i = 0; i < packageIds.length; i++) await this.client.callDevice(this.deviceId, '/downloadsV2/movePackages', [[packageIds[i]], i === 0 ? afterPackageId : packageIds[i - 1]])
  }

  // Reorders links inside ONE package (never moves them to another package).
  async moveLinks(packageId: number, linkIds: number[], afterLinkId: number): Promise<void> {
    const links = await this.getLinks(packageId)
    const known = new Set(links.map((l) => l.uuid))
    if (!linkIds.every((id) => known.has(id)) || (afterLinkId !== -1 && !known.has(afterLinkId))) {
      throw new Error('Links must all belong to the given package')
    }
    // One call per link: the order of several ids in a single call is up to JD.
    for (let i = 0; i < linkIds.length; i++) await this.client.callDevice(this.deviceId, '/downloadsV2/moveLinks', [[linkIds[i]], i === 0 ? afterLinkId : linkIds[i - 1], packageId])
  }

  // Asks the device now. maxAgeMs > 0: a snapshot that young is good enough (several clients asking within moments share one look).
  // Not when something was changed since that look: then the snapshot cannot be true any more.
  async refresh(maxAgeMs = 0): Promise<DownloadsSnapshot> {
    if (maxAgeMs > 0 && Date.now() - this.snapshot.updatedAt < maxAgeMs && this.snapshotEpoch === this.client.epoch(this.deviceId)) return this.snapshot
    await this.poll()
    return this.snapshot
  }

  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    const epoch = this.client.epoch(this.deviceId)
    try {
      const stopMark = await this.getStopMark()
      const raw = await this.client.callDevice<Partial<DownloadPackage>[]>(
        this.deviceId,
        '/downloadsV2/queryPackages',
        [
          {
            maxResults: -1,
            startAt: 0,
            saveTo: true,
            bytesLoaded: true,
            bytesTotal: true,
            status: true,
            finished: true,
            running: true,
            speed: true,
            eta: true,
            childCount: true,
            hosts: true,
            enabled: true
          }
        ]
      )
      const packages: DownloadPackage[] = raw.map((p) => ({
        uuid: p.uuid ?? 0,
        name: p.name ?? '',
        saveTo: p.saveTo,
        enabled: p.enabled === true,
        running: p.running ?? false,
        finished: p.finished ?? false,
        status: p.status,
        speed: p.speed ?? 0,
        eta: p.eta,
        bytesLoaded: p.bytesLoaded ?? 0,
        bytesTotal: p.bytesTotal ?? 0,
        childCount: p.childCount ?? 0,
        hosts: p.hosts ?? [],
        activeHosts: [],
        stopMarked: p.uuid !== undefined && p.uuid === stopMark
      }))
      // Minimal link query (all packages) just to count links and running downloads.
      const links = await this.client.callDevice<{ running?: boolean; host?: string; packageUUID?: number; extractionStatus?: string; status?: string }[]>(this.deviceId, '/downloadsV2/queryLinks', [
        { maxResults: -1, startAt: 0, running: true, host: true, packageUUID: true, extractionStatus: true, status: true }
      ])
      // A package unpacks while any of its links does; failed beats done.
      const rank: Record<Extraction, number> = { running: 4, queued: 3, error: 2, done: 1 }
      for (const l of links) {
        const extraction = extractionOf(l.extractionStatus, l.status)
        const owner = extraction ? packages.find((p) => p.uuid === l.packageUUID) : undefined
        if (owner && extraction && (!owner.extraction || rank[extraction] > rank[owner.extraction])) owner.extraction = extraction
      }
      for (const l of links) {
        const pkg = l.running && l.host ? packages.find((p) => p.uuid === l.packageUUID) : undefined
        if (pkg && !pkg.activeHosts.includes(l.host!)) pkg.activeHosts.push(l.host!)
      }
      this.snapshotEpoch = epoch
      this.snapshot = {
        updatedAt: Date.now(),
        packages,
        totalSpeed: packages.reduce((sum, p) => sum + p.speed, 0),
        linkCount: links.length,
        runningDownloads: links.filter((l) => l.running).length
      }
      for (const listener of this.listeners) listener(this.snapshot)
    } catch (error) {
      console.error('Polling downloads failed:', error instanceof Error ? error.message : error)
    } finally {
      this.polling = false
    }
  }
}
