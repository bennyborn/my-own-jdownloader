import { ref, watch } from 'vue'

// Which packages are open. Lives at module level so it survives tab switches (the views are unmounted
// then), and in the sessionStorage so it also survives a reload of the page (but not a new browser tab).
const load = (key: string): Set<number> => {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? '[]')
    return new Set(Array.isArray(value) ? value.filter(Number.isSafeInteger) : [])
  } catch {
    return new Set()
  }
}
const save = (key: string, ids: Set<number>) => {
  try {
    sessionStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    /* private mode or storage full: the state is just not remembered */
  }
}

export const expandedDownloads = load('expandedDownloads')
export const saveExpandedDownloads = () => save('expandedDownloads', expandedDownloads)
export const expandedGrabber = ref<Set<number>>(load('expandedGrabber'))
watch(expandedGrabber, (ids) => save('expandedGrabber', ids))

// Packages marked with ctrl+click in the download list (merge candidates).
export const selectedDownloadPackages = ref<Set<number>>(new Set())

// Links marked in the download list (click, ctrl+click, shift+click); the context menu then acts on all of them.
export const selectedDownloadLinks = ref<Set<number>>(new Set())
// Where the last plain/ctrl click happened: the start of a shift+click range (ranges stay inside one package).
export const linkAnchor = ref<{ package: number; link: number } | null>(null)
