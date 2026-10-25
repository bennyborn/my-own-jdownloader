export type Extraction = 'queued' | 'running' | 'done' | 'error'

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
  extraction?: Extraction
  status?: string
  speed: number
  eta?: number
  bytesLoaded: number
  bytesTotal: number
}

export interface GrabberLink {
  uuid: number
  packageUUID: number
  name: string
  host?: string
  url?: string
  enabled: boolean
  bytesTotal: number
  availability: string
  variant?: { id: string; name: string } // only for links JD offers variants for
}

export interface GrabberPackage {
  uuid: number
  name: string
  enabled: boolean
  bytesTotal: number
  childCount: number
  hosts: string[]
  saveTo?: string
  links: GrabberLink[]
}

export interface GrabberState {
  collecting: boolean
  packages: GrabberPackage[]
}
