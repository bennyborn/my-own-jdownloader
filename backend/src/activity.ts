// What this backend does on its own is nothing: no timer asks the MyJDownloader API (which is not ours) unless a client wants what it
// brings. Where a client is looking at something live, that is subscribed (the downloads: see DownloadsPoller) or leased here (the speed
// graph); the rest is looked up when somebody asks, and not older than a short time (see BandwidthHistory.probe, DeviceRegistry.freshen).
// This class only remembers who was there (for /api/health) and whether somebody looks at the live graph.
const VIEW_MS = 15_000

class Activity {
  private last = 0
  private viewUntil = 0
  private who = { url: '', userAgent: '' }

  // Any request of a client.
  touch(url = '', userAgent = ''): void {
    this.last = Date.now()
    this.who = { url: url.split('?')[0], userAgent: userAgent.slice(0, 90) }
  }

  // A client looks at the live speed graph (the popup of the extension asks for it every few seconds): the speed is measured as long
  // as that lasts.
  view(): void {
    this.viewUntil = Date.now() + VIEW_MS
  }

  get viewing(): boolean {
    return Date.now() < this.viewUntil
  }

  status(): { agoSeconds: number | null; viewing: boolean; url: string; userAgent: string } {
    return { agoSeconds: this.last ? Math.round((Date.now() - this.last) / 1000) : null, viewing: this.viewing, ...this.who }
  }
}

export const activity = new Activity()
