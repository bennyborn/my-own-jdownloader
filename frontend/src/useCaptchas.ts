import { computed, onMounted, onUnmounted, ref } from 'vue'
import { withDevice } from './devices'

export interface CaptchaJob {
  id: number
  device: string // the JDownloader device the captcha belongs to
  deviceName: string
  hoster: string
  challengeType: string
  remaining: number
  timeout: number
  kind: 'image' | 'widget'
  openUrl?: string // the hoster's page with the marker the browser extension reacts to (widget captchas)
  fetchedAt: number // browser time of the response, to count `remaining` down between polls
}

// Polls the open captcha jobs of all JDownloader devices (they have to be answered whichever device is shown). Image captchas are answered in the web UI (CaptchaDialog);
// token captchas (hCaptcha, reCAPTCHA, Turnstile) are handled by the browser extension.
export const useCaptchas = () => {
  const jobs = ref<CaptchaJob[]>([])
  const handled = ref<Set<number>>(new Set()) // answered or skipped just now, hidden until JD drops them
  const dismissed = ref<Set<number>>(new Set()) // widget captchas whose alert was closed; the status bar button stays
  const urls = ref<Map<number, string>>(new Map())
  let timer: ReturnType<typeof setInterval> | undefined

  // The page is looked up ahead of the click, so the button can be a plain link (no popup blocker).
  const loadUrl = async (id: number, device: string) => {
    urls.value = new Map(urls.value).set(id, '')
    try {
      const res = await fetch(withDevice(`/api/captcha/${id}`, device))
      if (!res.ok) return urls.value.delete(id)
      const { siteUrl } = (await res.json()) as { siteUrl?: string }
      if (!siteUrl) return urls.value.delete(id)
      const url = new URL(siteUrl)
      url.hash = `myjd-captcha=${id}&device=${encodeURIComponent(device)}`
      urls.value = new Map(urls.value).set(id, url.toString())
    } catch {
      urls.value.delete(id) // tried again with the next poll
    }
  }

  const reload = async () => {
    try {
      const res = await fetch('/api/captcha')
      if (!res.ok) return
      const fetchedAt = Date.now()
      // Shortest time left first; all `remaining` values stem from the same response, so the order only changes when a captcha arrives or leaves.
      const list = ((await res.json()) as Omit<CaptchaJob, 'fetchedAt'>[]).map((j) => ({ ...j, fetchedAt })).sort((a, b) => a.remaining - b.remaining || a.id - b.id)
      jobs.value = list
      for (const j of list) if (j.kind === 'widget' && !urls.value.has(j.id)) void loadUrl(j.id, j.device)
      if ([...dismissed.value].some((id) => !list.some((j) => j.id === id))) dismissed.value = new Set([...dismissed.value].filter((id) => list.some((j) => j.id === id)))
      const open = new Set(list.map((j) => j.id))
      if ([...urls.value.keys()].some((id) => !open.has(id))) urls.value = new Map([...urls.value].filter(([id]) => open.has(id))) // ids can come back for another captcha
      if ([...handled.value].some((id) => !open.has(id))) handled.value = new Set([...handled.value].filter((id) => open.has(id)))
    } catch {
      /* the next poll retries */
    }
  }

  const imageJobs = computed(() => jobs.value.filter((j) => j.kind === 'image' && !handled.value.has(j.id)))
  const widgetJobs = computed(() => jobs.value.filter((j) => j.kind === 'widget').map((j) => ({ ...j, openUrl: urls.value.get(j.id) || undefined })))
  const alertJobs = computed(() => widgetJobs.value.filter((j) => j.openUrl && !dismissed.value.has(j.id)))
  const dismiss = (id: number) => (dismissed.value = new Set(dismissed.value).add(id))
  const markHandled = (id: number) => (handled.value = new Set(handled.value).add(id))

  onMounted(() => {
    void reload()
    timer = setInterval(reload, 3000)
  })
  onUnmounted(() => clearInterval(timer))

  return { jobs, imageJobs, widgetJobs, alertJobs, dismiss, reload, markHandled }
}
