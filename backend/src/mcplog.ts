// What the MCP server was asked and what it answered, for debugging on the settings page. Recording is switched
// on and off there; while off nothing is kept. Arguments and results are shown as they are (that is the point),
// except values of settings that look like secrets.
// Who sent a request: what the client said about itself in `initialize` (remembered per address and user agent,
// since the server keeps no sessions), the user name of the Basic auth (not checked, so it works as a label
// per client), and the address.
export interface McpCaller {
  client?: string
  user?: string
  ip?: string
  userAgent?: string
}

export interface McpLogEntry {
  id: number
  at: number
  // "rpc": a protocol message (initialize, tools/list, ...), "tool": a tool call
  kind: 'rpc' | 'tool'
  name: string
  device?: string
  from?: McpCaller
  args?: unknown
  ms?: number
  ok?: boolean
  result?: string
  error?: string
}

const MAX_ENTRIES = 200
const MAX_RESULT = 4000
const SECRET_KEY = /pass|token|secret|cookie|api_?key|login|user/i

const mask = (args: unknown): unknown => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args
  const copy: Record<string, unknown> = { ...args }
  const key = typeof copy.key === 'string' ? copy.key : ''
  for (const k of Object.keys(copy)) if (SECRET_KEY.test(k) || (k === 'value' && SECRET_KEY.test(key))) copy[k] = '***'
  return copy
}

type Listener = (entry: McpLogEntry) => void

export class McpLog {
  enabled = false
  private entries: McpLogEntry[] = []
  private readonly listeners = new Set<Listener>()
  private nextId = 1

  all(): McpLogEntry[] {
    return this.entries
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear(): void {
    this.entries = []
  }

  // Starts an entry; the returned function completes it (once).
  start(kind: McpLogEntry['kind'], name: string, args?: unknown, from?: McpCaller): (outcome?: { result?: unknown; error?: string }) => void {
    if (!this.enabled) return () => {}
    const entry: McpLogEntry = { id: this.nextId++, at: Date.now(), kind, name }
    if (from) entry.from = from
    if (args !== undefined) entry.args = mask(args)
    const device = (args as { device?: unknown } | undefined)?.device
    if (typeof device === 'string') entry.device = device
    this.push(entry)
    return (outcome) => {
      entry.ms = Date.now() - entry.at
      entry.ok = !outcome?.error
      if (outcome?.error) entry.error = outcome.error
      if (outcome?.result !== undefined) {
        const text = JSON.stringify(outcome.result) ?? ''
        entry.result = text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}... (${text.length} characters)` : text
      }
      this.push(entry)
    }
  }

  // The same id again means "updated": the page replaces the entry.
  private push(entry: McpLogEntry): void {
    if (!this.entries.includes(entry)) {
      this.entries.push(entry)
      if (this.entries.length > MAX_ENTRIES) this.entries.shift()
    }
    for (const l of this.listeners) l({ ...entry })
  }
}
