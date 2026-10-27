import type { MyJdClient } from './myjd/client.js'

// System information and power actions of one JDownloader (/system, /jd and /update).
export interface JdSystemInfo {
  version: number
  coreRevision: number
  // ms since JD started
  uptime: number
  os: string
  osFamily: string
  arch: string
  java: string
  javaVendor: string
  heapUsed: number
  heapCommitted: number
  heapMax: number
  docker: boolean
  headless: boolean
  storage: { path: string; free: number; size: number; error?: string }[]
}

interface RawSystem {
  operatingSystem?: string
  osFamily?: string
  archString?: string
  javaName?: string
  javaVendor?: string
  javaVersionString?: string
  heapUsed?: number
  heapCommitted?: number
  heapMax?: number
  docker?: boolean
  headless?: boolean
}

// What JD can do to itself or to the computer it runs on. The names are the ones of its API (SystemAPI).
export const POWER_ACTIONS = ['restart-jd', 'exit-jd', 'shutdown', 'standby', 'hibernate'] as const
export type PowerAction = (typeof POWER_ACTIONS)[number]
const POWER_CALLS: Record<PowerAction, { path: string; params: unknown[] }> = {
  'restart-jd': { path: '/system/restartJD', params: [] },
  'exit-jd': { path: '/system/exitJD', params: [] },
  // The parameter is "force": do not wait for programs that refuse to close
  shutdown: { path: '/system/shutdownOS', params: [false] },
  standby: { path: '/system/standbyOS', params: [] },
  hibernate: { path: '/system/hibernateOS', params: [] }
}

export class JdSystem {
  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string
  ) {}

  private call<T>(path: string, params: unknown[] = []): Promise<T> {
    return this.client.callDevice<T>(this.deviceId, path, params)
  }

  async info(): Promise<JdSystemInfo> {
    const [system, uptime, version, coreRevision, storage] = await Promise.all([
      this.call<RawSystem>('/system/getSystemInfos'),
      this.call<number>('/jd/uptime'),
      this.call<number>('/jd/version'),
      this.call<number>('/jd/getCoreRevision'),
      // An empty path lists every folder JD knows (the drives of the download folders among them)
      this.call<{ path: string; free: number; size: number; error?: string | null }[]>('/system/getStorageInfos', [''])
    ])
    // Folders on one drive come back with the same numbers; one line is enough.
    const seen = new Set<string>()
    const drives = storage.filter((s) => {
      const key = `${s.size}/${s.free}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return {
      version,
      coreRevision,
      uptime,
      os: system.operatingSystem ?? '',
      osFamily: system.osFamily ?? '',
      arch: system.archString ?? '',
      java: [system.javaName, system.javaVersionString].filter(Boolean).join(' '),
      javaVendor: system.javaVendor ?? '',
      heapUsed: system.heapUsed ?? 0,
      heapCommitted: system.heapCommitted ?? 0,
      heapMax: system.heapMax ?? 0,
      docker: system.docker === true,
      headless: system.headless === true,
      storage: drives.map((s) => ({ path: s.path, free: s.free, size: s.size, ...(s.error ? { error: s.error } : {}) }))
    }
  }

  // Makes JD ask its update server now; the answer is read with Config.updateAvailable a little later.
  async checkForUpdates(): Promise<void> {
    await this.call('/update/runUpdateCheck')
  }

  async power(action: PowerAction): Promise<void> {
    const { path, params } = POWER_CALLS[action]
    await this.call(path, params)
  }
}
