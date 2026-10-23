import type { MyJdClient } from './myjd/client.js'

export type Area = 'downloads' | 'linkgrabber'

export class ConflictError extends Error {}

// Write operations shared by the download list and the linkgrabber (rename, enable/disable, folder).
// In the download list, anything that could interrupt a running download is refused.
export class ListOps {
  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string,
    private readonly area: Area
  ) {}

  private get ns(): string {
    return this.area === 'downloads' ? '/downloadsV2' : '/linkgrabberv2'
  }

  private call(action: string, params: unknown[]): Promise<unknown> {
    return this.client.callDevice(this.deviceId, `${this.ns}/${action}`, params)
  }

  // True if any of the given links (or any link of the given packages) is currently being downloaded.
  private async hasRunning(linkIds: number[], packageIds: number[]): Promise<boolean> {
    if (this.area !== 'downloads') return false
    const query = { maxResults: -1, startAt: 0, running: true }
    const [byLink, byPackage] = await Promise.all([
      linkIds.length ? this.client.callDevice<{ running?: boolean }[]>(this.deviceId, `${this.ns}/queryLinks`, [{ ...query, linkUUIDs: linkIds }]) : [],
      packageIds.length ? this.client.callDevice<{ running?: boolean }[]>(this.deviceId, `${this.ns}/queryLinks`, [{ ...query, packageUUIDs: packageIds }]) : []
    ])
    return [...byLink, ...byPackage].some((l) => l.running)
  }

  // Read-only: the URLs of a package (all its links) or of a single link.
  // Normal links use their own URL (for packages from filecrypt & co. these are the hoster links).
  // Plugin-internal URLs such as "youtubev2://ID/hash" are resolved through getDownloadUrls
  // (container URL = the page, e.g. the YouTube video, otherwise the content URL).
  async getUrls(kind: 'package' | 'link', id: number): Promise<string[]> {
    const query = { maxResults: -1, startAt: 0, url: true, ...(kind === 'package' ? { packageUUIDs: [id] } : { linkUUIDs: [id] }) }
    const links = await this.client.callDevice<{ uuid: number; url?: string }[]>(this.deviceId, `${this.ns}/queryLinks`, [query])
    const isWeb = (url?: string) => !!url && /^https?:\/\//i.test(url)

    const internal = links.filter((l) => l.url && !isWeb(l.url)).map((l) => l.uuid)
    const resolved = new Map<number, string>()
    if (internal.length) {
      const byType = async (type: string): Promise<[string, number[]][]> =>
        Object.entries((await this.call('getDownloadUrls', [internal, [], [type]])) as Record<string, number[]>)
      const [content, container] = await Promise.all([byType('CONTENT'), byType('CONTAINER')])
      // Variant info that some plugins append (YouTube: "#variant=...") is not part of the link.
      const clean = (url: string) => url.replace(/#variant=.*$/, '')
      for (const [url, ids] of content) for (const linkId of ids) resolved.set(linkId, clean(url))
      for (const [url, ids] of container) for (const linkId of ids) resolved.set(linkId, clean(url))
    }
    const urls = links.map((l) => (isWeb(l.url) ? l.url : (resolved.get(l.uuid) ?? l.url)))
    return [...new Set(urls.filter((u): u is string => typeof u === 'string' && u.length > 0))]
  }

  async renamePackage(id: number, name: string): Promise<void> {
    await this.call('renamePackage', [id, name])
  }

  async renameLink(id: number, name: string): Promise<void> {
    if (await this.hasRunning([id], [])) throw new ConflictError('The download is running and cannot be renamed')
    await this.call('renameLink', [id, name])
  }

  async setEnabled(enabled: boolean, linkIds: number[], packageIds: number[]): Promise<void> {
    if (!enabled && (await this.hasRunning(linkIds, packageIds))) {
      throw new ConflictError('Running downloads cannot be disabled')
    }
    await this.call('setEnabled', [enabled, linkIds, packageIds])
  }

  async setDirectory(directory: string, packageIds: number[]): Promise<void> {
    if (await this.hasRunning([], packageIds)) throw new ConflictError('The package has running downloads, its folder cannot be changed')
    await this.call('setDownloadDirectory', [directory, packageIds])
  }
}
