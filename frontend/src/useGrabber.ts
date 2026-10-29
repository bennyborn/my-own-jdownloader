import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import { currentDevice, devices, showingAll, withDevice } from './devices'
import { liveScope, useLive } from './live'
import type { GrabberState } from './types'

// The linkgrabber of the shown device, or of every online device in the overview of all devices (from the live stream, live.ts).
export const useGrabber = (visible: Ref<boolean>) => {
  const states = ref<Record<string, GrabberState>>({})
  const error = ref('')
  const boosting = ref(false) // right after adding links: JD may not report "collecting" yet
  let boostBaseline = 0
  let boostTimer: ReturnType<typeof setTimeout> | undefined

  const ids = computed(() => (showingAll.value ? devices.value.filter((d) => d.online !== false).map((d) => d.id) : currentDevice.value ? [currentDevice.value] : []))
  // The linkgrabber of the current device (the normal view).
  const state = computed(() => states.value[currentDevice.value] ?? null)
  const shown = computed(() => ids.value.map((id) => states.value[id]).filter((s): s is GrabberState => s !== undefined))

  const loadOne = async (id: string) => {
    try {
      const res = await fetch(withDevice('/api/linkgrabber', id))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      states.value = { ...states.value, [id]: await res.json() }
      error.value = ''
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }
  const load = async () => {
    await Promise.all(ids.value.map(loadOne))
  }

  const linkCount = computed(() => shown.value.reduce((sum, s) => sum + s.packages.reduce((n, p) => n + p.links.length, 0), 0))
  const hasUnknown = computed(() => shown.value.some((s) => s.packages.some((p) => p.links.some((l) => l.availability === 'UNKNOWN'))))
  // "Analysing" only while JD is collecting and links are still unchecked: unchecked links can stay behind for good
  // (e.g. a plugin defect), and must not keep the toast up once JD has stopped collecting.
  const collecting = computed(() => shown.value.some((s) => s.collecting))
  const analysing = computed(() => (collecting.value && hasUnknown.value) || boosting.value)

  // The stream brings the changes; it looks at the linkgrabber quickly while the page is shown or JD is analysing links, slowly otherwise
  // (the slow look keeps the link counter on the tab up to date).
  watch(analysing, () => (liveScope.value = { ...liveScope.value, grabberFast: visible.value || analysing.value }))
  watch(visible, () => (liveScope.value = { ...liveScope.value, grabberFast: visible.value || analysing.value }), { immediate: true })
  useLive('grabber', (data) => {
    const { device, ...rest } = data as GrabberState & { device: string }
    states.value = { ...states.value, [device]: rest }
    error.value = ''
    // End the boost once the new links have shown up and all of them are checked.
    if (boosting.value && linkCount.value > boostBaseline && !hasUnknown.value) boosting.value = false
  })

  // Right after adding links: look now, and keep the quick look until the new links have shown up (JD may not report "collecting" yet).
  const boost = (ms = 15000) => {
    boostBaseline = linkCount.value
    boosting.value = true
    clearTimeout(boostTimer)
    boostTimer = setTimeout(() => (boosting.value = false), ms)
    void load()
  }

  // Drops the "analysing" state again, e.g. when adding failed and nothing new will show up.
  const cancelBoost = () => {
    clearTimeout(boostTimer)
    boosting.value = false
  }

  // Another device (or the overview): the stream is asked again by useDownloads; the old state of a device stays until its first event.
  onUnmounted(() => clearTimeout(boostTimer))

  return { state, states, error, reload: load, boost, cancelBoost, analysing, linkCount }
}
