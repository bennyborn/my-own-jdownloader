import type { MyJdClient } from './myjd/client.js'

export interface DownloadPackage {
  uuid: number
  name: string
  saveTo?: string
  enabled: boolean
  running: boolean
  finished: boolean
  status?: string
  speed: number
  eta?: number
  bytesLoaded: number
  bytesTotal: number
  childCount: number
  hosts: string[]
  // Hosts of the links that are running right now (downloading, waiting or waiting for a captcha)
  activeHosts: string[]
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
  status?: string
  speed: number
  eta?: number
  bytesLoaded: number
  bytesTotal: number
}

type Listener = (snapshot: DownloadsSnapshot) => void

// Polls the device only while at least one listener is subscribed (read-only).
export class DownloadsPoller {
  private snapshot: DownloadsSnapshot = { updatedAt: 0, packages: [], totalSpeed: 0, linkCount: 0, runningDownloads: 0 }
  private listeners = new Set<Listener>()
  private timer?: NodeJS.Timeout
  private polling = false

  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string,
    private readonly intervalMs = 3000
  ) {}

  getSnapshot(): DownloadsSnapshot {
    return this.snapshot
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

  // Read-only: links (parts) of a single package.
  async getLinks(packageUuid: number): Promise<DownloadLink[]> {
    const raw = await this.client.callDevice<Partial<DownloadLink>[]>(this.deviceId, '/downloadsV2/queryLinks', [
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
      status: l.status,
      speed: l.speed ?? 0,
      eta: l.eta,
      bytesLoaded: l.bytesLoaded ?? 0,
      bytesTotal: l.bytesTotal ?? 0
    }))
  }

  // Reorders packages in the download list. afterPackageId -1 means "to the top".
  // Only changes the order; running downloads are not touched.
  async movePackages(packageIds: number[], afterPackageId: number): Promise<void> {
    await this.client.callDevice(this.deviceId, '/downloadsV2/movePackages', [packageIds, afterPackageId])
  }

  // Reorders links inside ONE package (never moves them to another package).
  async moveLinks(packageId: number, linkIds: number[], afterLinkId: number): Promise<void> {
    const links = await this.getLinks(packageId)
    const known = new Set(links.map((l) => l.uuid))
    if (!linkIds.every((id) => known.has(id)) || (afterLinkId !== -1 && !known.has(afterLinkId))) {
      throw new Error('Links must all belong to the given package')
    }
    await this.client.callDevice(this.deviceId, '/downloadsV2/moveLinks', [linkIds, afterLinkId, packageId])
  }

  async refresh(): Promise<DownloadsSnapshot> {
    await this.poll()
    return this.snapshot
  }

  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
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
        activeHosts: []
      }))
      // Minimal link query (all packages) just to count links and running downloads.
      const links = await this.client.callDevice<{ running?: boolean; host?: string; packageUUID?: number }[]>(this.deviceId, '/downloadsV2/queryLinks', [
        { maxResults: -1, startAt: 0, running: true, host: true, packageUUID: true }
      ])
      for (const l of links) {
        const pkg = l.running && l.host ? packages.find((p) => p.uuid === l.packageUUID) : undefined
        if (pkg && !pkg.activeHosts.includes(l.host!)) pkg.activeHosts.push(l.host!)
      }
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
