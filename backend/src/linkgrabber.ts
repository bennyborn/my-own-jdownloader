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
  // Set by JD when the link offers variants (e.g. YouTube qualities); absent for links without.
  variant?: LinkVariant
}

export interface LinkVariant {
  id: string
  name: string
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
      { maxResults: -1, startAt: 0, host: true, url: true, bytesTotal: true, availability: true, enabled: true, packageUUID: true, variantID: true, variantName: true }
    ])
    return raw.map((l) => ({
      uuid: l.uuid ?? 0,
      packageUUID: l.packageUUID ?? 0,
      name: l.name ?? '',
      host: l.host,
      url: l.url,
      enabled: l.enabled === true,
      bytesTotal: l.bytesTotal ?? 0,
      availability: l.availability ?? 'UNKNOWN',
      variant: l.variant?.id ? { id: l.variant.id, name: l.variant.name ?? l.variant.id } : undefined
    }))
  }

  // The source URLs of a package's links.
  async getUrls(packageUuid: number): Promise<string[]> {
    const raw = await this.call<{ url?: string }[]>('/linkgrabberv2/queryLinks', [{ packageUUIDs: [packageUuid], maxResults: -1, startAt: 0, url: true }])
    return [...new Set(raw.map((l) => l.url).filter((u): u is string => typeof u === 'string' && u !== ''))]
  }

  // The variants JD offers for one link (the same variant name can occur more than once, the id is what counts).
  async getVariants(linkId: number): Promise<LinkVariant[]> {
    const raw = await this.call<Partial<LinkVariant>[] | null>('/linkgrabberv2/getVariants', [linkId])
    return (raw ?? []).filter((v) => typeof v.id === 'string').map((v) => ({ id: v.id as string, name: v.name ?? (v.id as string) }))
  }

  private async requireVariants(linkId: number, variantIds: string[]): Promise<void> {
    const known = new Set((await this.getVariants(linkId)).map((v) => v.id))
    if (!variantIds.every((id) => known.has(id))) throw new Error('Unknown variant for this link')
  }

  // Switches the link itself to another variant.
  async setVariant(linkId: number, variantId: string): Promise<void> {
    await this.requireVariants(linkId, [variantId])
    await this.call('/linkgrabberv2/setVariant', [linkId, variantId])
  }

  // Adds one more link per variant to the package of the link; the link itself stays as it is.
  async addVariantCopies(linkId: number, variantIds: string[]): Promise<void> {
    const link = (await this.getLinks()).find((l) => l.uuid === linkId)
    if (!link) throw new Error('Link not found')
    await this.requireVariants(linkId, variantIds)
    // Every copy goes right behind the original, so insert in reverse to end up in the order of the selection.
    for (const variantId of [...new Set(variantIds)].reverse()) {
      if (variantId === link.variant?.id) continue
      await this.call('/linkgrabberv2/addVariantCopy', [linkId, linkId, link.packageUUID, variantId])
    }
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

  // Click'n'Load: JDownloader decrypts "crypted" itself (with jk / key), or takes plain urls.
  // The links only go to the linkgrabber, never straight into the download list.
  async addCnl(query: { urls?: string; crypted?: string; jk?: string; key?: string; passwords?: string[]; packageName?: string; source?: string; referrer?: string }): Promise<void> {
    await this.call('/flash/addcnl', [{ ...query, autostart: false, permission: true }])
  }

  // Adds a container file (e.g. DLC) given as a data URL.
  async addContainer(type: string, dataUrl: string): Promise<void> {
    await this.call('/linkgrabberv2/addContainer', [type, dataUrl])
  }

  // Moves the given links and/or whole packages from the linkgrabber into the download list.
  async moveToDownloads(linkIds: number[], packageIds: number[]): Promise<void> {
    await this.call('/linkgrabberv2/moveToDownloadlist', [linkIds, packageIds])
  }

  // Reorders packages in the linkgrabber. afterPackageId -1 means "to the top".
  async movePackages(packageIds: number[], afterPackageId: number): Promise<void> {
    await this.call('/linkgrabberv2/movePackages', [packageIds, afterPackageId])
  }

  // Reorders links inside ONE package (never moves them to another package).
  async moveLinks(packageId: number, linkIds: number[], afterLinkId: number): Promise<void> {
    const known = new Set((await this.getLinks()).filter((l) => l.packageUUID === packageId).map((l) => l.uuid))
    if (!linkIds.every((id) => known.has(id)) || (afterLinkId !== -1 && !known.has(afterLinkId))) {
      throw new Error('Links must all belong to the given package')
    }
    await this.call('/linkgrabberv2/moveLinks', [linkIds, afterLinkId, packageId])
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
