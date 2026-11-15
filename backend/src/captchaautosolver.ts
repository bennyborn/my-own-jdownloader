import type { DeviceContext } from './devices.js'
import type { Plugins } from './plugins.js'

// Auto-submits an image captcha's plugin guess after a short grace period, so a captcha-solving plugin (see plugins.ts)
// also helps when nobody has the web UI open. Kept separate from the plugin cache: every job is only tried once.
const GRACE_MS = 15_000
const POLL_MS = 7_000
const MIN_WAIT_MS = 1_000

export class CaptchaAutoSolver {
  // Jobs the poller already tried once (success or not), so it never asks a plugin about the same job twice.
  private readonly attempted = new Set<string>()
  // Jobs with a pending or already-fired auto-submit timer, so /suggest and the poller never schedule the same job twice.
  private readonly scheduled = new Set<string>()
  private pollTimer?: ReturnType<typeof setInterval>

  constructor(
    private readonly plugins: Plugins,
    private readonly contexts: () => DeviceContext[],
    private readonly log: { info: (m: string) => void; warn: (m: string) => void }
  ) {}

  // Only polls devices on its own while a captcha-solving plugin is enabled and set up; otherwise it costs nothing
  // beyond the timer check itself (see "Spare the MyJD API" in the project notes).
  start(): void {
    this.pollTimer ??= setInterval(() => void this.tick(), POLL_MS)
  }

  // Also called from the /suggest route, so a client-triggered guess auto-submits the same way as an unattended one.
  // Returns the delay it scheduled with, so the route can tell the UI when the auto-submit will fire; undefined if
  // a timer for this job was already scheduled (then the caller has no fresh delay to report).
  schedule(context: DeviceContext, jobId: number, text: string, remainingMs: number): number | undefined {
    const key = `${context.id}\0${jobId}`
    if (this.scheduled.has(key)) return undefined
    this.scheduled.add(key)
    const wait = Math.max(MIN_WAIT_MS, Math.min(GRACE_MS, remainingMs - 2000))
    setTimeout(async () => {
      try {
        const stillOpen = (await context.captchas.list()).some((j) => j.id === jobId)
        if (stillOpen) {
          await context.captchas.solveText(jobId, text)
          this.log.info(`Auto-solved captcha ${jobId} on "${context.device.name}"`)
        }
      } catch (e) {
        this.log.warn(`Auto-solve of captcha ${jobId} on "${context.device.name}" failed: ${e instanceof Error ? e.message : e}`)
      }
    }, wait)
    return wait
  }

  private active(): boolean {
    return this.plugins.list().some((p) => p.captchaSolver && p.enabled && p.configured)
  }

  private async tick(): Promise<void> {
    if (!this.active()) return
    const contexts = this.contexts().filter((c) => c.online !== false)
    const seen = new Set<string>()
    for (const context of contexts) {
      let jobs
      try {
        jobs = await context.captchas.list()
      } catch {
        continue
      }
      for (const job of jobs) {
        if (job.kind !== 'image') continue
        const key = `${context.id}\0${job.id}`
        seen.add(key)
        if (this.attempted.has(key)) continue
        this.attempted.add(key) // mark it tried right away: one attempt per job, success or not
        try {
          const image = await context.captchas.image(job.id)
          const text = image && (await this.plugins.solveCaptcha(image.data, image.type, job.hoster))
          if (text) this.schedule(context, job.id, text, job.remaining)
        } catch (e) {
          this.log.warn(`Auto-solve attempt for captcha ${job.id} on "${context.device.name}" failed: ${e instanceof Error ? e.message : e}`)
        }
      }
    }
    // Forget jobs that are gone (answered, skipped or expired), so a later job that happens to reuse the same id is tried again.
    for (const key of [...this.attempted]) if (!seen.has(key)) this.attempted.delete(key)
    for (const key of [...this.scheduled]) if (!seen.has(key)) this.scheduled.delete(key)
  }
}
