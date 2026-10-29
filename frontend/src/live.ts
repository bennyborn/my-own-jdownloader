import { onMounted, onUnmounted, ref, watch } from 'vue'

// The one stream of the page (backend: /api/live): captchas, questions of the JDownloaders, the device list, and for the shown device
// (or all of them) the downloads and the linkgrabber. It is open while the tab is visible (a hidden tab costs nothing) and delivers every
// event once on connecting, then only changes. EventSource reconnects by itself.
type Handler = (data: unknown) => void
type Event = 'captcha' | 'dialogs' | 'devices' | 'downloads' | 'grabber'
const EVENTS: Event[] = ['captcha', 'dialogs', 'devices', 'downloads', 'grabber']

const handlers = new Map<Event, Set<Handler>>()
let source: EventSource | undefined
let users = 0

// What the stream is asked for: the devices whose downloads and linkgrabber are wanted ('' = none yet, 'all' = every online device),
// whether the linkgrabber is looked at quickly, and `rev` for a change that needs a new connection (a new set of devices in the overview).
export const liveScope = ref({ device: '', grabberFast: true, rev: '' })
export const liveConnected = ref(false)

const stop = () => {
  source?.close()
  source = undefined
  liveConnected.value = false
}

const start = () => {
  stop()
  if (document.hidden || !users) return
  const { device, grabberFast } = liveScope.value
  const query = new URLSearchParams()
  if (device) query.set('device', device)
  if (device && !grabberFast) query.set('grabber', 'slow')
  source = new EventSource(`/api/live${query.size ? `?${query}` : ''}`)
  source.onopen = () => (liveConnected.value = true)
  source.onerror = () => (liveConnected.value = false)
  for (const name of EVENTS) {
    source.addEventListener(name, (event) => {
      let data: unknown
      try {
        data = JSON.parse((event as MessageEvent).data)
      } catch {
        return
      }
      for (const handler of handlers.get(name) ?? []) handler(data)
    })
  }
}

const onVisibility = () => (document.hidden ? stop() : start())
let unwatch: (() => void) | undefined

// Calls `handler` with every update of `event`. Use inside a component (or composable that runs in one).
export const useLive = (event: Event, handler: Handler) => {
  onMounted(() => {
    handlers.set(event, (handlers.get(event) ?? new Set()).add(handler))
    if (!users++) {
      document.addEventListener('visibilitychange', onVisibility)
      unwatch = watch(liveScope, start, { deep: true })
    }
    // The first user starts it; the others come in the same tick and would only restart it with the same scope.
    if (!source) queueMicrotask(() => !source && start())
  })
  onUnmounted(() => {
    handlers.get(event)?.delete(handler)
    if (!--users) {
      document.removeEventListener('visibilitychange', onVisibility)
      unwatch?.()
      stop()
    }
  })
}
