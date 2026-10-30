const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const rnd = (a, b) => a + Math.random() * (b - a)

// ---- Theme: stored choice, else the system. Colors fade for a moment when switching. ----
const darkQuery = matchMedia('(prefers-color-scheme: dark)')
const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : darkQuery.matches)

const themeButton = $('#theme')
const syncThemeLabel = () => {
  const label = isDark() ? 'Switch to light theme' : 'Switch to dark theme'
  themeButton.setAttribute('aria-label', label)
  themeButton.title = label
}

themeButton.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark'
  let style
  if (!reduced) {
    style = document.createElement('style')
    style.textContent = '*,*::before,*::after{transition:background-color .35s ease,color .35s ease,border-color .35s ease,fill .35s ease,stroke .35s ease!important}'
    document.head.appendChild(style)
    setTimeout(() => style.remove(), 500)
  }
  document.documentElement.dataset.theme = next
  try { localStorage.setItem('theme', next) } catch { /* ignore */ }
  syncThemeLabel()
  setImages()
})
darkQuery.addEventListener('change', () => { syncThemeLabel(); setImages() })
syncThemeLabel()

// ---- Screenshots: only the current theme is loaded first, the rest follows when the page is idle. ----
const shots = $$('.shots img')
const popup = $('.popup img')
const imageFor = (img) => (isDark() ? img.dataset.dark : img.dataset.light)
let allLoaded = false
function setImages() {
  const visible = shots.filter((img, i) => allLoaded || i === 0)
  visible.forEach((img) => { const src = imageFor(img); if (img.getAttribute('src') !== src) img.src = src })
  const p = imageFor(popup)
  if (popup.getAttribute('src') !== p) popup.src = p
}
function loadRest() {
  allLoaded = true
  setImages()
  // Warm the cache for the other theme, so toggling the theme does not wait for the network.
  ;[...shots, popup].forEach((img) => { const other = new Image(); other.src = isDark() ? img.dataset.light : img.dataset.dark })
}
setImages()
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 800))
addEventListener('load', () => idle(loadRest, { timeout: 3000 }))

// ---- Screenshot tabs ----
const tabs = $$('.tab')
tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((t) => { const on = t === tab; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)) })
  shots.forEach((img) => img.classList.toggle('on', img.dataset.tab === tab.dataset.tab))
  shots.forEach((img) => { img.alt = img.classList.contains('on') ? img.dataset.alt : '' })
  if (!allLoaded) loadRest()
}))

// ---- Burger menu ----
const burger = $('#burger')
const panel = $('#navpanel')
const scrim = $('#scrim')
function setMenu(open) {
  ;[burger, panel, scrim].forEach((el) => el.classList.toggle('open', open))
  burger.setAttribute('aria-expanded', String(open))
  burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
}
burger.addEventListener('click', () => setMenu(!burger.classList.contains('open')))
scrim.addEventListener('click', () => setMenu(false))
$$('.plink', panel).forEach((a) => a.addEventListener('click', () => setMenu(false)))
addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false) })

// ---- Hero keywords: hold a word, flash through all of them with motion blur, land on the next one. ----
const words = ['Faster.', 'More modern.', 'Self-hosted.', 'Phone-friendly.', 'Private.']
const fxw = $('.fxw')
const icons = $$('.ic svg')
const showIcon = (word) => icons.forEach((svg) => svg.toggleAttribute('hidden', svg.dataset.w !== word))
const hideIcons = () => icons.forEach((svg) => svg.setAttribute('hidden', ''))
let current = 0
let ready = reduced // the icons wait until the intro has revealed the line
function setWord(i, fx) {
  current = i
  fxw.textContent = words[i]
  fxw.className = 'fxw' + (fx === 'none' ? '' : ' ' + fx)
  if (fx === 'none' && ready) showIcon(words[i])
  else hideIcons()
}
function burst(frame) {
  const total = words.length + 1
  const next = (current + 1) % words.length
  const fx = frame < total - 2 ? 'heavy' : frame < total - 1 ? 'medium' : 'none'
  setWord(next, fx)
  if (frame < total - 1) { setTimeout(() => burst(frame + 1), frame < total - 2 ? 48 : 70); return }
  setTimeout(() => burst(0), 3600)
}
hideIcons()
if (reduced) showIcon(words[0])
else {
  setTimeout(() => { ready = true; showIcon(words[current]) }, 2350)
  setTimeout(() => burst(0), 6000)
}

