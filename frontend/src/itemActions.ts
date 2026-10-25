import { ref } from 'vue'
import { askConfirm } from './confirm'
import { selectedDownloadLinks } from './expandedState'

export type Area = 'downloads' | 'linkgrabber'

// A package or link the user can act on (context menu, F2).
export interface Target {
  area: Area
  kind: 'package' | 'link'
  id: number
  name: string
  enabled: boolean
  saveTo?: string
  hostCount?: number
  // Linkgrabber packages: ids of all fully selected packages (including this one) when at least two are selected.
  mergeIds?: number[]
  // Linkgrabber: all checked links when the target belongs to a multi-selection; remove / add to downloads then act on all of them.
  selectedLinkIds?: number[]
}

export const menu = ref<{ x: number; y: number; target: Target } | null>(null)
export const renaming = ref<Target | null>(null)
export const choosingFolder = ref<Target | null>(null)
export const showingLinks = ref<Target | null>(null)
export const hovered = ref<Target | null>(null)
export const actionError = ref('')
// Incremented after every successful change so lists can reload.
export const changeTick = ref(0)
// Incremented after links were moved from the linkgrabber to the download list.
export const movedTick = ref(0)

export const openMenu = (event: MouseEvent, target: Target) => {
  event.preventDefault()
  menu.value = { x: event.clientX, y: event.clientY, target }
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
export const startFolder = (target: Target) => {
  closeMenu()
  choosingFolder.value = target
}

const post = async (url: string, body: unknown): Promise<any> => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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

export const rename = (t: Target, name: string) => run(() => post(`/api/${t.area}/rename`, { kind: t.kind, id: t.id, name }))
export const setFolder = (t: Target, directory: string) => run(() => post(`/api/${t.area}/directory`, { packageIds: [t.id], directory }))
export const toggleEnabled = async (t: Target) => {
  closeMenu()
  const body = t.selectedLinkIds ? { linkIds: t.selectedLinkIds } : t.kind === 'package' ? { packageIds: [t.id] } : { linkIds: [t.id] }
  try {
    await run(() => post(`/api/${t.area}/enabled`, { enabled: !t.enabled, ...body }))
  } catch {
    /* error is shown via actionError */
  }
}

// Linkgrabber only: takes the package (with all its links) or the single link into the download list.
export const moveToDownloads = async (t: Target) => {
  closeMenu()
  const many = t.selectedLinkIds
  const what = many ? `The ${many.length} selected links` : t.kind === 'package' ? `The package "${t.name}" with all its links` : `The link "${t.name}"`
  const ok = await askConfirm({ title: 'Add to downloads', message: `${what} will be moved from the linkgrabber to the download list.`, confirmLabel: 'Add to downloads' })
  if (!ok) return
  const body = many ? { linkIds: many } : t.kind === 'package' ? { packageIds: [t.id] } : { linkIds: [t.id] }
  try {
    await run(() => post('/api/linkgrabber/move-to-downloads', body))
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
    await run(() => post(`/api/${t.area}/merge`, { destPackageId: t.id, packageIds: others }))
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
  const many = t.selectedLinkIds
  const what = many ? `The ${many.length} selected links` : t.kind === 'package' ? `The package "${t.name}" with all its links` : `The link "${t.name}"`
  const body = many ? { linkIds: many } : t.kind === 'package' ? { packageIds: [t.id] } : { linkIds: [t.id] }
  if (t.area === 'linkgrabber') {
    const ok = await askConfirm({ title: 'Remove', message: `${what} will be removed from the linkgrabber.`, confirmLabel: 'Remove', danger: true })
    if (!ok) return
    try {
      await run(() => post('/api/linkgrabber/remove', body))
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
    await run(() => post('/api/downloads/remove', { ...body, deleteFiles: option.checked }))
    selectedDownloadLinks.value = new Set() // the marked links are gone
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
    await run(() => post(`/api/${t.area}/split-by-host`, { packageIds: ids }))
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
    if (!t.enabled) await run(() => post('/api/downloads/enabled', { enabled: true, ...body }))
    await run(() => post('/api/downloads/start', body))
  } catch {
    /* error is shown via actionError */
  }
}

// Moves the package(s) or link(s) to the top or bottom of their list (links: inside their package).
export const moveToEdge = async (t: Target, position: 'top' | 'bottom') => {
  closeMenu()
  const ids = t.kind === 'package' ? (t.mergeIds ?? [t.id]) : (t.selectedLinkIds ?? [t.id])
  try {
    await run(() => post(`/api/${t.area}/move-to-edge`, { kind: t.kind, ids, position }))
  } catch {
    /* error is shown via actionError */
  }
}

// Package with several hosters: spreads its files over the hosters and disables the duplicate mirrors.
export const interleaveHosts = async (t: Target) => {
  closeMenu()
  try {
    const plan = await post(`/api/${t.area}/interleave`, { packageId: t.id, dryRun: true })
    const ok = await askConfirm({
      title: 'Interleave hosters',
      message: `The ${plan.parts} files of "${t.name}" will alternate between ${plan.hosts.join(', ')}. ${plan.disable} duplicate link${plan.disable === 1 ? '' : 's'} will be disabled, so nothing is downloaded twice.`,
      confirmLabel: 'Interleave'
    })
    if (!ok) return
    await run(() => post(`/api/${t.area}/interleave`, { packageId: t.id, dryRun: false }))
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e)
  }
}

export const startShowLinks = (target: Target) => {
  closeMenu()
  showingLinks.value = target
}
