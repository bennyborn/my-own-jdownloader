import { ref } from 'vue'

// Which packages are open. Lives at module level so it survives tab switches (the views are
// unmounted then), but not a page reload: everything starts collapsed.
export const expandedDownloads = new Set<number>()
export const expandedGrabber = ref<Set<number>>(new Set())
