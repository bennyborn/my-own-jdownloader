// Touch devices have no right click: a long touch opens the context menu instead.
// (Chrome on Android would start dragging a draggable row and iOS sends no contextmenu event at all.)
export const coarsePointer = window.matchMedia('(pointer: coarse)').matches

const DELAY = 500
const TOLERANCE = 10 // px the finger may wander before it counts as a scroll

export const longPress = (down: PointerEvent, fire: () => void) => {
  if (down.pointerType !== 'touch') return
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    stop()
    fire()
    // The finger is still down: swallow the click that follows its release, it would toggle the row again.
    const swallow = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true), 1500)
  }, DELAY)
  const move = (e: PointerEvent) => Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > TOLERANCE && stop()
  const stop = () => {
    clearTimeout(timer)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}
