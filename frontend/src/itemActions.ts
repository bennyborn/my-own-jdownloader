import { ref } from 'vue'
import { askConfirm } from './confirm'
import { currentDevice, withDevice } from './devices'
import { selectedDownloadLinks, selectedDownloadPackages } from './expandedState'

export type Area = 'downloads' | 'linkgrabber'

// A package or link the user can act on (context menu, F2).
export interface Target {
  area: Area
  device?: string // the device the item lives on (the overview shows several); the current one if left out
  kind: 'package' | 'link'
  id: number
  name: string
  enabled: boolean
  running?: boolean // downloads: a download is running right now (no point in offering "Start")
  finished?: boolean
  stopMarked?: boolean // downloads: JD's stop mark sits on this item
  saveTo?: string
  hostCount?: number
  // Linkgrabber packages: ids of all fully selected packages (including this one) when at least two are selected.
  mergeIds?: number[]
  // Linkgrabber: all checked links when the target belongs to a multi-selection; remove / add to downloads then act on all of them.
  selectedLinkIds?: number[]
  // Linkgrabber link that JD offers variants for (quality / format).
  hasVariants?: boolean
  variantId?: string // the variant the link has now
}

export const menu = ref<{ x: number; y: number; target: Target } | null>(null)
export const renaming = ref<Target | null>(null)
export const choosingFolder = ref<Target | null>(null)
export const showingLinks = ref<Target | null>(null)
export const choosingVariants = ref<Target | null>(null)
export const hovered = ref<Target | null>(null)
export const actionError = ref('')
// Incremented after every successful change so lists can reload.
export const changeTick = ref(0)
// Incremented after links were moved from the linkgrabber to the download list.
export const movedTick = ref(0)

// What an action applies to, for confirmation texts: the marked items or the one that was clicked.
const describe = (t: Target) => {
  // Linkgrabber: marked links win, also when the click was on a package header.
  if (t.selectedLinkIds) return `The ${t.selectedLinkIds.length} selected links`
  if (t.kind === 'package' && t.mergeIds && t.mergeIds.length > 1) return `The ${t.mergeIds.length} selected packages`
  return t.kind === 'package' ? `The package "${t.name}" with all its links` : `The link "${t.name}"`
}
const idsOf = (t: Target) => (t.selectedLinkIds ? { linkIds: t.selectedLinkIds } : t.kind === 'package' ? { packageIds: t.mergeIds ?? [t.id] } : { linkIds: [t.id] })

export interface ArchiveSettings {
  autoExtract: boolean
  removeFilesAfterExtraction: boolean
  removeDownloadLinksAfterExtraction: boolean
}
export interface ArchiveInfo {
  id: string
  name: string
  complete: boolean
  settings: ArchiveSettings
}

// Download list: the archives JD recognises for the item the menu is open on (none hides the archive entries).
export const menuArchives = ref<ArchiveInfo[]>([])

// The archive lookup is slow and decides which entries the menu has. What is known per device is whether its JD has
// the extraction extension at all: that is remembered in localStorage, and while the lookup runs the archive entries
// are shown as placeholders (menuArchivesPending) so the menu does not change size when the answer arrives.
const extractionKey = (device: string) => `extraction-enabled:${device}`
const readExtractionEnabled = (device: string) => {
  try {
    return localStorage.getItem(extractionKey(device)) === '1'
  } catch {
    return false
  }
}
const writeExtractionEnabled = (device: string, enabled: boolean) => {
  try {
    localStorage.setItem(extractionKey(device), enabled ? '1' : '0')
  } catch {
    /* blocked: no placeholders then */
  }
}
export const menuArchivesPending = ref(false)

