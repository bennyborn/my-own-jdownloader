import type { MyJdClient } from './myjd/client.js'

export interface SpeedSample {
  t: number // ms timestamp
  v: number // bytes per second
}

// Records the total download speed in a ring buffer, also while no browser is open, so the
// graph is already filled after a reload. One tiny read-only call (getSpeedInBps) per interval.
export class BandwidthHistory {
  private samples: SpeedSample[] = []
  private timer?: NodeJS.Timeout
  private busy = false
  // Whether the last sample got an answer; undefined until the first one is in.
  online: boolean | undefined
  onChange?: (online: boolean) => void
  // Resolves after the first sample, successful or not.
  ready: Promise<void> = Promise.resolve()

  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string,
    private readonly intervalMs = 3000,
    private readonly keepMs = 15 * 60 * 1000
  ) {}

  start(): void {
    if (this.timer) return
    this.ready = this.sample()
    this.timer = setInterval(() => void this.sample(), this.intervalMs)
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  getSamples(): SpeedSample[] {
    return this.samples
  }

  private setOnline(online: boolean): void {
    const changed = this.online !== online
    this.online = online
    if (changed) this.onChange?.(online)
  }

  private async sample(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const speed = await this.client.callDevice<number>(this.deviceId, '/downloadcontroller/getSpeedInBps')
      this.setOnline(true)
      const now = Date.now()
      this.samples.push({ t: now, v: Number.isFinite(speed) ? Math.max(0, speed) : 0 })
      const cutoff = now - this.keepMs
      while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift()
    } catch {
      this.setOnline(false)
      /* JD unreachable: leave a gap, the next sample continues the graph */
    } finally {
      this.busy = false
    }
  }
}
