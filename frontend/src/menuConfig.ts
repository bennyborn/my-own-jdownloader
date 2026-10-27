import { ref } from 'vue'
import { showError } from './toast'

// The optional entries of the item context menu (packages and links). What every item needs (start / stop, enable / disable,
// add to downloads, variants, merge, remove) is not in here. A new entry is one line here plus its place in ContextMenu.vue.
export interface MenuEntry {
  id: string
  label: string
  hint: string
  default: boolean
  needsExtraction?: boolean // useless while the archive extractor of the JD is switched off
}

export const MENU_ENTRIES: MenuEntry[] = [
  { id: 'stopMark', label: 'Stop mark', hint: 'Stop the downloads before this item', default: true },
  { id: 'resume', label: 'Resume', hint: 'Take skipped links back into the queue', default: true },
  { id: 'extract', label: 'Extract now', hint: 'Start the extraction of the archive', default: true, needsExtraction: true },
  { id: 'archiveOptions', label: 'Archive options', hint: 'Extract after download, delete archives and links after extraction', default: true, needsExtraction: true },
  { id: 'archivePassword', label: 'Add archive password', hint: 'Adds a password to the list JD tries on archives', default: true, needsExtraction: true },
  { id: 'rename', label: 'Rename', hint: 'Also on F2', default: true },
  { id: 'showLinks', label: 'Show download links', hint: 'The URLs of the item, to copy', default: true },
  { id: 'checkOnline', label: 'Check online status', hint: 'Ask the hosters whether the files are still there', default: true },
  { id: 'downloadPassword', label: 'Set download password', hint: 'The password JD sends along when downloading', default: true },
  { id: 'priority', label: 'Set priority', hint: 'Which links JD downloads first', default: false },
  { id: 'folder', label: 'Change download folder', hint: 'Packages only', default: true },
  { id: 'split', label: 'Split by host', hint: 'Packages only', default: true },
  { id: 'interleave', label: 'Interleave hosters', hint: 'Packages with more than one host', default: true },
  { id: 'sort', label: 'Sort links alphabetically', hint: 'Packages only', default: true },
  { id: 'move', label: 'Move up / down / to top / to bottom', hint: 'Also possible by drag and drop', default: true },
  { id: 'cleanup', label: 'Clean up', hint: 'Remove the disabled, failed, finished, offline or duplicate links of the selection', default: true },
  { id: 'reset', label: 'Reset', hint: 'Deletes the downloaded files and starts again', default: true }
]

// What the user switched is kept by the backend (one choice for every browser). An entry the user never touched follows its
// default, so a default can change later. Until the answer of the backend is there the defaults apply.
const choice = ref<Record<string, boolean>>({})

fetch('/api/ui-settings')
  .then((res) => (res.ok ? res.json() : undefined))
  .then((saved) => saved && (choice.value = saved.contextMenu ?? {}))
  .catch(() => {
    /* defaults */
  })

export const menuEntryOn = (id: string): boolean => choice.value[id] ?? MENU_ENTRIES.find((e) => e.id === id)?.default ?? true

const save = async (next: Record<string, boolean>) => {
  const before = choice.value
  choice.value = next
  try {
    const res = await fetch('/api/ui-settings/context-menu', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contextMenu: next }) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    choice.value = before
    showError(`Could not save the context menu: ${e instanceof Error ? e.message : e}`)
  }
}

export const setMenuEntry = (id: string, on: boolean) => save({ ...choice.value, [id]: on })

export const resetMenuEntries = () => save({})
