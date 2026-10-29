import { api, getCnlDevice, getCnlTarget, getSettings, withDevice } from './api.js'
import { checkForUpdate } from './update.js'

// Badge with the number of open captchas. Alarms are limited to 30 s in MV3, which is fine here
// (a job stays open for 10 minutes); the popup refreshes on its own.
// Notification for every captcha that was not announced yet (the ids are kept per browser session, so a
// restart of the service worker does not repeat them). Click: widget captchas open the hoster page,
// image captchas open the web interface.
const notifyNew = async (jobs) => {
  const [{ notify }, { announced = [] }] = await Promise.all([chrome.storage.local.get('notify'), chrome.storage.session.get('announced')])
  await chrome.storage.session.set({ announced: jobs.map((j) => j.id) })
  if (notify === false) return
  const fresh = jobs.filter((job) => !announced.includes(job.id))
  // The device is only worth mentioning when there are several.
  const several = fresh.length > 0 && (await api('/api/devices').catch(() => [])).length > 1
  for (const j of fresh) {
    const where = several && j.deviceName ? ` (${j.deviceName})` : ''
    chrome.notifications.create(`captcha-${j.id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Captcha waiting',
      message: j.kind === 'image' ? `${j.hoster}${where}: answer it in the web interface` : `${j.hoster}${where}: click to solve it`,
      requireInteraction: true
    })
  }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId)
  if (!notificationId.startsWith('captcha-')) return
  const id = Number(notificationId.slice('captcha-'.length))
  try {
    const job = (await api('/api/captcha')).find((j) => j.id === id)
    // Everything but a picture is solved on the hoster's page (no kind: older backend).
    if (job && job.kind !== 'image') await openCaptcha(id, job.device)
    else {
      const { backendUrl } = await getSettings()
      if (backendUrl) await chrome.tabs.create({ url: job?.device ? `${backendUrl}/#downloads?device=${encodeURIComponent(job.device)}` : backendUrl })
    }
  } catch {
    /* the captcha is gone or the backend is not reachable: nothing to open */
  }
})

// Turnstile usually passes without a click, so while the web UI is open in some tab the hoster page is
// opened in the background and the widget solves itself. Every job is tried once; if no token arrives
// within AUTO_PATIENCE_MS the tab is brought to the front (Cloudflare wants a click after all).
const AUTO_PATIENCE_MS = 20000
const autoSolve = async (jobs) => {
  const [{ autoTurnstile }, { autoOpened = {} }, { backendUrl }] = await Promise.all([chrome.storage.local.get('autoTurnstile'), chrome.storage.session.get('autoOpened'), getSettings()])
  const open = new Set(jobs.map((j) => String(j.id)))
  // Forget finished jobs.
  const tried = Object.fromEntries(Object.entries(autoOpened).filter(([id]) => open.has(id)))
  if (autoTurnstile !== false && backendUrl) {
    for (const [id, entry] of Object.entries(tried)) {
      if (!entry.focused && Date.now() - entry.at > AUTO_PATIENCE_MS) {
        entry.focused = true
        try {
          const tab = await chrome.tabs.update(entry.tabId, { active: true })
          await chrome.windows.update(tab.windowId, { focused: true })
        } catch {
          /* the tab is gone */
        }
      }
    }
    const fresh = jobs.filter((j) => /turnstile|cloudflare/i.test(j.challengeType) && j.kind !== 'image' && !tried[j.id])
    // One at a time: the next one waits until the previous one is solved or closed.
    const busy = Object.values(tried).length > 0
    if (fresh.length && !busy && (await chrome.tabs.query({ url: `${backendUrl}/*` })).length) {
      const job = fresh[0]
      try {
        const tab = await openCaptcha(job.id, job.device, false)
        tried[job.id] = { tabId: tab.id, at: Date.now(), focused: false }
      } catch {
        tried[job.id] = { tabId: -1, at: Date.now(), focused: true } // do not retry
      }
    }
  }
  await chrome.storage.session.set({ autoOpened: tried })
}

