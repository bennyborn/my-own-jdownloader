import { computed, ref, watch } from 'vue'
import { ALL, currentDevice, devices, devicesLoaded, showingAll } from './devices'
import { liveConnected, liveScope, useLive } from './live'
import { showSuccess } from './toast'
import type { DownloadsSnapshot } from './types'

// A package that was unfinished in the previous snapshot of its device and is finished now: tell the user.
// Without a previous snapshot (page just opened) nothing is announced.
const announceFinished = (device: string, before: DownloadsSnapshot | undefined, after: DownloadsSnapshot) => {
  if (!before) return
  const wasOpen = new Set(before.packages.filter((p) => !p.finished).map((p) => p.uuid))
  const multiple = devices.value.length > 1
  const name = devices.value.find((d) => d.id === device)?.name
  for (const p of after.packages) {
    if (p.finished && wasOpen.has(p.uuid)) showSuccess(`Download finished: ${p.name}${multiple && name ? ` (${name})` : ''}`)
  }
}

// The downloads of the shown device (or all of them) from the live stream (live.ts).
// One stream serves the shown device, or all online devices in the overview.
export const useDownloads = () => {
  const snapshots = ref<Record<string, DownloadsSnapshot>>({})

  // The snapshot of the current device (the list and the status bar of the normal view).
  const snapshot = computed({
    get: () => snapshots.value[currentDevice.value] ?? null,
    set: (value: DownloadsSnapshot | null) => {
      if (value) snapshots.value = { ...snapshots.value, [currentDevice.value]: value }
    }
  })

  const streamKey = computed(() => {
    if (!devicesLoaded.value) return ''
    return showingAll.value ? `${ALL}:${devices.value.filter((d) => d.online !== false).map((d) => d.id).join(',')}` : currentDevice.value
  })

  // The stream is the shared one (live.ts); this says for which devices the downloads are wanted.
  watch(streamKey, () => (liveScope.value = { ...liveScope.value, device: streamKey.value ? (showingAll.value ? ALL : currentDevice.value) : '', rev: streamKey.value }), { immediate: true })
  useLive('downloads', (data) => {
    const { device, ...rest } = data as DownloadsSnapshot & { device: string }
    // The first message of a device that was never polled is empty; the real one follows right away.
    if (!rest.updatedAt) return
    announceFinished(device, snapshots.value[device], rest)
    snapshots.value = { ...snapshots.value, [device]: rest }
  })

  return { snapshot, snapshots, connected: liveConnected }
}
