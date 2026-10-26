import type { MyJdClient } from './myjd/client.js'

export type Area = 'downloads' | 'linkgrabber'

export interface ArchiveSettings {
  autoExtract: boolean
  removeFilesAfterExtraction: boolean
  removeDownloadLinksAfterExtraction: boolean
}
export interface ArchiveInfo {
  id: string
  name: string
  type: string
  status: string
  complete: boolean // every part is downloaded, so extracting makes sense
  settings: ArchiveSettings
}

// Write operations shared by the download list and the linkgrabber (rename, enable/disable, folder).
export type MovePosition = 'top' | 'bottom' | 'up' | 'down'

// The id the wanted items have to be placed after (-1: the top) for the move; undefined when they cannot go any further.
const afterFor = (order: number[], wanted: Set<number>, position: MovePosition): number | undefined => {
  const rest = order.filter((id) => !wanted.has(id))
  const first = order.findIndex((id) => wanted.has(id))
  const last = order.length - 1 - [...order].reverse().findIndex((id) => wanted.has(id))
  if (position === 'top') return -1
  if (position === 'bottom') return rest[rest.length - 1] ?? -1
  if (position === 'up') return first === 0 ? undefined : (rest[rest.indexOf(order[first - 1]) - 1] ?? -1)
  return last === order.length - 1 ? undefined : order[last + 1]
}

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
    await this.call('renameLink', [id, name])
  }

  async setEnabled(enabled: boolean, linkIds: number[], packageIds: number[]): Promise<void> {
    await this.call('setEnabled', [enabled, linkIds, packageIds])
  }

  async setDirectory(directory: string, packageIds: number[]): Promise<void> {
    await this.call('setDownloadDirectory', [directory, packageIds])
  }

  // Download list only: moves all links of the source packages to the end of the destination package.
  // Emptied packages disappear on their own.
  async mergeInto(destPackageId: number, sourcePackageIds: number[]): Promise<void> {
    if (this.area !== 'downloads') throw new Error('Only supported for the download list')
    const ids = [destPackageId, ...sourcePackageIds.filter((id) => id !== destPackageId)]
    const links = await this.client.callDevice<{ uuid: number; packageUUID: number }[]>(this.deviceId, `${this.ns}/queryLinks`, [
      { maxResults: -1, startAt: 0, packageUUIDs: ids }
    ])
    const destLinks = links.filter((l) => l.packageUUID === destPackageId)
    const moving = links.filter((l) => l.packageUUID !== destPackageId)
    if (!destLinks.length || !moving.length) throw new Error('Nothing to merge')
    await this.call('moveLinks', [moving.map((l) => l.uuid), destLinks[destLinks.length - 1].uuid, destPackageId])
  }

  // Spreads the files of a package over its hosters: link 1 from host A, link 2 from host B, link 3 from
  // host A again, ... Links with the same file name on several hosters are mirrors of one file; the
  // mirror that is not chosen is disabled so nothing is downloaded twice. dryRun only reports the plan.
  async interleaveHosts(packageId: number, dryRun: boolean): Promise<{ hosts: string[]; parts: number; disable: number }> {
    type L = { uuid: number; name?: string; host?: string; enabled?: boolean; finished?: boolean }
    const links = (await this.call('queryLinks', [
      { maxResults: -1, startAt: 0, packageUUIDs: [packageId], name: true, host: true, enabled: true, ...(this.area === 'downloads' ? { finished: true } : {}) }
    ])) as L[]
    // Only links that would still be downloaded take part (finished and disabled ones stay as they are).
    const candidates = links.filter((l) => l.enabled && !l.finished && l.host)
    const hosts = [...new Set(candidates.map((l) => l.host!))]
    if (hosts.length < 2) throw new Error('The package has links of only one host')
    const files = new Map<string, L[]>()
    for (const l of candidates) {
      const key = (l.name ?? '').toLowerCase()
      files.set(key, [...(files.get(key) ?? []), l])
    }
    if (![...files.values()].some((group) => group.length > 1)) throw new Error('No file has active mirrors on several hosters (same file name, links enabled)')
    const keys = [...files.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const chosen: number[] = []
    const duplicates: number[] = []
    keys.forEach((key, i) => {
      const group = files.get(key)!
      // The turn's host first; if it does not have this file, the next host that does.
      let pick: L | undefined
      for (let k = 0; k < hosts.length && !pick; k++) pick = group.find((l) => l.host === hosts[(i + k) % hosts.length])
      chosen.push(pick!.uuid)
      for (const l of group) if (l !== pick) duplicates.push(l.uuid)
    })
    if (!dryRun) {
      // One call per link: the order of several ids in a single call is up to JD.
      for (let i = 0; i < chosen.length; i++) await this.call('moveLinks', [[chosen[i]], i === 0 ? -1 : chosen[i - 1], packageId])
      if (duplicates.length) await this.call('setEnabled', [false, duplicates, []])
    }
    return { hosts, parts: chosen.length, disable: duplicates.length }
  }

  // Orders the links of a package alphabetically by file name (numbers by value: "part2" before "part10").
  async sortLinks(packageId: number): Promise<{ links: number }> {
    const links = (await this.call('queryLinks', [{ maxResults: -1, startAt: 0, packageUUIDs: [packageId], name: true }])) as { uuid: number; name?: string }[]
    if (links.length < 2) throw new Error('The package has fewer than two links')
    const sorted = [...links].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true, sensitivity: 'base' }))
    // One call per link: the order of several ids in a single call is up to JD.
    for (let i = 0; i < sorted.length; i++) await this.call('moveLinks', [[sorted[i].uuid], i === 0 ? -1 : sorted[i - 1].uuid, packageId])
    return { links: sorted.length }
  }

  // Moves packages (or links, inside their own package) to the top or the bottom of the list, or one step up / down.
  // The given ids keep their current relative order. Works for the download list and the linkgrabber.
  async moveToEdge(kind: 'package' | 'link', ids: number[], position: MovePosition): Promise<void> {
    const wanted = new Set(ids)
    if (kind === 'package') {
      const list = (await this.call('queryPackages', [{ maxResults: -1, startAt: 0 }])) as { uuid: number }[]
      const order = list.map((p) => p.uuid)
      const moving = order.filter((id) => wanted.has(id))
      if (!moving.length) throw new Error('Packages not found')
      const after = afterFor(order, wanted, position)
      if (after !== undefined) await this.call('movePackages', [moving, after])
      return
    }
    const links = (await this.call('queryLinks', [{ maxResults: -1, startAt: 0, packageUUID: true }])) as { uuid: number; packageUUID: number }[]
    const byPackage = new Map<number, number[]>()
    for (const l of links) byPackage.set(l.packageUUID, [...(byPackage.get(l.packageUUID) ?? []), l.uuid])
    let found = 0
    for (const [packageId, order] of byPackage) {
      const moving = order.filter((id) => wanted.has(id))
      if (!moving.length) continue
      found += moving.length
      const after = afterFor(order, wanted, position)
      if (after !== undefined) await this.call('moveLinks', [moving, after, packageId])
    }
    if (!found) throw new Error('Links not found')
  }

  // Download list only: force-starts the given links / packages (also while the download controller is idle).
  async startDownload(linkIds: number[], packageIds: number[]): Promise<void> {
    if (this.area !== 'downloads') throw new Error('Only supported for the download list')
    await this.call('forceDownload', [linkIds, packageIds])
  }

  // Download list only: JD's stop mark (one at most) goes on a link or on a package; setting it moves it from where it was.
  async setStopMark(linkId: number | undefined, packageId: number | undefined): Promise<void> {
    if (this.area !== 'downloads') throw new Error('Only supported for the download list')
    await this.call('setStopMark', [linkId ?? -1, packageId ?? -1])
  }

  async removeStopMark(): Promise<void> {
    if (this.area !== 'downloads') throw new Error('Only supported for the download list')
    await this.call('removeStopMark', [])
  }

  // Download list only: the archives JD recognises among the given links / packages (none for plain files),
  // with their own settings. A setting JD has no value for (it then follows the global default) reads as false.
  async getArchives(linkIds: number[], packageIds: number[]): Promise<ArchiveInfo[]> {
    if (this.area !== 'downloads') throw new Error('Only supported for the download list')
    const info = await this.client.callDevice<{ archiveId: string; archiveName: string; type: string; controllerStatus: string; states?: Record<string, string> }[]>(
      this.deviceId,
      '/extraction/getArchiveInfo',
      [linkIds, packageIds]
    )
    if (!info.length) return []
    const settings = await this.client.callDevice<(Partial<ArchiveSettings> & { archiveId: string })[]>(this.deviceId, '/extraction/getArchiveSettings', [info.map((a) => a.archiveId)])
    return info.map((a) => {
      const own = settings.find((x) => x.archiveId === a.archiveId)
      return {
        id: a.archiveId,
        name: a.archiveName,
        type: a.type,
        status: a.controllerStatus,
        complete: Object.values(a.states ?? {}).every((state) => state === 'COMPLETE'),
        settings: { autoExtract: own?.autoExtract === true, removeFilesAfterExtraction: own?.removeFilesAfterExtraction === true, removeDownloadLinksAfterExtraction: own?.removeDownloadLinksAfterExtraction === true }
      }
    })
  }

  // Download list only: changes settings of archives (one call per archive, JD takes a single id).
  async setArchiveSettings(archiveIds: string[], patch: Partial<ArchiveSettings>): Promise<void> {
    if (this.area !== 'downloads') throw new Error('Only supported for the download list')
    for (const id of archiveIds) await this.client.callDevice(this.deviceId, '/extraction/setArchiveSettings', [id, patch])
  }

  // Download list only: starts the extraction of the archives the given links / packages belong to.
  async startExtraction(linkIds: number[], packageIds: number[]): Promise<void> {
    if (this.area !== 'downloads') throw new Error('Only supported for the download list')
    await this.client.callDevice(this.deviceId, '/extraction/startExtractionNow', [linkIds, packageIds])
  }

  // Download list only: resets links / packages. JD deletes the downloaded (and partial) files and the
  // download starts from zero.
  async resetLinks(linkIds: number[], packageIds: number[]): Promise<void> {
    if (this.area !== 'downloads') throw new Error('Only supported for the download list')
    await this.call('resetLinks', [linkIds, packageIds])
  }

  // Splits packages into one package per host.
  async splitByHoster(packageIds: number[]): Promise<void> {
    await this.call('splitPackageByHoster', [[], packageIds])
  }

  // Download list only: removes links/packages, optionally deleting the downloaded files from disk.
  async removeFromDownloads(linkIds: number[], packageIds: number[], deleteFiles: boolean): Promise<void> {
    if (this.area !== 'downloads') throw new Error('Only supported for the download list')
    if (deleteFiles) await this.call('cleanup', [linkIds, packageIds, 'DELETE_ALL', 'REMOVE_LINKS_AND_DELETE_FILES', 'SELECTED'])
    else await this.call('removeLinks', [linkIds, packageIds])
  }
}