const refreshBadge = async () => {
  try {
    const jobs = await api('/api/captcha')
    await chrome.action.setBadgeBackgroundColor({ color: '#d14343' })
    await chrome.action.setBadgeText({ text: jobs.length ? String(jobs.length) : '' })
    await autoSolve(jobs).catch(() => {})
    await notifyNew(jobs)
  } catch {
    await chrome.action.setBadgeBackgroundColor({ color: '#888888' })
    await chrome.action.setBadgeText({ text: '!' })
  }
}
// Looks for a newer version of the extension on the backend; the popup and the settings page show the result.
const lookForUpdate = () => checkForUpdate().catch(() => {})
const startAlarms = () => {
  chrome.alarms.create('poll', { periodInMinutes: 0.5 })
  chrome.alarms.create('update', { periodInMinutes: 360 })
  void lookForUpdate()
}
chrome.runtime.onInstalled.addListener(startAlarms)
chrome.runtime.onStartup.addListener(startAlarms)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll') void refreshBadge()
  if (alarm.name === 'update') void lookForUpdate()
})

// Opens the hoster's real page; the content script there recognises the marker in the hash.
const openCaptcha = async (id, device, active = true) => {
  const job = await api(withDevice(`/api/captcha/${id}`, device))
  const url = new URL(job.siteUrl)
  url.hash = `myjd-captcha=${id}${device ? `&device=${encodeURIComponent(device)}` : ''}`
  return chrome.tabs.create({ url: url.toString(), active })
}

