// Runs on every page but only acts on the marker "#myjd-captcha=<id>&device=<device id>" that the extension itself sets.
;(() => {
  // Lets the web UI see that the extension is active, and which version (the captcha overlay checks it before offering the solver page).
  document.documentElement.setAttribute('data-myjd-extension', chrome.runtime.getManifest().version)
  const match = location.hash.match(/^#myjd-captcha=(\d+)(?:&device=([\w-]+))?$/)
  if (!match) return
  const id = Number(match[1])
  const device = match[2] ?? ''

  // The page-world widget reports its token by postMessage; only this script talks to the extension.
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.source !== 'myjd-captcha' || e.data.id !== id) return
    const res = await chrome.runtime.sendMessage({ type: 'solve', id, device, token: e.data.token })
    window.postMessage({ source: 'myjd-result', id, ok: res?.ok === true, error: res?.error }, location.origin)
  })

  // Hide the original page right away (this runs at document_start), with the background colour of
  // the captcha page so there is no flash; the page-world code replaces everything and resets this.
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.style.cssText = `visibility:hidden;background:${dark ? '#0d1117' : '#f6f8fa'}`
  const reveal = () => (document.documentElement.style.cssText = '')

  chrome.runtime.sendMessage({ type: 'render', id, device }).then((res) => res?.ok === false && reveal(), reveal)
})()
