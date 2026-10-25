import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ALL, currentDevice, devices, devicesLoaded, showingAll } from './devices'
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

// Subscribes to the backend's server-sent events; EventSource reconnects automatically.
// One stream serves the shown device, or all online devices in the overview.
export const useDownloads = () => {
  const snapshots = ref<Record<string, DownloadsSnapshot>>({})
  const connected = ref(false)
  let source: EventSource | undefined

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

  const connect = () => {
    source?.close()
    if (!streamKey.value) return
    source = new EventSource(`/api/events?device=${showingAll.value ? ALL : encodeURIComponent(currentDevice.value)}`)
    source.onopen = () => (connected.value = true)
    source.onerror = () => (connected.value = false)
    source.addEventListener('downloads', (event) => {
      const { device, ...rest } = JSON.parse((event as MessageEvent).data) as DownloadsSnapshot & { device: string }
      // The first message of a device that was never polled is empty; the real one follows right away.
      if (!rest.updatedAt) return
      announceFinished(device, snapshots.value[device], rest)
      snapshots.value = { ...snapshots.value, [device]: rest }
    })
  }

  onMounted(() => watch(streamKey, connect, { immediate: true }))
  onUnmounted(() => source?.close())

  return { snapshot, snapshots, connected }
}