// ---- Intro: measures where the logo ends up, so it can start large in the middle of the hero and travel there. ----
;(function initIntro() {
  const logo = $('.herologo')
  const top = $('#top')
  const hero = top.parentNode
  if (reduced || logo.offsetParent === null) return
  const centerY = top.offsetTop + logo.offsetTop + logo.offsetHeight / 2
  const scale = Math.max(1.4, Math.min(2.4, (hero.clientHeight * 0.5) / logo.offsetHeight, (hero.clientWidth * 0.6) / logo.offsetWidth))
  logo.style.setProperty('--logo-dy', Math.round(hero.clientHeight / 2 - centerY) + 'px')
  logo.style.setProperty('--logo-s', scale.toFixed(2))
})()

// ---- Scroll reveal: everything below the hero fades and rises into place once. ----
;(function initReveal() {
  if (reduced || !('IntersectionObserver' in window)) return
  const items = $$('.eyebrow, .h2, .card, .li, [data-rv]')
  const seen = new Map()
  items.forEach((el) => {
    const n = seen.get(el.parentNode) || 0
    seen.set(el.parentNode, n + 1)
    el.dataset.rvDelay = String(Math.min(n, 5) * 80)
  })
  document.documentElement.classList.add('js-rv')
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      const el = entry.target
      observer.unobserve(el)
      el.style.transitionDelay = el.dataset.rvDelay + 'ms'
      el.classList.add('rv-in')
      setTimeout(() => { el.style.transitionDelay = '' }, 1400)
    })
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
  items.forEach((el) => observer.observe(el))
})()

