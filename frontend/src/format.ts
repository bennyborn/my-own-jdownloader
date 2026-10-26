export const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export const formatSpeed = (bytesPerSecond: number): string => `${formatBytes(bytesPerSecond)}/s`

// Every unit after the first one has two digits (5h:05m), like a clock.
const pad = (n: number): string => String(n).padStart(2, '0')

export const formatEta = (seconds?: number): string => {
  if (seconds === undefined || seconds <= 0) return '–'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${pad(m)}m`
  if (m > 0) return `${m}m ${pad(s)}s`
  return `${s}s`
}

// Time left as mm:ss (h:mm:ss from an hour on), e.g. for captcha timeouts.
export const formatCountdown = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${s}` : `${mm}:${s}`
}

// Long-range ETA like the original web interface, e.g. "5d:17h:12m".
export const formatLongEta = (seconds: number | null): string => {
  if (seconds === null || !isFinite(seconds) || seconds <= 0) return '–'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d:${pad(h)}h:${pad(m)}m`
  if (h > 0) return `${h}h:${pad(m)}m`
  return `${m}m:${pad(Math.floor(seconds % 60))}s`
}
