export interface DownloadPackage {
  uuid: number
  name: string
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
