import { ref } from 'vue'
import { askConfirm } from './confirm'

export type Area = 'downloads' | 'linkgrabber'

// A package or link the user can act on (context menu, F2).
export interface Target {
  area: Area
  kind: 'package' | 'link'
  id: number
  name: string
  enabled: boolean
  running: boolean
  saveTo?: string
  // Linkgrabber packages: ids of all fully selected packages (including this one) when at least two are selected.
  mergeIds?: number[]
}

export const menu = ref<{ x: number; y: number; target: Target } | null>(null)
export const renaming = ref<Target | null>(null)
export const choosingFolder = ref<Target | null>(null)
export const showingLinks = ref<Target | null>(null)
export const hovered = ref<Target | null>(null)
export const actionError = ref('')
// Incremented after every successful change so lists can reload.
export const changeTick = ref(0)

export const openMenu = (event: MouseEvent, target: Target) => {
  event.preventDefault()
  menu.value = { x: event.clientX, y: event.clientY, target }
}
export const closeMenu = () => (menu.value = null)

export const setHovered = (target: Target) => (hovered.value = target)
export const clearHovered = (target: Target) => {
  if (hovered.value && hovered.value.kind === target.kind && hovered.value.id === target.id) hovered.value = null
}

// Why an action is not available right now (undefined = available).
export const renameBlocked = (t: Target) => (t.kind === 'link' && t.running ? 'The download is running' : undefined)
export const disableBlocked = (t: Target) => (t.enabled && t.running ? 'Running downloads cannot be disabled' : undefined)
export const folderBlocked = (t: Target) => (t.running ? 'The package has running downloads' : undefined)

export const startRename = (target: Target) => {
  if (renameBlocked(target)) return
  closeMenu()
  renaming.value = target
}
export const startFolder = (target: Target) => {
  if (folderBlocked(target)) return
  closeMenu()
  choosingFolder.value = target
}

const post = async (url: string, body: unknown) => {
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
}

const run = async (action: () => Promise<void>) => {
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
  if (disableBlocked(t)) return
  const body = t.kind === 'package' ? { packageIds: [t.id] } : { linkIds: [t.id] }
  try {
    await run(() => post(`/api/${t.area}/enabled`, { enabled: !t.enabled, ...body }))
  } catch {
    /* error is shown via actionError */
  }
}

// Linkgrabber only: takes the package (with all its links) or the single link into the download list.
export const moveToDownloads = async (t: Target) => {
  closeMenu()
  const what = t.kind === 'package' ? `The package "${t.name}" with all its links` : `The link "${t.name}"`
  const ok = await askConfirm({ title: 'Add to downloads', message: `${what} will be moved from the linkgrabber to the download list.`, confirmLabel: 'Add to downloads' })
  if (!ok) return
  const body = t.kind === 'package' ? { packageIds: [t.id] } : { linkIds: [t.id] }
  try {
    await run(() => post('/api/linkgrabber/move-to-downloads', body))
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
    await run(() => post('/api/linkgrabber/merge', { destPackageId: t.id, packageIds: others }))
  } catch {
    /* error is shown via actionError */
  }
}

export const startShowLinks = (target: Target) => {
  closeMenu()
  showingLinks.value = target
}
