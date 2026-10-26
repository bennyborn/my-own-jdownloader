// Touch devices have no right click: a long touch opens the context menu instead.
// (Chrome on Android would start dragging a draggable row and iOS sends no contextmenu event at all.)
export const coarsePointer = window.matchMedia('(pointer: coarse)').matches

const DELAY = 500
const TOLERANCE = 10 // px the finger may wander before it counts as a scroll
const DOUBLE_TAP = 350 // ms between two taps
const DOUBLE_TAP_DIST = 30 // px between two taps

let lastTap: { time: number; x: number; y: number } | undefined

// The click that follows a handled touch would toggle the row again.
const swallowNextClick = () => {
  const swallow = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', swallow, true), 1500)
}

export const longPress = (down: PointerEvent, fire: () => void) => {
  if (down.pointerType !== 'touch') return
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    stop()
    fire()
    lastTap = undefined
    // The finger is still down: swallow the click that follows its release.
    swallowNextClick()
  }, DELAY)
  const move = (e: PointerEvent) => Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > TOLERANCE && stop()
  // A quick second tap close to the first one opens the menu as well.
  const up = (e: PointerEvent) => {
    const wandered = Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > TOLERANCE
    stop()
    if (wandered) return
    const now = Date.now()
    if (lastTap && now - lastTap.time < DOUBLE_TAP && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_DIST) {
      lastTap = undefined
      fire()
      swallowNextClick()
    } else lastTap = { time: now, x: e.clientX, y: e.clientY }
  }
  const stop = () => {
    clearTimeout(timer)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', stop)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', stop)
}
