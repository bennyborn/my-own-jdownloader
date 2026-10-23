import { onMounted, onUnmounted, ref } from 'vue'
import type { DownloadsSnapshot } from './types'

// Subscribes to the backend's server-sent events; EventSource reconnects automatically.
export const useDownloads = () => {
  const snapshot = ref<DownloadsSnapshot | null>(null)
  const connected = ref(false)
  let source: EventSource | undefined

  onMounted(() => {
    source = new EventSource('/api/events')
    source.onopen = () => (connected.value = true)
    source.onerror = () => (connected.value = false)
    source.addEventListener('downloads', (event) => {
      snapshot.value = JSON.parse((event as MessageEvent).data)
    })
  })
  onUnmounted(() => source?.close())

  return { snapshot, connected }
}