let openedAt = 0
export const openMenu = (event: MouseEvent, target: Target) => {
  event.preventDefault()
  // A long touch can raise both our timer and the browser's contextmenu event: the second one is ignored.
  const open = menu.value?.target
  if (open && open.kind === target.kind && open.id === target.id && Date.now() - openedAt < 1000) return
  openedAt = Date.now()
  menu.value = { x: event.clientX, y: event.clientY, target }
  menuArchives.value = []
  menuArchivesPending.value = false
  if (target.area !== 'downloads') return
  const device = target.device ?? currentDevice.value
  const body = JSON.stringify({ ...idsOf(target), device })
  menuArchivesPending.value = readExtractionEnabled(device)
  fetch('/api/downloads/archives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  })
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    })
    .then((archives: ArchiveInfo[]) => {
      // (the menu holds a reactive proxy of the target, so compare by identity of the item)
      const open = menu.value?.target
      if (open && open.kind === target.kind && open.id === target.id && open.device === target.device) menuArchives.value = archives
    })
    .catch(() => {
      /* no archive entry then */
    })
    .finally(() => {
      menuArchivesPending.value = false
    })
  fetch(withDevice('/api/jd-settings', device))
    .then((res) => (res.ok ? res.json() : undefined))
    .then((jd) => jd && writeExtractionEnabled(device, jd.extractionEnabled !== false))
    .catch(() => {
      /* keeps the remembered value */
    })
}
// Scrolls the page just enough to bring the item into view (centred in the free area); bottomLimit is the lower
// edge of that area, by default the top of the status bar. Scrolling closes the menu, except for a moment after this.
let ignoreScrollUntil = 0
export const scrollIgnored = () => Date.now() < ignoreScrollUntil
export const revealItem = (t: Target, bottomLimit?: number) => {
  const el = document.querySelector<HTMLElement>(`[data-item="${t.area}:${t.kind}:${t.id}"]`)
  if (!el) return
  const rect = el.getBoundingClientRect()
  const top = 8
  const free = document.querySelector('.menu.sheet') ?? document.querySelector('.statusbar') // the open sheet or the status bar covers the bottom
  const bottom = bottomLimit ?? (free?.getBoundingClientRect().top ?? window.innerHeight) - 8
  if (rect.top >= top && rect.bottom <= bottom) return
  const room = bottom - top
  ignoreScrollUntil = Date.now() + 500
  window.scrollBy({ top: rect.top - top - (rect.height >= room ? 0 : (room - rect.height) / 2) })
}
export const closeMenu = () => (menu.value = null)
// True for the package / link a context menu is currently open for (it keeps its hover look).
export const menuOn = (area: Area, kind: 'package' | 'link', id: number) =>
  menu.value?.target.area === area && menu.value.target.kind === kind && menu.value.target.id === id

export const setHovered = (target: Target) => (hovered.value = target)
export const clearHovered = (target: Target) => {
  if (hovered.value && hovered.value.kind === target.kind && hovered.value.id === target.id) hovered.value = null
}

export const startRename = (target: Target) => {
  closeMenu()
  renaming.value = target
}
export const startVariants = (target: Target) => {
  closeMenu()
  choosingVariants.value = target
}
export const startFolder = (target: Target) => {
  closeMenu()
  choosingFolder.value = target
}

const post = async (t: Target, url: string, body: object): Promise<any> => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, device: t.device ?? currentDevice.value }) })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      message = (await res.json()).error ?? message
    } catch {
      /* keep the status text */
    }
    throw new Error(message)
  }
  return res.json()
}

const run = async (action: () => Promise<unknown>) => {
  actionError.value = ''
  try {
    await action()
    changeTick.value++
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e)
    throw e
  }
}

// Linkgrabber: adds a copy of the link for each variant (same package), or switches the link itself to one variant.
export const addVariants = (t: Target, variantIds: string[]) => run(() => post(t, '/api/linkgrabber/variants/add', { linkId: t.id, variantIds }))
export const switchVariant = (t: Target, variantId: string) => run(() => post(t, '/api/linkgrabber/variant', { linkId: t.id, variantId }))

export const rename = (t: Target, name: string) => run(() => post(t, `/api/${t.area}/rename`, { kind: t.kind, id: t.id, name }))
export const setFolder = (t: Target, directory: string) => run(() => post(t, `/api/${t.area}/directory`, { packageIds: [t.id], directory }))
export const toggleEnabled = async (t: Target) => {
  closeMenu()
  const body = idsOf(t)
  try {
    await run(() => post(t, `/api/${t.area}/enabled`, { enabled: !t.enabled, ...body }))
  } catch {
    /* error is shown via actionError */
  }
}