// ---- Hero speed graph: a simulated download session, drawn like the graph in the real UI. ----
// Speed in MB/s. The session ramps up, holds a plateau with noise, dips now and then and drops to nearly zero
// between two files. Mouse movement and scrolling add "energy" that lifts the speed.
;(function initGraph() {
  const canvas = $('#speedgraph')
  const ctx = canvas.getContext('2d')
  const WINDOW = 90 // seconds visible
  const g = {
    tt: 0, v: 0, live: 0, plateau: rnd(45, 90), dip: 1, dipEnd: 0, gap: false, gapEnd: 0,
    next: 9, noise: 0, noiseGoal: 0, noiseAt: 0, sampleAt: 0, energy: 0, peak: 0,
    samples: [], mouse: { x: 0, y: 0, px: null, py: null, inside: false },
  }

  const step = (dt) => {
    g.tt += dt
    g.energy *= Math.exp(-dt / 1.6)
    if (g.tt >= g.next) {
      const r = Math.random()
      if (r < 0.4) { g.dip = rnd(0.25, 0.65); g.dipEnd = g.tt + rnd(3, 8); g.next = g.dipEnd + rnd(6, 18) }
      else if (r < 0.75) { g.gap = true; g.gapEnd = g.tt + rnd(1.2, 3); g.next = g.gapEnd + rnd(12, 30) }
      else { g.plateau = Math.min(110, Math.max(25, g.plateau * rnd(0.7, 1.3))); g.next = g.tt + rnd(8, 24) }
    }
    if (g.dip < 1 && g.tt > g.dipEnd) g.dip = 1
    if (g.gap && g.tt > g.gapEnd) { g.gap = false; g.plateau = rnd(35, 100) }
    if (g.tt >= g.noiseAt) { g.noiseGoal = (Math.random() - 0.5) * 0.1 * (1 + g.energy * 1.5); g.noiseAt = g.tt + 0.3 }
    g.noise += (g.noiseGoal - g.noise) * (1 - Math.exp(-dt / 0.25))
    const goal = g.gap ? 0 : g.plateau * g.dip * (1 + 0.35 * g.energy)
    g.v += (goal - g.v) * (1 - Math.exp(-dt / (goal > g.v ? 1.4 : 0.35)))
    g.live = Math.max(0, g.v * (1 + g.noise))
    if (g.tt >= g.sampleAt) { g.samples.push({ t: g.tt, v: g.live }); g.sampleAt = g.tt + 0.7 }
    while (g.samples.length && g.samples[0].t < g.tt - WINDOW - 20) g.samples.shift()
  }
  for (let i = 0; i < 1100; i++) step(0.1) // history, so the graph is full from the first frame

  const fmt = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' MB/s'
  const lastTops = new WeakMap()
  if (!reduced) {
    addEventListener('pointermove', (e) => {
      const m = g.mouse
      if (m.px !== null) g.energy = Math.min(1, g.energy + Math.hypot(e.clientX - m.px, e.clientY - m.py) / 900)
      m.px = e.clientX; m.py = e.clientY; m.x = e.clientX; m.y = e.clientY; m.inside = true
    }, { passive: true })
    document.addEventListener('mouseleave', () => { g.mouse.inside = false })
    addEventListener('scroll', (e) => {
      const el = e.target === document ? document.scrollingElement : e.target
      if (!el) return
      const top = el.scrollTop || 0
      const prev = lastTops.get(el)
      lastTops.set(el, top)
      if (prev !== undefined) g.energy = Math.min(1, g.energy + Math.abs(top - prev) / 700)
    }, { capture: true, passive: true })
  }

  let last = 0
  const frame = (ts) => {
    requestAnimationFrame(frame)
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0
    last = ts
    if (!reduced) step(dt)
    const rect = canvas.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > innerHeight) return
    const ratio = devicePixelRatio || 1
    const cw = Math.max(1, Math.round(rect.width * ratio))
    const ch = Math.max(1, Math.round(rect.height * ratio))
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
    const w = rect.width
    const h = rect.height
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const css = getComputedStyle(canvas)
    const accent = css.getPropertyValue('--accent').trim() || '#10ac84'
    const text = css.getPropertyValue('--text').trim() || '#fff'
    const surface = css.getPropertyValue('--surface').trim() || '#222'
    const border = css.getPropertyValue('--border-strong').trim() || '#444'

    const vis = g.samples.filter((s) => g.tt - s.t <= WINDOW + 10)
    const target = Math.max(20, ...vis.map((s) => s.v), g.live) * 1.35
    g.peak = g.peak ? g.peak + (target - g.peak) * (1 - Math.exp(-dt / 0.8)) : target
    const x = (t) => w - ((g.tt - t) / WINDOW) * w
    const y = (v) => h - 3 - (v / g.peak) * (h - 8)
    const pts = vis.map((s) => ({ x: x(s.t), y: y(s.v), v: s.v, t: s.t }))
    pts.push({ x: w, y: y(g.live), v: g.live, t: g.tt })

    const curve = () => {
      for (let i = 1; i < pts.length; i++) {
        const mid = (pts[i - 1].x + pts[i].x) / 2
        ctx.bezierCurveTo(mid, pts[i - 1].y, mid, pts[i].y, pts[i].x, pts[i].y)
      }
    }
    ctx.beginPath()
    ctx.moveTo(pts[0].x, h)
    ctx.lineTo(pts[0].x, pts[0].y)
    curve()
    ctx.lineTo(w, h)
    ctx.closePath()
    const fill = ctx.createLinearGradient(0, 0, 0, h)
    fill.addColorStop(0, accent + '55')
    fill.addColorStop(0.6, accent + '1a')
    fill.addColorStop(1, accent + '00')
    ctx.fillStyle = fill
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    curve()
    ctx.strokeStyle = accent + 'cc'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.font = "500 12px 'JetBrains Mono', monospace"
    const m = g.mouse
    const mx = m.x - rect.left
    const my = m.y - rect.top
    const hover = !reduced && m.inside && mx >= 0 && mx <= w && my >= 0 && my <= h
    let near = null
    if (hover) {
      near = pts.reduce((a, b) => (Math.abs(b.x - mx) < Math.abs(a.x - mx) ? b : a))
      ctx.beginPath()
      ctx.moveTo(near.x + 0.5, 0)
      ctx.lineTo(near.x + 0.5, h)
      ctx.strokeStyle = accent + '55'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    // Dot and label: the live value at the right edge, or the sample under the cursor.
    const mark = near || pts[pts.length - 1]
    ctx.beginPath()
    ctx.arc(Math.min(w - 4, mark.x), mark.y, 4, 0, Math.PI * 2)
    ctx.fillStyle = accent
    ctx.fill()
    const age = Math.round(g.tt - mark.t)
    const label = near && age > 0 ? fmt(mark.v) + '  ' + age + 's ago' : fmt(mark.v)
    const tw = ctx.measureText(label).width + 20
    const lx = Math.max(4, Math.min(w - tw - 4, mark.x - tw / 2 - (near ? 0 : tw / 2 - 20)))
    const ly = mark.y > 56 ? mark.y - 38 : mark.y + 12
    ctx.beginPath()
    ctx.roundRect(lx, ly, tw, 26, 7)
    ctx.fillStyle = surface
    ctx.fill()
    ctx.strokeStyle = border
    ctx.stroke()
    ctx.fillStyle = text
    ctx.textBaseline = 'middle'
    ctx.fillText(label, lx + 10, ly + 13.5)
    ctx.textBaseline = 'alphabetic'
  }
  requestAnimationFrame(frame)
})()
