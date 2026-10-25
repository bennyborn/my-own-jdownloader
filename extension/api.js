// Talks to the my-own-jdownloader backend (URL and UI password come from the options page).
export const getSettings = async () => {
  const { backendUrl = '', password = '' } = await chrome.storage.local.get(['backendUrl', 'password'])
  return { backendUrl: backendUrl.replace(/\/+$/, ''), password }
}

// Host icons come from the backend; <img> cannot send the password, so they are fetched with it.
const iconCache = new Map()
export const hostIcon = (host) => {
  if (!iconCache.has(host)) {
    iconCache.set(
      host,
      (async () => {
        const { backendUrl, password } = await getSettings()
        const res = await fetch(`${backendUrl}/api/icons/${encodeURIComponent(host)}`, { headers: password ? { Authorization: 'Basic ' + btoa('user:' + password) } : {} })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return URL.createObjectURL(await res.blob())
      })().catch(() => null)
    )
  }
  return iconCache.get(host)
}

// kind: 'config' (no backend URL), 'network' (not reachable), 'auth' (wrong password), 'http' (other)
export class ApiError extends Error {
  constructor(message, kind) {
    super(message)
    this.kind = kind
  }
}

export const api = async (path, init = {}) => {
  const { backendUrl, password } = await getSettings()
  if (!backendUrl) throw new ApiError('Backend URL is not set (extension options)', 'config')
  const headers = { 'Content-Type': 'application/json', ...(password ? { Authorization: 'Basic ' + btoa('user:' + password) } : {}) }
  let res
  try {
    res = await fetch(backendUrl + path, { ...init, headers })
  } catch {
    throw new ApiError(`Could not reach ${backendUrl}`, 'network')
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      message = (await res.json()).error ?? message
    } catch {
      /* keep the status */
    }
    throw new ApiError(message, res.status === 401 ? 'auth' : 'http')
  }
  return res.json()
}
