import { ref } from 'vue'
import type { CaptchaJob } from './useCaptchas'

// Browser notifications for new captchas. The permission is the browser's (asked when the bell is clicked);
// whether we use it is a switch kept in the localStorage.
// Browsers only offer notifications on https pages (and localhost), not on plain http://server:port.
export type NotifyState = 'unsupported' | 'insecure' | 'blocked' | 'ask' | 'on' | 'off'

const KEY = 'notifyCaptchas'
const supported = typeof Notification !== 'undefined'
const wanted = () => {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

const compute = (): NotifyState => {
  if (!supported) return window.isSecureContext ? 'unsupported' : 'insecure'
  if (!window.isSecureContext) return 'insecure'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission === 'default') return 'ask'
  return wanted() ? 'on' : 'off'
}
export const notifyState = ref<NotifyState>(compute())

// Bell clicked: asks for the permission first, afterwards switches notifications on and off.
export const toggleNotifications = async () => {
  if (notifyState.value === 'ask') {
    await Notification.requestPermission()
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* ignore */
    }
  } else if (notifyState.value === 'on' || notifyState.value === 'off') {
    try {
      localStorage.setItem(KEY, notifyState.value === 'on' ? '0' : '1')
    } catch {
      /* ignore */
    }
  }
  notifyState.value = compute()
}

export const notifyTest = () => {
  if (notifyState.value === 'on') new Notification('My Own JDownloader', { body: 'Notifications work.', icon: '/icon-192.png' })
}

const notified = new Set<number>()
// Called with every poll of the captcha list; shows one notification per new job.
export const notifyNewCaptchas = (jobs: CaptchaJob[]) => {
  const open = new Set(jobs.map((j) => j.id))
  for (const id of notified) if (!open.has(id)) notified.delete(id)
  if (notifyState.value !== 'on') {
    for (const j of jobs) notified.add(j.id) // do not flood once it is switched on
    return
  }
  for (const j of jobs) {
    if (notified.has(j.id)) continue
    notified.add(j.id)
    // Looking at the page, an image captcha is already open in front of you.
    if (j.kind === 'image' && document.hasFocus() && !document.hidden) continue
    const n = new Notification('Captcha waiting', {
      body: j.kind === 'image' ? `${j.hoster}: answer it in the web interface` : `${j.hoster}: solve it with the browser extension`,
      icon: '/icon-192.png',
      tag: `captcha-${j.id}`,
      requireInteraction: true
    })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  }
}
