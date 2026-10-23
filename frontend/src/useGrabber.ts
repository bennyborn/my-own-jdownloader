import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue'
import type { GrabberState } from './types'

// Polls the linkgrabber: fast while it is visible or JD is analysing links, slowly otherwise
// (the slow poll keeps the link counter on the tab up to date).
export const useGrabber = (visible: Ref<boolean>) => {
  const state = ref<GrabberState | null>(null)
  const error = ref('')
  const boosting = ref(false) // right after adding links: JD may not report "collecting" yet
  let boostBaseline = 0
  let boostTimer: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const load = async () => {
    try {
      const res = await fetch('/api/linkgrabber')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      state.value = await res.json()
      error.value = ''
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  const linkCount = computed(() => state.value?.packages.reduce((sum, p) => sum + p.links.length, 0) ?? 0)
  const hasUnknown = computed(() => state.value?.packages.some((p) => p.links.some((l) => l.availability === 'UNKNOWN')) ?? false)
  // "Analysing" only while links are still unchecked (JD's collecting flag can stay on much longer).
  const analysing = computed(() => hasUnknown.value || boosting.value)

  const loop = async () => {
    await load()
    if (stopped) return
    // End the boost once the new links have shown up and all of them are checked.
    if (boosting.value && linkCount.value > boostBaseline && !hasUnknown.value) boosting.value = false
    const fast = visible.value || hasUnknown.value || boosting.value
    timer = setTimeout(loop, boosting.value ? 1000 : fast ? 2000 : 15000)
  }

  // Poll quickly for a while so new links show up as soon as JD has found them.
  const boost = (ms = 15000) => {
    boostBaseline = linkCount.value
    boosting.value = true
    clearTimeout(boostTimer)
    boostTimer = setTimeout(() => (boosting.value = false), ms)
    clearTimeout(timer)
    void loop()
  }

  onMounted(loop)
  onUnmounted(() => {
    stopped = true
    clearTimeout(timer)
    clearTimeout(boostTimer)
  })

  return { state, error, reload: load, boost, analysing, linkCount }
}