// Linkgrabber only: takes the package (with all its links) or the single link into the download list.
export const moveToDownloads = async (t: Target) => {
  closeMenu()
  const what = describe(t)
  const ok = await askConfirm({ title: 'Add to downloads', message: `${what} will be moved from the linkgrabber to the download list.`, confirmLabel: 'Add to downloads' })
  if (!ok) return
  try {
    await run(() => post(t, '/api/linkgrabber/move-to-downloads', idsOf(t)))
    movedTick.value++
  } catch {
    /* error is shown via actionError */
  }
}

// Linkgrabber: merges the selected packages into the one that was right-clicked.
export const mergePackages = async (t: Target) => {
  closeMenu()
  const others = (t.mergeIds ?? []).filter((id) => id !== t.id)
  if (!others.length) return
  const ok = await askConfirm({
    title: 'Merge packages',
    message: `${others.length + 1} packages will be merged into "${t.name}". The links of the other packages are moved there.`,
    confirmLabel: 'Merge'
  })
  if (!ok) return
  try {
    await run(() => post(t, `/api/${t.area}/merge`, { destPackageId: t.id, packageIds: others }))
  } catch {
    /* error is shown via actionError */
  }
}

const DELETE_FILES_KEY = 'deleteFilesOnRemove'
const loadDeleteFiles = () => {
  try {
    return localStorage.getItem(DELETE_FILES_KEY) === '1'
  } catch {
    return false
  }
}
const saveDeleteFiles = (value: boolean) => {
  try {
    localStorage.setItem(DELETE_FILES_KEY, value ? '1' : '0')
  } catch {
    /* the choice is simply not remembered */
  }
}

// Linkgrabber: removes the entry. Download list: removes it and asks whether to delete the files too
// (the choice is remembered in the browser).
export const removeItem = async (t: Target) => {
  closeMenu()
  const what = describe(t)
  const body = idsOf(t)
  if (t.area === 'linkgrabber') {
    const ok = await askConfirm({ title: 'Remove', message: `${what} will be removed from the linkgrabber.`, confirmLabel: 'Remove', danger: true })
    if (!ok) return
    try {
      await run(() => post(t, '/api/linkgrabber/remove', body))
    } catch {
      /* error is shown via actionError */
    }
    return
  }
  const option = { label: 'Also delete the downloaded files from disk', checked: loadDeleteFiles() }
  const ok = await askConfirm({ title: 'Remove', message: `${what} will be removed from the download list.`, confirmLabel: 'Remove', danger: true, option })
  if (!ok) return
  saveDeleteFiles(option.checked)
  try {
    await run(() => post(t, '/api/downloads/remove', { ...body, deleteFiles: option.checked }))
    selectedDownloadLinks.value = new Set() // the marked links are gone
    selectedDownloadPackages.value = new Set()
  } catch {
    /* error is shown via actionError */
  }
}

export const splitBlocked = (t: Target) => ((t.hostCount ?? 0) < 2 ? 'The package only has links of one host' : undefined)

// Splits a package (or all marked packages in the linkgrabber) into one package per host.
export const splitByHost = async (t: Target) => {
  closeMenu()
  if (splitBlocked(t)) return
  const ids = t.mergeIds ?? [t.id]
  const what = ids.length > 1 ? `The ${ids.length} marked packages` : `The package "${t.name}"`
  const ok = await askConfirm({ title: 'Split by host', message: `${what} will be split into one package per host.`, confirmLabel: 'Split' })
  if (!ok) return
  try {
    await run(() => post(t, `/api/${t.area}/split-by-host`, { packageIds: ids }))
  } catch {
    /* error is shown via actionError */
  }
}

