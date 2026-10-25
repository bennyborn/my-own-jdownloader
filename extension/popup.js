import { api, ApiError, getSettings, hostIcon, withDevice } from './api.js'
import { icon } from './icons.js'

const WINDOW_MS = 5 * 60 * 1000
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

const formatBytes = (bytes) => {
  if (!(bytes > 0)) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
// Time left as mm:ss (h:mm:ss from an hour on).
const formatCountdown = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${s}` : `${mm}:${s}`
}
// Like the web interface's status bar, e.g. "5d:17h:12m".
const formatLongEta = (seconds) => {
  if (seconds === null || !isFinite(seconds) || seconds <= 0) return '–'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d:${h}h:${m}m`
  if (h > 0) return `${h}h:${m}m`
  return `${m}m:${Math.floor(seconds % 60)}s`
}

// Speed graph in the background of a card (same look as the status bar of the web interface).
// Scrolls continuously with real time (x depends on the sample's age), so it glides between updates.
const drawGraph = (canvas, samples) => {
  const ratio = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return
  const pixelW = Math.round(w * ratio)
  const pixelH = Math.round(h * ratio)
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW
    canvas.height = pixelH
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const now = Date.now()
  const visible = samples.filter((s) => now - s.t <= WINDOW_MS + 10000)
  if (!visible.length) return
  const peak = Math.max(...visible.map((s) => s.v), 100 * 1024) * 1.15
  const x = (t) => w - ((now - t) / WINDOW_MS) * w
  const y = (v) => h - 3 - (v / peak) * (h - 8)
  const points = [...visible.map((s) => ({ x: x(s.t), y: y(s.v) })), { x: w, y: y(visible[visible.length - 1].v) }]
  const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#10ac84'
  const curve = () => {
    for (let i = 1; i < points.length; i++) {
      const mid = (points[i - 1].x + points[i].x) / 2
      ctx.bezierCurveTo(mid, points[i - 1].y, mid, points[i].y, points[i].x, points[i].y)
    }
  }
  ctx.beginPath()
  ctx.moveTo(points[0].x, h)
  ctx.lineTo(points[0].x, points[0].y)
  curve()
  ctx.lineTo(w, h)
  ctx.closePath()
  const fill = ctx.createLinearGradient(0, 0, 0, h)
  fill.addColorStop(0, accent + '66')
  fill.addColorStop(1, accent + '0d')
  ctx.fillStyle = fill
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  curve()
  ctx.strokeStyle = accent + 'bb'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

// One card per device (offline ones too, greyed out).
const devicesEl = document.getElementById('devices')
// One canvas per device that survives the card being rebuilt on every update, so the animation never restarts.
const graphs = new Map() // device id -> canvas
const graphOf = (id) => graphs.get(id) ?? graphs.set(id, el('canvas', { ariaHidden: 'true' })).get(id)
const samples = new Map() // device id -> [{ t, v }]

const loadHistory = async (id) => {
  try {
    const data = await api(withDevice('/api/speed-history', id))
    const offset = Date.now() - data.now
    samples.set(id, data.samples.map((s) => ({ t: s.t + offset, v: s.v })))
  } catch {
    /* the graph then starts empty */
  }
}

const deviceCard = async (d, backendUrl) => {
  const online = d.status === 'ONLINE'
  if (!samples.has(d.id)) await loadHistory(d.id)
  const history = samples.get(d.id) ?? []
  history.push({ t: Date.now(), v: d.downloads.speed })
  samples.set(d.id, history.filter((s) => s.t >= Date.now() - WINDOW_MS - 30000))

  const open = el('button', { className: 'primary', textContent: 'Open', title: 'Open the web interface for this device' })
  open.addEventListener('click', () => {
    chrome.tabs.create({ url: `${backendUrl}/#downloads?device=${encodeURIComponent(d.id)}` })
    window.close()
  })
  const head = el('div', { className: 'head' }, el('span', { className: 'dot' + (online ? ' online' : ''), title: d.status }), el('span', { className: 'name', textContent: d.name, title: d.name }), open)
  const item = (name, text, props = {}) => el('span', { className: 'item num', ...props }, icon(name), text)
  const running = d.downloads.running > 0
  const body = running
    ? [
        el(
          'div',
          { className: 'stats' },
          item('gauge', `${formatBytes(d.downloads.speed)}/s`, { className: 'item num speed', title: 'Download speed' }),
          item('clock', formatLongEta(d.downloads.eta), { title: 'Finished in' })
        )
      ]
    : [el('div', { className: 'muted', textContent: online ? 'No downloads running' : 'Offline' })]
  const queue = el(
    'div',
    { className: 'queue' },
    item('package', String(d.queue.packages), { title: 'Packages' }),
    item('download', String(d.queue.running), { title: 'Running downloads' }),
    item('link-2', String(d.queue.links), { title: 'Links' }),
    running ? el('span', { className: 'item num size', title: 'Loaded / total size' }, icon('hard-drive'), formatBytes(d.downloads.bytesLoaded), el('span', { className: 'muted', textContent: ` / ${formatBytes(d.downloads.bytesTotal)}` })) : ''
  )
  const card = el('div', { className: 'card' + (online ? '' : ' offline') }, graphOf(d.id), head, ...body, queue)
  return card
}

// Big icon with text below, like the empty linkgrabber of the web interface.
const errorState = (e) => {
  const kind = e instanceof ApiError ? e.kind : 'http'
  const [name, title, sub] =
    kind === 'config'
      ? ['settings', 'No backend set', 'Enter the address of your my-own-jdownloader in the settings.']
      : kind === 'auth'
        ? ['lock', 'Wrong password', 'Check the UI password in the settings.']
        : kind === 'network'
          ? ['cloud-off', 'Backend not reachable', e.message]
          : ['cloud-off', 'Something went wrong', e instanceof Error ? e.message : String(e)]
  return el('div', { className: 'empty' }, icon(name, 56, 1.25), el('div', { className: 'title', textContent: title }), el('div', { className: 'sub', textContent: sub }))
}

// Title and settings button stay hidden while the first answer is awaited (only the logo and "Connecting…" show).
const bar = document.getElementById('bar')
const renderDevices = async () => {
  try {
    const [list, { backendUrl }] = await Promise.all([api('/api/devices'), getSettings()])
    const details = await Promise.all(list.map((d) => api(withDevice('/api/device', d.id))))
    // The default device first, then the others by name; offline devices stay at the end.
    const order = (d) => [d.status === 'ONLINE' ? 0 : 1, list.find((x) => x.id === d.id)?.default ? 0 : 1, d.name]
    details.sort((a, b) => {
      const [x, y] = [order(a), order(b)]
      return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2])
    })
    devicesEl.replaceChildren(...(await Promise.all(details.map((d) => deviceCard(d, backendUrl)))))
    for (const id of graphs.keys()) if (!list.some((d) => d.id === id)) graphs.delete(id)
  } catch (e) {
    devicesEl.replaceChildren(errorState(e))
  }
  bar.hidden = false
}

