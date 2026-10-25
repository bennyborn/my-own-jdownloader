import { computed, onMounted, onUnmounted, ref } from 'vue'

export interface CaptchaJob {
  id: number
  hoster: string
  challengeType: string
  remaining: number
  timeout: number
  kind: 'image' | 'widget'
  fetchedAt: number // browser time of the response, to count `remaining` down between polls
}

// Polls the open captcha jobs of JDownloader. Image captchas are answered in the web UI (CaptchaDialog);
// token captchas (hCaptcha, reCAPTCHA, Turnstile) are handled by the browser extension.
export const useCaptchas = () => {
  const jobs = ref<CaptchaJob[]>([])
  const handled = ref<Set<number>>(new Set()) // answered or skipped just now, hidden until JD drops them
  let timer: ReturnType<typeof setInterval> | undefined

  const reload = async () => {
    try {
      const res = await fetch('/api/captcha')
      if (!res.ok) return
      const fetchedAt = Date.now()
      const list = ((await res.json()) as Omit<CaptchaJob, 'fetchedAt'>[]).map((j) => ({ ...j, fetchedAt }))
      jobs.value = list
      const open = new Set(list.map((j) => j.id))
      if ([...handled.value].some((id) => !open.has(id))) handled.value = new Set([...handled.value].filter((id) => open.has(id)))
    } catch {
      /* the next poll retries */
    }
  }

  const imageJobs = computed(() => jobs.value.filter((j) => j.kind === 'image' && !handled.value.has(j.id)))
  const markHandled = (id: number) => (handled.value = new Set(handled.value).add(id))

  onMounted(() => {
    void reload()
    timer = setInterval(reload, 3000)
  })
  onUnmounted(() => clearInterval(timer))

  return { jobs, imageJobs, reload, markHandled }
}
