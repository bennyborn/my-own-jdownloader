import { DIRECT_POLL_MS, type MyJdClient } from './myjd/client.js'

export interface SpeedSample {
  t: number // ms timestamp
  v: number // bytes per second
}

// Records the total download speed in a ring buffer (the graph) and knows whether the device answers. One tiny read-only call
// (getSpeedInBps) per sample. Nothing here runs for nobody: the timer measures every few seconds only while somebody watches
// (mode 'fast': the live view is open, see DeviceContext), and the online state is looked up when somebody asks for it (probe).
export class BandwidthHistory {
  private samples: SpeedSample[] = []
  private timer?: NodeJS.Timeout
  private inflight?: Promise<void>
  private lastAt = 0
  // Whether the last sample got an answer; undefined until the first one is in.
  online: boolean | undefined
  // Set by the owner: measure now and then (somebody watches) or not.
  mode: () => 'fast' | 'off' = () => 'fast'
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
    // Ticks every DIRECT_POLL_MS; a device that is reached directly is measured on every tick, the others every intervalMs.
    this.timer = setInterval(() => {
      const wait = this.client.isDirect(this.deviceId) ? DIRECT_POLL_MS : this.intervalMs
      if (this.mode() === 'fast' && Date.now() - this.lastAt >= wait - 100) void this.sample()
    }, DIRECT_POLL_MS)
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  // The state of the device, not older than maxAgeMs: looked up now if it is (callers at the same time share one call).
  async probe(maxAgeMs: number): Promise<void> {
    if (Date.now() - this.lastAt >= maxAgeMs) await this.sample()
  }

  getSamples(): SpeedSample[] {
    return this.samples
  }

  private setOnline(online: boolean): void {
    const changed = this.online !== online
    this.online = online
    if (changed) this.onChange?.(online)
  }

  private sample(): Promise<void> {
    this.inflight ??= this.measure().finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  private async measure(): Promise<void> {
    try {
      const speed = await this.client.callDevice<number>(this.deviceId, '/downloadcontroller/getSpeedInBps')
      this.lastAt = Date.now()
      this.setOnline(true)
      const now = this.lastAt
      this.samples.push({ t: now, v: Number.isFinite(speed) ? Math.max(0, speed) : 0 })
      const cutoff = now - this.keepMs
      while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift()
    } catch {
      this.lastAt = Date.now()
      this.setOnline(false)
      /* JD unreachable: leave a gap, the next sample continues the graph */
    }
  }
}
