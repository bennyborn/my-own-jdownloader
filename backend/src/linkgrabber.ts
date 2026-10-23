import type { MyJdClient } from './myjd/client.js'

export interface GrabberPackage {
  uuid: number
  name: string
  enabled: boolean
  bytesTotal: number
  childCount: number
  hosts: string[]
  saveTo?: string
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
}

export interface AddLinksOptions {
  links: string
  packageName?: string
  destinationFolder?: string
  extractPassword?: string
  downloadPassword?: string
  autostart: boolean
  autoExtract: boolean
  deepDecrypt: boolean
  overwritePackagizerRules: boolean
}

export class Linkgrabber {
  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string
  ) {}

  private call<T>(action: string, params: unknown[] = []): Promise<T> {
    return this.client.callDevice<T>(this.deviceId, action, params)
  }

  async isCollecting(): Promise<boolean> {
    return Boolean(await this.call<boolean>('/linkgrabberv2/isCollecting'))
  }

  async getPackages(): Promise<GrabberPackage[]> {
    const raw = await this.call<Partial<GrabberPackage>[]>('/linkgrabberv2/queryPackages', [
      { maxResults: -1, startAt: 0, saveTo: true, bytesTotal: true, childCount: true, hosts: true, enabled: true }
    ])
    return raw.map((p) => ({
      uuid: p.uuid ?? 0,
      name: p.name ?? '',
      enabled: p.enabled === true,
      bytesTotal: p.bytesTotal ?? 0,
      childCount: p.childCount ?? 0,
      hosts: p.hosts ?? [],
      saveTo: p.saveTo
    }))
  }

  // All links of all packages in one call (packageUUID tells which package a link belongs to).
  async getLinks(): Promise<GrabberLink[]> {
    const raw = await this.call<Partial<GrabberLink>[]>('/linkgrabberv2/queryLinks', [
      { maxResults: -1, startAt: 0, host: true, url: true, bytesTotal: true, availability: true, enabled: true, packageUUID: true }
    ])
    return raw.map((l) => ({
      uuid: l.uuid ?? 0,
      packageUUID: l.packageUUID ?? 0,
      name: l.name ?? '',
      host: l.host,
      url: l.url,
      enabled: l.enabled === true,
      bytesTotal: l.bytesTotal ?? 0,
      availability: l.availability ?? 'UNKNOWN'
    }))
  }

  // Download folders used before, as shown in the folder dropdown of the original UI.
  async getFolders(): Promise<string[]> {
    const folders = await this.call<unknown>('/linkgrabberv2/getDownloadFolderHistorySelectionBase')
    return Array.isArray(folders) ? folders.filter((f): f is string => typeof f === 'string') : []
  }

  // Adds links to the linkgrabber. Nothing is queued for download unless autostart is set explicitly.
  async addLinks(options: AddLinksOptions): Promise<void> {
    await this.call('/linkgrabberv2/addLinks', [
      {
        links: options.links,
        packageName: options.packageName || undefined,
        destinationFolder: options.destinationFolder || undefined,
        extractPassword: options.extractPassword || undefined,
        downloadPassword: options.downloadPassword || undefined,
        autostart: options.autostart,
        autoExtract: options.autoExtract,
        deepDecrypt: options.deepDecrypt,
        overwritePackagizerRules: options.overwritePackagizerRules,
        assignJobID: false
      }
    ])
  }

  // Adds a container file (e.g. DLC) given as a data URL.
  async addContainer(type: string, dataUrl: string): Promise<void> {
    await this.call('/linkgrabberv2/addContainer', [type, dataUrl])
  }

  // Moves the given links and/or whole packages from the linkgrabber into the download list.
  async moveToDownloads(linkIds: number[], packageIds: number[]): Promise<void> {
    await this.call('/linkgrabberv2/moveToDownloadlist', [linkIds, packageIds])
  }

  // Merges packages: moves all links of the source packages to the end of the destination package.
  // (Emptied packages disappear from the linkgrabber on their own.)
  async merge(destPackageId: number, sourcePackageIds: number[]): Promise<void> {
    const links = await this.getLinks()
    const destLinks = links.filter((l) => l.packageUUID === destPackageId)
    const moving = links.filter((l) => sourcePackageIds.includes(l.packageUUID) && l.packageUUID !== destPackageId)
    if (!destLinks.length || !moving.length) throw new Error('Nothing to merge')
    const after = destLinks[destLinks.length - 1].uuid
    await this.call('/linkgrabberv2/moveLinks', [moving.map((l) => l.uuid), after, destPackageId])
  }

  // Removes entries from the linkgrabber only (never touches the download list).
  async remove(linkIds: number[], packageIds: number[]): Promise<void> {
    await this.call('/linkgrabberv2/removeLinks', [linkIds, packageIds])
  }
}