// Download list: force-starts the package (or all marked packages) or the single link; enables it first if it is disabled.
export const startDownload = async (t: Target) => {
  closeMenu()
  const body = t.kind === 'package' ? { packageIds: t.mergeIds ?? [t.id] } : { linkIds: t.selectedLinkIds ?? [t.id] }
  try {
    // A disabled item is enabled first, otherwise JD would not download it.
    if (!t.enabled) await run(() => post(t, '/api/downloads/enabled', { enabled: true, ...body }))
    await run(() => post(t, '/api/downloads/start', body))
  } catch {
    /* error is shown via actionError */
  }
}

// Download list: JD's stop mark (one at most): it stops before the marked link / package. Setting it moves it from where it was.
export const toggleStopMark = async (t: Target) => {
  closeMenu()
  try {
    if (t.stopMarked) await run(() => post(t, '/api/downloads/stop-mark/remove', {}))
    else await run(() => post(t, '/api/downloads/stop-mark', t.kind === 'package' ? { packageId: t.id } : { linkId: t.id }))
  } catch {
    /* error is shown via actionError */
  }
}

// Download list: starts the extraction of the archive(s) the package(s) or link(s) belong to.
export const startExtraction = async (t: Target) => {
  closeMenu()
  try {
    await run(() => post(t, '/api/downloads/extract', idsOf(t)))
  } catch {
    /* error is shown via actionError */
  }
}

// Download list: JD deletes the downloaded files and the download starts from zero, so it is confirmed first.
export const resetItem = async (t: Target) => {
  closeMenu()
  const what = describe(t)
  const ok = await askConfirm({
    title: 'Reset',
    message: `${what} will be reset: the downloaded files are deleted from disk and the download starts again from the beginning.`,
    confirmLabel: 'Reset and delete files',
    danger: true
  })
  if (!ok) return
  try {
    await run(() => post(t, '/api/downloads/reset', idsOf(t)))
  } catch {
    /* error is shown via actionError */
  }
}

// Switches one setting for all archives of the menu (on unless every one of them has it on already).
export const toggleArchiveSetting = async (t: Target, key: keyof ArchiveSettings) => {
  const archives = menuArchives.value
  closeMenu()
  const value = !archives.every((a) => a.settings[key])
  try {
    await run(() => post(t, '/api/downloads/archive-settings', { archiveIds: archives.map((a) => a.id), settings: { [key]: value } }))
  } catch {
    /* error is shown via actionError */
  }
}

// Moves the package(s) or link(s) to the top or bottom of their list, or one step up / down (links: inside their package).
export const moveToEdge = async (t: Target, position: 'top' | 'bottom' | 'up' | 'down') => {
  // The menu stays open: several steps in a row are the common case.
  const ids = t.kind === 'package' ? (t.mergeIds ?? [t.id]) : (t.selectedLinkIds ?? [t.id])
  try {
    await run(() => post(t, `/api/${t.area}/move-to-edge`, { kind: t.kind, ids, position }))
    // The list is reordered by the next live update: keep the item in view once it has moved.
    for (const delay of [400, 1200, 2500]) setTimeout(() => revealItem(t), delay)
  } catch {
    /* error is shown via actionError */
  }
}

// Package with several hosters: spreads its files over the hosters and disables the duplicate mirrors.
export const interleaveHosts = async (t: Target) => {
  closeMenu()
  try {
    const plan = await post(t, `/api/${t.area}/interleave`, { packageId: t.id, dryRun: true })
    const ok = await askConfirm({
      title: 'Interleave hosters',
      message: `The ${plan.parts} files of "${t.name}" will alternate between ${plan.hosts.join(', ')}. ${plan.disable} duplicate link${plan.disable === 1 ? '' : 's'} will be disabled, so nothing is downloaded twice.`,
      confirmLabel: 'Interleave'
    })
    if (!ok) return
    await run(() => post(t, `/api/${t.area}/interleave`, { packageId: t.id, dryRun: false }))
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e)
  }
}

// Package: orders its links alphabetically by file name.
export const sortLinks = async (t: Target) => {
  closeMenu()
  try {
    await run(() => post(t, `/api/${t.area}/sort-links`, { packageId: t.id }))
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e)
  }
}

export const startShowLinks = (target: Target) => {
  closeMenu()
  showingLinks.value = target
}