// Page world: replaces the hoster's page with an empty page in the style of the web UI and renders the
// captcha widget on it. It still runs on the hoster's domain (the token is bound to it), but nothing of
// the original page stays visible. Styles go through a constructable stylesheet because page CSPs
// may forbid <style> elements.
const renderInPage = (job, logoSvg) => {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(`
    :root { color-scheme: light dark; --bg: #f6f8fa; --card: #fff; --text: #1f2328; --muted: #59636e; --border: #d0d7de; --accent: #10ac84; --err: #d14343; --hover: rgba(127, 127, 127, 0.1); }
    @media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --card: #161b22; --text: #e6edf3; --muted: #8b949e; --border: #30363d; } }
    html, body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font: 15px/1.4 system-ui, sans-serif; }
    body { display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
    .card { display: grid; justify-items: center; gap: 16px; width: min(380px, 100%); padding: 24px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12); text-align: center; box-sizing: border-box; }
    .logo { width: 60px; }
    .logo svg { display: block; width: 100%; height: auto; }
    h1 { margin: 0; font-size: 1.2rem; }
    .meta { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px 14px; color: var(--muted); font-size: 0.85rem; }
    .meta > span { display: inline-flex; align-items: center; gap: 6px; }
    .meta img { width: 16px; height: 16px; border-radius: 3px; }
    .meta svg { flex: none; }
    .host { color: var(--text); font-weight: 600; overflow-wrap: anywhere; }
    .left { font-variant-numeric: tabular-nums; }
    .left.low { color: var(--err); }
    .widget { display: grid; justify-items: center; min-height: 78px; align-content: center; }
    .status { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 1.3em; font-size: 0.85rem; color: var(--muted); }
    .status.err { color: var(--err); }
    .status.ok { color: var(--accent); font-weight: 600; }
    .done .widget { display: none; }
    .hint { font-size: 0.75rem; color: var(--muted); }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin { animation: spin 1s linear infinite; }
  `)
  document.adoptedStyleSheets = [sheet]

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props)
    node.append(...children)
    return node
  }
  // Small Lucide icons (ISC license), built through the DOM because page CSPs may restrict innerHTML.
  const svg = (paths, size = 14) => {
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) root.setAttribute(k, v)
    for (const d of paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', d.startsWith('circle') ? 'circle' : 'path')
      if (d.startsWith('circle')) for (const [k, v] of Object.entries({ cx: 12, cy: 12, r: 10 })) path.setAttribute(k, v)
      else path.setAttribute('d', d)
      root.append(path)
    }
    return root
  }
  const clock = () => svg(['circle', 'M12 6v6l4 2'])
  const check = () => svg(['circle', 'm9 12 2 2 4-4'], 16)
  const alert = () => svg(['circle', 'M12 8v4', 'M12 16h.01'], 16)
  const loader = () => {
    const node = svg(['M21 12a9 9 0 1 1-6.219-8.56'], 16)
    node.setAttribute('class', 'spin')
    return node
  }

  // The hoster's own icon (same origin, so no request leaves the hoster's domain); hidden when there is none.
  const favicon = el('img', { alt: '', src: '/favicon.ico', onerror: () => favicon.remove() })
  const timeText = el('span', { className: 'left' })
  const left = el('span', { title: 'Time left to answer' }, clock(), timeText)
  const widget = el('div', { className: 'widget' })
  const status = el('div', { className: 'status' })
  // The logo comes as text (the page cannot reach the extension's files); parsed, not injected as HTML, because of page CSPs.
  const logo = el('div', { className: 'logo' })
  try {
    const node = new DOMParser().parseFromString(logoSvg, 'image/svg+xml').documentElement
    node.removeAttribute('width')
    node.removeAttribute('height')
    logo.append(document.importNode(node, true))
  } catch {
    /* the page works without it */
  }
  const card = el(
    'div',
    { className: 'card' },
    logo,
    el('h1', { textContent: 'Solve the captcha' }),
    el('div', { className: 'meta' }, el('span', {}, favicon, el('span', { className: 'host', textContent: job.hoster })), left),
    widget,
    status,
    el('div', { className: 'hint', textContent: 'This tab closes by itself once JDownloader has the answer.' })
  )
  const head = el('head', {}, el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }))
  document.documentElement.replaceChildren(head, el('body', {}, card))
  document.documentElement.style.cssText = '' // un-hide (set by the content script)
  document.title = `Captcha · ${job.hoster}`

  // The countdown runs on the time JD reported when the page was opened.
  const deadline = Date.now() + (job.remaining ?? 0)
  const tick = () => {
    const ms = Math.max(0, deadline - Date.now())
    const total = Math.floor(ms / 1000)
    timeText.textContent = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
    left.classList.toggle('low', ms < 60000)
    if (ms === 0) clearInterval(timer)
  }
  const timer = job.remaining > 0 ? setInterval(tick, 1000) : undefined
  if (timer) tick()
  else left.hidden = true

  const say = (text, kind = '') => {
    status.className = `status ${kind}`
    status.replaceChildren(...(kind === 'ok' ? [check()] : kind === 'err' ? [alert()] : text === 'Sending…' ? [loader()] : []), text)
    card.classList.toggle('done', kind === 'ok')
  }
  const kind = /turnstile|cloudflare/i.test(job.challengeType) ? 'turnstile' : /hcaptcha/i.test(job.challengeType) ? 'hcaptcha' : /recaptcha/i.test(job.challengeType) ? 'recaptcha' : null
  console.log('[myjd-captcha] job', job)
  if (!kind) {
    say(`Unsupported captcha type: ${job.challengeType}`, 'err')
    return
  }
  const scripts = {
    hcaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=__myjdLoaded',
    recaptcha: 'https://www.google.com/recaptcha/api.js?render=explicit&onload=__myjdLoaded',
    turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__myjdLoaded'
  }
  const script = document.createElement('script')
  script.src = scripts[kind]
  script.onerror = () => say('Could not load the captcha script (blocked by the page?)', 'err')
  window.__myjdLoaded = () => {
    const lib = { hcaptcha: window.hcaptcha, recaptcha: window.grecaptcha, turnstile: window.turnstile }[kind]
    lib.render(widget, {
      sitekey: job.siteKey,
      callback: (token) => {
        say('Sending…')
        window.postMessage({ source: 'myjd-captcha', id: job.id, token }, location.origin)
      },
      'error-callback': () => say('The captcha reported an error, reload the page to retry', 'err'),
      'expired-callback': () => say('The captcha expired, please solve it again', 'err')
    })
  }
  head.append(script)
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data?.source === 'myjd-result' && e.data.id === job.id) {
      if (e.data.ok) say('Done, this tab closes…', 'ok')
      else say(`Failed: ${e.data.error}`, 'err')
    }
  })
}

