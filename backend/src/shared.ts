// Several clients ask for the same thing, and ask again a moment later (every tab of the web UI, the phone app and its service, the
// extension). Every real call goes through the MyJDownloader API, which is not ours: one call serves everybody for `ttlMs`, and callers
// that arrive while it is under way wait for the same answer instead of sending another. A failure is not kept.
const MAX_ENTRIES = 200

export class Shared {
  private readonly entries = new Map<string, { at: number; value?: unknown; pending?: Promise<unknown> }>()

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key)
    if (entry?.pending) return entry.pending as Promise<T>
    if (entry && Date.now() - entry.at < ttlMs) return Promise.resolve(entry.value as T)
    const pending = load().then(
      (value) => {
        this.entries.set(key, { at: Date.now(), value })
        return value
      },
      (error) => {
        this.entries.delete(key)
        throw error
      }
    )
    this.entries.set(key, { at: 0, pending })
    if (this.entries.size > MAX_ENTRIES) this.prune()
    return pending
  }

  // Answers nobody asked for in the last minute go (keys with a changing part, like a counter, would pile up otherwise).
  private prune(): void {
    const old = Date.now() - 60_000
    for (const [key, entry] of this.entries) if (!entry.pending && entry.at < old) this.entries.delete(key)
  }

  // After something changed that the kept answers describe.
  clear(): void {
    this.entries.clear()
  }
}
