import { api, getSettings } from './api.js'

// Badge with the number of open captchas. Alarms are limited to 30 s in MV3, which is fine here
// (a job stays open for 10 minutes); the popup refreshes on its own.
// Notification for every captcha that was not announced yet (the ids are kept per browser session, so a
// restart of the service worker does not repeat them). Click: widget captchas open the hoster page,
// image captchas open the web interface.
const notifyNew = async (jobs) => {
  const [{ notify }, { announced = [] }] = await Promise.all([chrome.storage.local.get('notify'), chrome.storage.session.get('announced')])
  await chrome.storage.session.set({ announced: jobs.map((j) => j.id) })
  if (notify === false) return
  for (const j of jobs.filter((job) => !announced.includes(job.id))) {
    chrome.notifications.create(`captcha-${j.id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Captcha waiting',
      message: j.kind === 'image' ? `${j.hoster}: answer it in the web interface` : `${j.hoster}: click to solve it`,
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
    if (job && job.kind !== 'image') await openCaptcha(id)
    else {
      const { backendUrl } = await getSettings()
      if (backendUrl) await chrome.tabs.create({ url: backendUrl })
    }
  } catch {
    /* the captcha is gone or the backend is not reachable: nothing to open */
  }
})

const refreshBadge = async () => {
  try {
    const jobs = await api('/api/captcha')
    await chrome.action.setBadgeBackgroundColor({ color: '#d14343' })
    await chrome.action.setBadgeText({ text: jobs.length ? String(jobs.length) : '' })
    await notifyNew(jobs)
  } catch {
    await chrome.action.setBadgeBackgroundColor({ color: '#888888' })
    await chrome.action.setBadgeText({ text: '!' })
  }
}
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('poll', { periodInMinutes: 0.5 }))
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('poll', { periodInMinutes: 0.5 }))
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === 'poll' && void refreshBadge())

// Opens the hoster's real page; the content script there recognises the marker in the hash.
const openCaptcha = async (id) => {
  const job = await api(`/api/captcha/${id}`)
  const url = new URL(job.siteUrl)
  url.hash = `myjd-captcha=${id}`
  return chrome.tabs.create({ url: url.toString() })
}

// Page world: replaces the hoster's page with an empty page in the style of the web UI and renders the
// captcha widget on it. It still runs on the hoster's domain (the token is bound to it), but nothing of
// the original page stays visible. Styles go through a constructable stylesheet because page CSPs
// may forbid <style> elements.
const renderInPage = (job) => {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(`
    :root { color-scheme: light dark; --bg: #f6f8fa; --card: #fff; --text: #1f2328; --muted: #59636e; --border: #d0d7de; --accent: #10ac84; --err: #d14343; }
    @media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --card: #161b22; --text: #e6edf3; --muted: #8b949e; --border: #30363d; } }
    html, body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font: 15px/1.4 system-ui, sans-serif; }
    body { display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
    .card { display: grid; justify-items: center; gap: 14px; width: min(360px, 100%); padding: 24px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12); text-align: center; }
    h1 { margin: 0; font-size: 1.1rem; }
    .muted { color: var(--muted); font-size: 0.85rem; }
    .status { min-height: 1.2em; font-size: 0.85rem; color: var(--muted); }
    .status.err { color: var(--err); }
    .status.ok { color: var(--accent); }
  `)
  document.adoptedStyleSheets = [sheet]

  const card = document.createElement('div')
  card.className = 'card'
  const title = document.createElement('h1')
  title.textContent = 'JDownloader needs a captcha'
  const sub = document.createElement('div')
  sub.className = 'muted'
  sub.textContent = job.hoster
  const widget = document.createElement('div')
  const status = document.createElement('div')
  status.className = 'status'
  card.append(title, sub, widget, status)
  const head = document.createElement('head')
  const meta = document.createElement('meta')
  meta.name = 'viewport'
  meta.content = 'width=device-width, initial-scale=1'
  head.append(meta)
  const body = document.createElement('body')
  body.append(card)
  document.documentElement.replaceChildren(head, body)
  document.documentElement.style.cssText = '' // un-hide (set by the content script)
  document.title = `Captcha · ${job.hoster}`

  const say = (text, kind = '') => {
    status.textContent = text
    status.className = `status ${kind}`
  }
  const kind = /turnstile|cloudflare/i.test(job.challengeType) ? 'turnstile' : /hcaptcha/i.test(job.challengeType) ? 'hcaptcha' : /recaptcha/i.test(job.challengeType) ? 'recaptcha' : null
  const debug = document.createElement('div')
  debug.className = 'muted'
  debug.style.fontSize = '0.7rem'
  debug.textContent = `${job.challengeType} · ${kind ?? 'unsupported'} · key ${job.siteKey.slice(0, 8)}…`
  card.append(debug)
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
const sendCnl = async (payload, tabId) => {
  const fingerprint = [payload.crypted ?? payload.urls, payload.jk ?? '', payload.packageName ?? ''].join('|')
  if (Date.now() - (recentCnl.get(fingerprint) ?? 0) < 15000) return
  recentCnl.set(fingerprint, Date.now())
  let result
  try {
    await api('/api/linkgrabber/cnl', { method: 'POST', body: JSON.stringify(payload) })
    result = { ok: true }
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
    void sendCnl(msg.payload, sender.tab?.id)
    return false
  }
  if (msg.type === 'cnl-stats') {
    api('/api/linkgrabber')
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
    chrome.notifications.getPermissionLevel().then((level) => {
      if (level !== 'granted') return sendResponse({ ok: false, error: 'Notifications are blocked for the browser (system or browser settings)' })
      chrome.notifications.create('test', { type: 'basic', iconUrl: 'icons/icon128.png', title: 'My Own JDownloader', message: 'Notifications work.' }, () => {
        const error = chrome.runtime.lastError?.message
        sendResponse(error ? { ok: false, error } : { ok: true })
      })
    })
    return true
  }
  if (msg.type === 'open-linkgrabber') {
    getSettings().then(({ backendUrl }) => backendUrl && chrome.tabs.create({ url: `${backendUrl}/#linkgrabber` }))
    return false
  }
  ;(async () => {
    if (msg.type === 'open') {
      await openCaptcha(msg.id)
      return { ok: true }
    }
    if (msg.type === 'render' && sender.tab?.id) {
      const job = await api(`/api/captcha/${msg.id}`)
      await chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, world: 'MAIN', func: renderInPage, args: [job] })
      return { ok: true }
    }
    if (msg.type === 'solve') {
      await api(`/api/captcha/${msg.id}/solve`, { method: 'POST', body: JSON.stringify({ token: msg.token }) })
      if (sender.tab?.id) setTimeout(() => chrome.tabs.remove(sender.tab.id), 1500)
      void refreshBadge()
      return { ok: true }
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  return true // async response
})