// Click'n'Load: the page's links go to the backend; the page's frame 0 shows the outcome.
const recentCnl = new Map() // fingerprint -> time; pages sometimes send the same links twice
// device: chosen on the result card; otherwise the setting decides ("ask": the card offers the devices first).
const sendCnl = async (payload, tabId, device) => {
  let only // the single online device, when "ask" has nothing to ask
  const fingerprint = [payload.crypted ?? payload.urls, payload.jk ?? '', payload.packageName ?? ''].join('|')
  if (device === undefined) {
    if (Date.now() - (recentCnl.get(fingerprint) ?? 0) < 15000) return
    recentCnl.set(fingerprint, Date.now())
    if ((await getCnlDevice()) === 'ask') {
      // Only devices that answer count: with one of them there is nothing to choose, with none the default fails visibly.
      const all = await api('/api/devices').catch(() => [])
      const online = all.filter((d) => d.online !== false)
      if (online.length > 1 && tabId !== undefined) {
        chrome.tabs.sendMessage(tabId, { type: 'cnl-choose', devices: all, payload: { packageName: payload.packageName, source: payload.source, popup: payload.popup } }, { frameId: 0 }).catch(() => {})
        return
      }
      if (online.length === 1) only = online[0].id
    }
  }
  const target = device ?? only ?? (await getCnlTarget())
  let result
  try {
    await api('/api/linkgrabber/cnl', { method: 'POST', body: JSON.stringify({ ...payload, device: target || undefined }) })
    // The device is only worth naming when there are several.
    const devices = await api('/api/devices').catch(() => [])
    const used = devices.find((d) => (target ? d.id === target : d.default))
    result = { ok: true, device: used?.id ?? target, deviceName: devices.length > 1 ? used?.name : undefined }
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (tabId !== undefined) chrome.tabs.sendMessage(tabId, { type: 'cnl-result', ...result, payload: { packageName: payload.packageName, source: payload.source, popup: payload.popup } }, { frameId: 0 }).catch(() => {})
}

// The "JDownloader is here" answer (jdcheck.js) follows the setting, so pages stop offering Click'n'Load when it is off.
const applyCnlSetting = async () => {
  const { cnl } = await chrome.storage.local.get('cnl')
  await chrome.declarativeNetRequest.updateEnabledRulesets(cnl === false ? { disableRulesetIds: ['cnl'] } : { enableRulesetIds: ['cnl'] })
}
chrome.runtime.onInstalled.addListener(applyCnlSetting)
chrome.runtime.onStartup.addListener(applyCnlSetting)
chrome.storage.onChanged.addListener((changes) => changes.cnl && void applyCnlSetting())

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'cnl') {
    void sendCnl(msg.payload, sender.tab?.id, msg.device)
    return false
  }
  if (msg.type === 'cnl-stats') {
    Promise.resolve(msg.device ?? getCnlTarget())
      .then((device) => api(withDevice('/api/linkgrabber', device)))
      .then((d) => {
        const links = d.packages.flatMap((p) => p.links)
        sendResponse({
          packages: d.packages.length,
          links: links.length,
          bytes: d.packages.reduce((sum, p) => sum + p.links.reduce((s, l) => s + (l.bytesTotal || 0), 0), 0),
          analysing: Boolean(d.collecting) || links.some((l) => l.availability === 'UNKNOWN')
        })
      })
      .catch(() => sendResponse(null))
    return true
  }
  if (msg.type === 'test-notification') {
    // Firefox has no getPermissionLevel: it just tries.
    ;(chrome.notifications.getPermissionLevel?.() ?? Promise.resolve('granted')).then((level) => {
      if (level !== 'granted') return sendResponse({ ok: false, error: 'Notifications are blocked for the browser (system or browser settings)' })
      chrome.notifications.create('test', { type: 'basic', iconUrl: 'icons/icon128.png', title: 'My Own JDownloader', message: 'Notifications work.' }, () => {
        const error = chrome.runtime.lastError?.message
        sendResponse(error ? { ok: false, error } : { ok: true })
      })
    })
    return true
  }
  if (msg.type === 'open-linkgrabber') {
    Promise.all([getSettings(), msg.device ?? getCnlTarget()]).then(([{ backendUrl }, device]) => backendUrl && chrome.tabs.create({ url: `${backendUrl}/#linkgrabber${device ? `?device=${encodeURIComponent(device)}` : ''}` }))
    return false
  }
  ;(async () => {
    if (msg.type === 'open') {
      await openCaptcha(msg.id, msg.device)
      return { ok: true }
    }
    if (msg.type === 'render' && sender.tab?.id) {
      const job = await api(withDevice(`/api/captcha/${msg.id}`, msg.device))
      const logoSvg = await (await fetch(chrome.runtime.getURL('logo-outline.svg'))).text()
      await chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, world: 'MAIN', func: renderInPage, args: [job, logoSvg] })
      return { ok: true }
    }
    if (msg.type === 'solve') {
      await api(withDevice(`/api/captcha/${msg.id}/solve`, msg.device), { method: 'POST', body: JSON.stringify({ token: msg.token }) })
      if (sender.tab?.id) setTimeout(() => chrome.tabs.remove(sender.tab.id), 1500)
      void refreshBadge()
      return { ok: true }
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  return true // async response
})
