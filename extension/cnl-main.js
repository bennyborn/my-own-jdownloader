// Click'n'Load, page side (runs in the page itself, before the page's own scripts). Websites send their
// links to "a JDownloader on this computer" (http://127.0.0.1:9666). Ours runs elsewhere, so these
// requests are caught here and handed to the extension, which sends them to my-own-jdownloader.
;(() => {
  if (window.__myjdCnl) return
  window.__myjdCnl = true

  const enabled = () => document.documentElement.getAttribute('data-myjd-cnl') !== 'off'
  const parse = (url) => {
    try {
      const u = new URL(url, location.href)
      return /^(127\.0\.0\.1|localhost)$/.test(u.hostname) && u.port === '9666' ? u : null
    } catch {
      return null
    }
  }
  const toParams = (body) => {
    const params = new URLSearchParams()
    if (typeof body === 'string') return new URLSearchParams(body)
    if (body instanceof URLSearchParams) return new URLSearchParams(body)
    if (body instanceof FormData) for (const [k, v] of body) if (typeof v === 'string') params.append(k, v)
    return params
  }

  // Answers like a local JDownloader would; null = not a Click'n'Load request.
  const handle = (url, body) => {
    const u = parse(url)
    if (!u) return null
    if (u.pathname === '/jdcheck.js') return 'var jdownloader = true;'
    if (u.pathname === '/flash' || u.pathname === '/flash/') return 'JDownloader'
    if (u.pathname === '/crossdomain.xml') return '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*"/></cross-domain-policy>'
    const kind = u.pathname === '/flash/addcrypted2' ? 'crypted' : u.pathname === '/flash/add' ? 'urls' : null
    if (!kind) return null
    const p = toParams(body)
    for (const [k, v] of u.searchParams) if (!p.has(k)) p.set(k, v)
    window.postMessage(
      {
        source: 'myjd-cnl',
        payload: {
          ...(kind === 'crypted' ? { crypted: p.get('crypted'), jk: p.get('jk'), key: p.get('k') } : { urls: p.get('urls') }),
          passwords: p.get('passwords'),
          packageName: p.get('package'),
          source: p.get('source') || location.href,
          referrer: location.href,
          // A helper window opened by another page: the extension then shows its own page in it
          // (and keeps it open until the user closes it, instead of the page's own auto-close).
          popup: window.opener !== null && window === window.top
        }
      },
      location.origin
    )
    if (window.opener !== null && window === window.top) window.close = () => {}
    return 'success\r\n'
  }

  // Whatever goes wrong in our code, the page gets the real fetch: it must never break because of us.
  const originalFetch = window.fetch
  window.fetch = function (input, init) {
    let url = ''
    try {
      url = typeof input === 'string' ? input : String(input?.href ?? input?.url ?? '')
    } catch {
      /* unusual argument: the real fetch deals with it */
    }
    if (!url || !enabled() || !parse(url)) return originalFetch.apply(this, arguments)
    const args = arguments
    let body
    try {
      body = init?.body !== undefined ? Promise.resolve(init.body) : typeof input?.clone === 'function' && input.method !== 'GET' ? input.clone().text() : Promise.resolve(undefined)
    } catch {
      return originalFetch.apply(this, args)
    }
    return body.then(
      (b) => {
        let text = null
        try {
          text = handle(url, b)
        } catch {
          /* fall through to the real fetch */
        }
        if (text === null) {
          // Something for the "local JDownloader" that we do not know: answer like a server would, instead of a network error.
          console.debug('[My Own JDownloader] unknown Click\'n\'Load request', url)
          return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })
        }
        return new Response(text, { status: 200, headers: { 'Content-Type': 'text/plain' } })
      },
      () => originalFetch.apply(this, args)
    )
  }

  const xhr = XMLHttpRequest.prototype
  const originalOpen = xhr.open
  const originalSend = xhr.send
  xhr.open = function (method, url) {
    this.__myjdUrl = String(url)
    return originalOpen.apply(this, arguments)
  }
  xhr.send = function (body) {
    let text = null
    try {
      text = enabled() && this.__myjdUrl && parse(this.__myjdUrl) ? handle(this.__myjdUrl, body) : null
    } catch {
      /* fall through to the real request */
    }
    if (text === null) return originalSend.apply(this, arguments)
    const fake = (name, value) => Object.defineProperty(this, name, { configurable: true, get: () => value })
    setTimeout(() => {
      fake('readyState', 4)
      fake('status', 200)
      fake('statusText', 'OK')
      fake('responseText', text)
      fake('response', text)
      this.dispatchEvent(new Event('readystatechange'))
      this.dispatchEvent(new ProgressEvent('load'))
      this.dispatchEvent(new ProgressEvent('loadend'))
    })
  }

  // Forms posting straight to the "local" JDownloader (often into a hidden iframe).
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target
      if (!(form instanceof HTMLFormElement) || !enabled() || !parse(form.action)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      handle(form.action, new FormData(form))
    },
    true
  )
  const originalSubmit = HTMLFormElement.prototype.submit
  HTMLFormElement.prototype.submit = function () {
    if (enabled() && parse(this.action)) return void handle(this.action, new FormData(this))
    return originalSubmit.apply(this, arguments)
  }
})()
