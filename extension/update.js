import { api, apiBytes } from './api.js'

// Self-update: the backend ships the extension (/api/extension). The settings page writes the changed files into the folder the extension
// is loaded from (File System Access API; the folder is picked once and remembered) and reloads the extension.

const kv = async (mode, run) => {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open('myjd-update', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('kv')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const request = run(db.transaction('kv', mode).objectStore('kv'))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

// Which package of the backend fits this browser (the backend offers one per kind of browser; see backend/src/extension.ts).
export const isFirefox = typeof globalThis.browser?.runtime?.getBrowserInfo === 'function'
export const TARGET = isFirefox ? 'firefox' : 'chromium'
export const packageUrl = (backendUrl) => `${backendUrl.replace(/\/+$/, '')}/api/extension/${TARGET}/extension.${isFirefox ? 'xpi' : 'zip'}`

export const localVersion = () => chrome.runtime.getManifest().version
export const canSelfUpdate = () => typeof globalThis.showDirectoryPicker === 'function'

const isNewer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

// Asks the backend which version it ships; the result is kept for the popup and the settings page ("update" = the newer version, or null).
export const checkForUpdate = async () => {
  const { version } = await api(`/api/extension/${TARGET}`)
  const update = isNewer(version, localVersion()) ? version : null
  await chrome.storage.local.set({ update })
  return { version, update }
}

const sha256 = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('')

const fileHandle = async (root, path, create) => {
  const parts = path.split('/')
  let dir = root
  for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name, { create })
  return dir.getFileHandle(parts[parts.length - 1], { create })
}

// Must run from a click (the folder dialog and the permission prompt need one). Resolves with the new version just before the reload.
export const applyUpdate = async (say = () => {}) => {
  let dir = await kv('readonly', (store) => store.get('dir'))
  if (dir && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') dir = undefined
  if (!dir) {
    say('Choose the folder this extension is loaded from…')
    dir = await showDirectoryPicker({ id: 'mojd-ext', mode: 'readwrite' })
  }
  say('Updating…')
  const info = await api(`/api/extension/${TARGET}`)
  try {
    const manifest = JSON.parse(await (await (await fileHandle(dir, 'manifest.json', false)).getFile()).text())
    // The folder holds this very version (or the update, written but not loaded yet).
    if (manifest.short_name !== chrome.runtime.getManifest().short_name || ![localVersion(), info.version].includes(manifest.version))
      throw new Error(`"${dir.name}" is not the folder this extension is loaded from (chrome://extensions shows it as "Loaded from")`)
  } catch (e) {
    await kv('readwrite', (store) => store.delete('dir')) // ask again next time
    throw e instanceof DOMException ? new Error(`"${dir.name}" is not the folder this extension is loaded from (no manifest.json in it)`) : e
  }
  await kv('readwrite', (store) => store.put(dir, 'dir'))
  // manifest.json last: a broken download leaves the old version in place.
  const files = [...info.files].sort((a, b) => Number(a.path === 'manifest.json') - Number(b.path === 'manifest.json'))
  const incoming = []
  for (const file of files) {
    const bytes = await apiBytes(`/api/extension/${TARGET}/file?path=${encodeURIComponent(file.path)}`)
    if ((await sha256(bytes)) !== file.sha256) throw new Error(`${file.path} arrived damaged, try again`)
    incoming.push([file.path, bytes])
  }
  for (const [path, bytes] of incoming) {
    const existing = await fileHandle(dir, path, false).then((h) => h.getFile().then((f) => f.arrayBuffer())).catch(() => null)
    if (existing && (await sha256(existing)) === (await sha256(bytes))) continue
    const writable = await (await fileHandle(dir, path, true)).createWritable()
    await writable.write(bytes)
    await writable.close()
  }
  await chrome.storage.local.set({ update: null })
  chrome.runtime.reload()
  return info.version
}
