// Click'n'Load, extension side: passes what cnl-main.js caught on to the background script and shows the
// result in our own style: in a helper window the whole page is replaced by it, on a normal page it is a
// card in the bottom right corner. Also tells cnl-main.js when the feature is switched off.
;(() => {
  const root = document.documentElement
  const applyEnabled = (on) => (on === false ? root.setAttribute('data-myjd-cnl', 'off') : root.removeAttribute('data-myjd-cnl'))
  chrome.storage.local.get('cnl').then((s) => applyEnabled(s.cnl))
  chrome.storage.onChanged.addListener((changes) => changes.cnl && applyEnabled(changes.cnl.newValue))

  let pending // the links last handed over, kept in case the user has to choose a device first
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'myjd-cnl' || !e.data.payload) return
    pending = e.data.payload
    void chrome.runtime.sendMessage({ type: 'cnl', payload: e.data.payload })
  })

  if (window !== window.top) return

  const formatBytes = (bytes) => {
    if (!(bytes > 0)) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
  }

  const STYLE = `
    :host { all: initial; }
    :host, * { box-sizing: border-box; }
    .scheme { --bg: #f6f8fa; --card: #fff; --text: #1f2328; --muted: #59636e; --border: #d0d7de; --accent: #10ac84; --err: #d14343; --hover: rgba(127, 127, 127, 0.1); font: 14px/1.4 system-ui, sans-serif; color: var(--text); }
    @media (prefers-color-scheme: dark) { .scheme { --bg: #0d1117; --card: #161b22; --text: #e6edf3; --muted: #8b949e; --border: #30363d; } }
    .page { position: fixed; inset: 0; display: flex; align-items: safe center; justify-content: center; overflow: auto; padding: 16px; background: var(--bg); z-index: 2147483647; }
    .corner { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: min(360px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; }
    .card { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; width: 100%; max-width: 420px; padding: 18px 20px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25); }
    .card.err { border-color: var(--err); }
    header { display: flex; align-items: center; gap: 12px; }
    header img { width: 44px; height: 44px; flex: none; }
    .titles { min-width: 0; }
    .title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 1.05em; }
    .title svg { flex: none; color: var(--accent); }
    .err .title svg { color: var(--err); }
    .sub { margin-top: 2px; color: var(--muted); font-size: 0.85em; overflow: hidden; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .title { overflow-wrap: anywhere; }
    /* Two columns, and a scrolling list when even that does not fit: the helper window has the size the page gave it. */
    .choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; max-height: calc(100vh - 230px); min-height: 84px; overflow-y: auto; }
    .choices button { justify-content: flex-start; min-width: 0; width: 100%; }
    .choices .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .choices button:disabled { opacity: 0.5; cursor: not-allowed; }
    .choices .off { margin-left: auto; font-size: 0.8em; color: var(--muted); }
    .metrics { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .metrics .item { display: inline-flex; align-items: center; gap: 5px; }
    .metrics .item b { color: var(--text); font-weight: 600; }
    .state { margin-left: auto; }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
    .hint { margin-right: auto; color: var(--muted); font-size: 0.8em; }
    button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
    button:hover { background: var(--hover); }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  `

  let iconModule
  const loadIcons = () => (iconModule ??= import(chrome.runtime.getURL('icons.js')))
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props)
    node.append(...children)
    return node
  }

  // Puts the card on the page (in a helper window it replaces the whole page); a new card replaces the old one.
  let currentHost
  const mount = (card, popup) => {
    currentHost?.remove()
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const host = el('div')
    const shadow = host.attachShadow({ mode: 'closed' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(STYLE)
    shadow.adoptedStyleSheets = [sheet]
    shadow.append(el('div', { className: 'scheme' }, el('div', { className: popup ? 'page' : 'corner' }, card)))
    if (popup) {
      // The helper window shows only our page: everything of the original page is replaced.
      document.documentElement.replaceChildren(el('head', {}, el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' })), el('body', { style: `margin:0;background:${dark ? '#0d1117' : '#f6f8fa'}` }, host))
      document.title = 'My Own JDownloader'
    } else {
      document.documentElement.append(host)
    }
    currentHost = host
    return host
  }

  // "Ask every time": the links are held back until a device is chosen here.
  const choose = async (msg) => {
    const { icon } = await loadIcons()
    const popup = msg.payload?.popup === true
    const subText = msg.payload?.packageName || msg.payload?.source || ''
    const cancel = el('button', { textContent: 'Cancel' })
    const buttons = msg.devices.map((d) => {
      const offline = d.online === false
      const button = el('button', { className: d.default && !offline ? 'primary' : '', disabled: offline }, icon(offline ? 'server-off' : 'server', 14), el('span', { className: 'label', textContent: d.name, title: d.name }), offline ? el('span', { className: 'off', textContent: 'offline' }) : '')
      button.addEventListener('click', () => {
        for (const b of [...buttons, cancel]) b.disabled = true
        void chrome.runtime.sendMessage({ type: 'cnl', payload: pending, device: d.id })
      })
      return button
    })
    const card = el(
      'div',
      { className: 'card' },
      el('header', {}, el('img', { src: chrome.runtime.getURL('icons/icon128.png'), alt: '' }), el('div', { className: 'titles' }, el('div', { className: 'title' }, 'Send to which device?'), el('div', { className: 'sub', textContent: subText, title: subText }))),
      el('div', { className: 'choices' }, ...buttons),
      el('div', { className: 'actions' }, cancel)
    )
    const host = mount(card, popup)
    cancel.addEventListener('click', () => (popup ? window.close() : host.remove()))
  }

  const show = async (msg) => {
    const { icon } = await loadIcons()
    const popup = msg.payload?.popup === true
    const metrics = el('div', { className: 'metrics' })
    const hint = el('span', { className: 'hint' })
    const close = el('button', { textContent: 'Close' })
    const actions = el('div', { className: 'actions' }, hint)
    const open = el('button', { className: 'primary' }, icon('external-link', 14), 'Open linkgrabber')
    open.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-linkgrabber', device: msg.device }))
    if (msg.ok) actions.append(open)
    actions.append(close)

    const title = el('div', { className: 'title' }, icon(msg.ok ? 'circle-check' : 'circle-alert', 18), msg.ok ? (msg.deviceName ? `Sent to ${msg.deviceName}` : 'Sent to your linkgrabber') : "Click'n'Load failed")
    const subText = msg.ok ? msg.payload?.packageName || msg.payload?.source || '' : msg.error
    const sub = el('div', { className: 'sub', textContent: subText, title: subText })
    if (!msg.ok) sub.style.webkitLineClamp = 'unset'
    const card = el('div', { className: 'card' + (msg.ok ? '' : ' err') }, el('header', {}, el('img', { src: chrome.runtime.getURL('icons/icon128.png'), alt: '' }), el('div', { className: 'titles' }, title, sub)), ...(msg.ok ? [metrics] : []), actions)
    const host = mount(card, popup)

    let stopped = false
    let hovered = false
    card.addEventListener('mouseenter', () => (hovered = true))
    card.addEventListener('mouseleave', () => (hovered = false))
    const done = () => {
      stopped = true
      if (popup) window.close()
      else host.remove()
    }
    close.addEventListener('click', done)

    // Numbers of the linkgrabber, refreshed while JDownloader still decrypts and checks the new links.
    // As long as JD has not delivered a single link yet there is nothing to count: only the state is shown.
    const stateItem = (analysing, alone) => {
      const node = analysing
        ? el('span', { className: 'item state' }, el('span', { className: 'spin', style: 'display:inline-flex' }, icon('loader-circle', 14)), 'Checking links…')
        : el('span', { className: 'item state' }, icon('circle-check', 14), 'Checked')
      if (alone) node.style.marginLeft = '0'
      return node
    }
    metrics.replaceChildren(stateItem(true, true))
    const refresh = async () => {
      const stats = await chrome.runtime.sendMessage({ type: 'cnl-stats', device: msg.device }).catch(() => null)
      if (!stats || stopped) return stats
      if (stats.links === 0 && stats.analysing) {
        metrics.replaceChildren(stateItem(true, true))
        return stats
      }
      const item = (name, text, label) => el('span', { className: 'item', title: label }, icon(name, 14), el('b', { textContent: text }))
      metrics.replaceChildren(item('package', String(stats.packages), 'Packages in the linkgrabber'), item('link-2', String(stats.links), 'Links in the linkgrabber'), item('hard-drive', formatBytes(stats.bytes), 'Total size'), stateItem(stats.analysing, false))
      return stats
    }
    void (async () => {
      let waited = 0
      let stats = await refresh()
      while (!stopped && waited < 20 && (stats?.analysing || waited < 3)) {
        await new Promise((r) => setTimeout(r, 1500))
        waited += 1.5
        stats = await refresh()
      }
      // Then the card goes away on its own: after 5 s, paused while the mouse is on it.
      let left = 5
      while (!stopped && left > 0) {
        hint.textContent = `Closing in ${Math.ceil(left)} s`
        await new Promise((r) => setTimeout(r, 500))
        if (!hovered) left -= 0.5
        else hint.textContent = 'Paused'
      }
      if (!stopped) done()
    })()
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'cnl-result') void show(msg)
    if (msg?.type === 'cnl-choose') void choose(msg)
  })
})()
