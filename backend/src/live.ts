// What the web UI shows live besides the downloads (those have their own stream, see DownloadsPoller): the open captchas, the questions
// of the JDownloaders and the device list. One loop per source runs while at least one browser is connected, and an event goes out only
// when the answer changed; nobody connected means nothing is asked. The browser used to ask for all of it on its own, every few seconds.
export interface LiveSource {
  everyMs: () => number
  load: () => Promise<unknown>
  // What counts as a change (default: the whole answer). Values that only count down on their own must not be part of it.
  fingerprint?: (data: any) => unknown
}

type Send = (event: string, data: string) => void

export class LiveHub {
  private readonly subscribers = new Set<Send>()
  private readonly last = new Map<string, string>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly sources: Record<string, LiveSource>,
    // Called with every look, so the backend knows a client is there.
    private readonly onLook?: () => void
  ) {}

  subscribe(send: Send): () => void {
    this.subscribers.add(send)
    // The newcomer gets everything fresh (kept values would carry an old countdown); the others get it once more, which does no harm.
    this.last.clear()
    for (const name of Object.keys(this.sources)) {
      clearTimeout(this.timers.get(name))
      void this.run(name)
    }
    return () => {
      this.subscribers.delete(send)
      if (!this.subscribers.size) {
        for (const timer of this.timers.values()) clearTimeout(timer)
        this.timers.clear()
      }
    }
  }

  private async run(name: string): Promise<void> {
    const source = this.sources[name]
    try {
      this.onLook?.()
      const data = await source.load()
      const key = JSON.stringify(source.fingerprint ? source.fingerprint(data) : data)
      if (this.last.get(name) !== key) {
        this.last.set(name, key)
        const payload = JSON.stringify(data)
        for (const send of this.subscribers) send(name, payload)
      }
    } catch {
      // the next look retries
    }
    if (this.subscribers.size) this.timers.set(name, setTimeout(() => void this.run(name), source.everyMs()))
  }
}
