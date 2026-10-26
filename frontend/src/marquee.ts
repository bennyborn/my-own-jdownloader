import type { Directive } from 'vue'

// While the binding is true, ping-pongs the clipped text of an overflow:hidden element
// via scrollLeft (phones only), pausing at both ends. scrollLeft is clamped by the browser
// to the real overflow, so no measuring is needed.
const PX_PER_SEC = 40
const PAUSE_MS = 900
const running = new WeakMap<HTMLElement, number>()

const phone = () => window.matchMedia('(max-width: 640px)').matches

function stop(el: HTMLElement) {
  const id = running.get(el)
  if (id !== undefined) cancelAnimationFrame(id)
  running.delete(el)
  el.scrollLeft = 0
  el.classList.remove('marquee')
}

function start(el: HTMLElement) {
  if (running.has(el)) return
  let dir = 1
  let pos = 0
  let pausedUntil = performance.now() + PAUSE_MS
  let last = performance.now()
  const tick = (now: number) => {
    const max = el.scrollWidth - el.clientWidth
    if (max > 1) {
      el.classList.add('marquee')
      if (now >= pausedUntil) {
        pos += (dir * PX_PER_SEC * (now - last)) / 1000
        if (pos >= max || pos <= 0) {
          pos = Math.min(max, Math.max(0, pos))
          dir = -dir
          pausedUntil = now + PAUSE_MS
        }
        el.scrollLeft = pos
      }
    } else {
      el.classList.remove('marquee')
    }
    last = now
    running.set(el, requestAnimationFrame(tick))
  }
  running.set(el, requestAnimationFrame(tick))
}

const sync = (el: HTMLElement, on: boolean) => (on && phone() ? start(el) : stop(el))

export const vMarquee: Directive<HTMLElement, boolean> = {
  mounted: (el, b) => sync(el, !!b.value),
  updated: (el, b) => sync(el, !!b.value),
  unmounted: (el) => stop(el)
}
