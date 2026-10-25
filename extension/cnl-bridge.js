// Click'n'Load, extension side: passes what cnl-main.js caught on to the background script and shows the
// result in our own style: in a helper window the whole page is replaced by it, on a normal page it is a
// card in the bottom right corner. Also tells cnl-main.js when the feature is switched off.
;(() => {
  const root = document.documentElement
  const applyEnabled = (on) => (on === false ? root.setAttribute('data-myjd-cnl', 'off') : root.removeAttribute('data-myjd-cnl'))
  chrome.storage.local.get('cnl').then((s) => applyEnabled(s.cnl))
  chrome.storage.onChanged.addListener((changes) => changes.cnl && applyEnabled(changes.cnl.newValue))

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'myjd-cnl' || !e.data.payload) return
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
    .page { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--bg); z-index: 2147483647; }
    .corner { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: min(360px, calc(100vw - 32px)); }
    .card { display: grid; gap: 14px; width: 100%; max-width: 420px; padding: 18px 20px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25); }
    .card.err { border-color: var(--err); }
    header { display: flex; align-items: center; gap: 12px; }
    header img { width: 44px; height: 44px; flex: none; }
    .titles { min-width: 0; }
    .title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 1.05em; }
    .title svg { flex: none; color: var(--accent); }
    .err .title svg { color: var(--err); }
    .sub { margin-top: 2px; color: var(--muted); font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

  const show = async (msg) => {
    const { icon } = await loadIcons()
    const popup = msg.payload?.popup === true
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches

    const host = el('div')
    const shadow = host.attachShadow({ mode: 'closed' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(STYLE)
    shadow.adoptedStyleSheets = [sheet]

    const metrics = el('div', { className: 'metrics' })
    const hint = el('span', { className: 'hint' })
    const close = el('button', { textContent: 'Close' })
    const actions = el('div', { className: 'actions' }, hint)
    const open = el('button', { className: 'primary' }, icon('external-link', 14), 'Open linkgrabber')
    open.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-linkgrabber' }))
    if (msg.ok) actions.append(open)
    actions.append(close)

    const title = el('div', { className: 'title' }, icon(msg.ok ? 'circle-check' : 'circle-alert', 18), msg.ok ? 'Sent to your linkgrabber' : "Click'n'Load failed")
    const subText = msg.ok ? msg.payload?.packageName || msg.payload?.source || '' : msg.error
    const sub = el('div', { className: 'sub', textContent: subText, title: subText })
    if (!msg.ok) sub.style.whiteSpace = 'normal'
    const card = el('div', { className: 'card' + (msg.ok ? '' : ' err') }, el('header', {}, el('img', { src: chrome.runtime.getURL('icons/icon128.png'), alt: '' }), el('div', { className: 'titles' }, title, sub)), ...(msg.ok ? [metrics] : []), actions)
    const scheme = el('div', { className: 'scheme' }, el('div', { className: popup ? 'page' : 'corner' }, card))
    shadow.append(scheme)

    if (popup) {
      // The helper window shows only our page: everything of the original page is replaced.
      const html = document.documentElement
      html.replaceChildren(el('head', {}, el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' })), el('body', { style: `margin:0;background:${dark ? '#0d1117' : '#f6f8fa'}` }, host))
      document.title = 'My Own JDownloader'
    } else {
      document.documentElement.append(host)
    }

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
      const stats = await chrome.runtime.sendMessage({ type: 'cnl-stats' }).catch(() => null)
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
      // Then the card goes away on its own: after 12 s, paused while the mouse is on it.
      let left = 12
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
  })
})()