const list = document.getElementById('list')
const captchasSection = document.getElementById('captchas')
const devicesTitle = document.getElementById('devices-title')
document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage())

// Captcha rows are only rebuilt when the set of jobs changes; the countdown is updated in place every
// second, so clicks never hit a row that was just replaced.
let captchaJobs = []
let captchaKey = ''
const countdowns = new Map() // job id -> element showing the time left
const updateCountdowns = () => {
  for (const j of captchaJobs) {
    const target = countdowns.get(j.id)
    if (!target) continue
    const ms = j.remaining - (Date.now() - j.fetchedAt)
    target.textContent = formatCountdown(ms)
    target.parentElement.classList.toggle('low', ms < 60000)
  }
}

const renderCaptchas = async () => {
  try {
    const fetchedAt = Date.now()
    captchaJobs = (await api('/api/captcha')).map((j) => ({ ...j, fetchedAt }))
    // The section only exists while a captcha is waiting.
    captchasSection.hidden = !captchaJobs.length
    devicesTitle.hidden = !captchaJobs.length // the heading is only needed to tell the two lists apart
    const key = captchaJobs.map((j) => j.id).join(',')
    if (key !== captchaKey) {
      captchaKey = key
      countdowns.clear()
      const { backendUrl } = await getSettings()
      list.replaceChildren(
        ...captchaJobs.map((j) => {
          const img = el('img', { alt: '' })
          img.hidden = true
          void hostIcon(j.hoster).then((url) => url && ((img.src = url), (img.hidden = false)))
          const time = el('span')
          countdowns.set(j.id, time)
          const left = el('span', { className: 'left', title: 'Time left to answer' }, icon('clock', 13), time)
          const button = el('button', { className: 'primary', textContent: 'Solve' })
          button.addEventListener('click', async () => {
            // Pictures are typed off in the web interface, token captchas are solved on the hoster's page.
            if (j.kind === 'image') {
              chrome.tabs.create({ url: `${backendUrl}/#downloads?device=${encodeURIComponent(j.device)}` })
              window.close()
              return
            }
            const res = await chrome.runtime.sendMessage({ type: 'open', id: j.id, device: j.device })
            if (res?.ok === false) host.textContent = res.error
            else window.close()
          })
          const host = el('span', { className: 'host', textContent: j.hoster, title: j.hoster })
          return el('div', { className: 'job' }, img, host, left, button)
        })
      )
    }
    updateCountdowns()
  } catch {
    captchasSection.hidden = true
    devicesTitle.hidden = true // the device card already shows that the backend is unreachable
  }
}

const frame = () => {
  requestAnimationFrame(frame)
  for (const [id, canvas] of graphs) drawGraph(canvas, samples.get(id) ?? [])
}
requestAnimationFrame(frame)

void renderDevices()
void renderCaptchas()
setInterval(renderDevices, 3000)
setInterval(renderCaptchas, 5000)
setInterval(updateCountdowns, 1000)
