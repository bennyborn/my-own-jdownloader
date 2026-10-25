import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { HttpError, type DeviceContext, type DeviceRegistry } from './devices.js'
import { McpLog, type McpCaller } from './mcplog.js'
import type { ConfigEntry, ConfigGroup } from './jdconfig.js'

// An MCP server (Streamable HTTP, stateless) on /mcp: the same services as the web page, for an assistant.
// Its main use is the JDownloader settings, which are too many to browse: they are searched, not listed.
// Tools that change something only exist with MCP_WRITE=true. Nothing here stops, pauses or deletes downloads.
const MAX_RESULTS = 25
const MAX_TEXT = 300

const asJson = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] })
const short = (s: string | undefined) => (s && s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}...` : s)

const deviceParam = z.string().optional().describe('Device name or id (see list_devices). Default: the default device.')

interface SettingRef {
  category?: string
  group: string
  interfaceName: string
  storage: string | null
  entry: ConfigEntry
}

const flatten = (categories: { id: string; groups: ConfigGroup[] }[]): SettingRef[] =>
  categories.flatMap((c) => c.groups.flatMap((g) => g.entries.map((entry) => ({ category: c.id, group: g.label, interfaceName: g.interfaceName, storage: g.storage ?? null, entry }))))

const present = (s: SettingRef) => {
  const { entry } = s
  return {
    category: s.category,
    group: s.group,
    interfaceName: s.interfaceName,
    storage: s.storage,
    key: entry.key,
    label: entry.label,
    type: entry.type,
    docs: short(entry.docs),
    options: entry.options?.map((o) => o.value),
    // Secrets are never shown, only whether one is set.
    ...(entry.secret ? { secret: true, set: entry.set } : { value: entry.value, default: entry.defaultValue })
  }
}

// Terms match as words or as their first five letters ("simultaneous" finds "Simultan"); at least half of them have to
// hit. Hits in the key or label count more than hits in the docs.
const score = (s: SettingRef, terms: string[]): number => {
  const head = `${s.entry.key} ${s.entry.label}`.toLowerCase()
  const rest = `${s.group} ${s.interfaceName} ${s.entry.docs ?? ''}`.toLowerCase()
  const has = (text: string, t: string) => text.includes(t) || (t.length >= 6 && text.includes(t.slice(0, 5)))
  let total = 0
  let hits = 0
  for (const t of terms) {
    if (has(head, t)) total += 3
    else if (has(rest, t)) total += 1
    else continue
    hits++
  }
  return hits >= Math.ceil(terms.length / 2) ? total : 0
}

// Throws what is wrong with the value, or returns it as the device expects it.
const checkValue = (entry: ConfigEntry, value: unknown): unknown => {
  const bad = (what: string) => {
    throw new HttpError(400, `${entry.key} expects ${what}`)
  }
  switch (entry.type) {
    case 'BOOLEAN':
      return typeof value === 'boolean' ? value : bad('true or false')
    case 'INT':
    case 'LONG':
      return Number.isInteger(value) ? value : bad('an integer')
    case 'DOUBLE':
      return typeof value === 'number' && Number.isFinite(value) ? value : bad('a number')
    case 'STRING':
      return typeof value === 'string' ? value : bad('a string')
    case 'ENUM':
      return typeof value === 'string' && entry.options?.some((o) => o.value === value) ? value : bad(`one of ${entry.options?.map((o) => o.value).join(', ')}`)
    case 'STRING_LIST':
      return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : bad('a list of strings')
    case 'INT_LIST':
      return Array.isArray(value) && value.every((v) => Number.isInteger(v)) ? value : bad('a list of integers')
    default:
      return value
  }
}

export interface McpOptions {
  registry: DeviceRegistry
  // Where the choice made on the settings page is kept; MCP_WRITE=true is the default until it was made.
  stateFile: string
  log: (message: string) => void
  debug: McpLog
}

export interface McpTool {
  name: string
  description: string
  write: boolean
}

interface McpState {
  write: boolean
  debug: boolean
}

const readState = (file: string): McpState => {
  let saved: { write?: unknown; debug?: unknown } = {}
  try {
    saved = JSON.parse(readFileSync(file, 'utf8')) as typeof saved
  } catch {
    // no choice made yet
  }
  return { write: typeof saved.write === 'boolean' ? saved.write : process.env.MCP_WRITE === 'true', debug: saved.debug === true }
}

const resolve = (registry: DeviceRegistry, given?: string): DeviceContext => {
  if (!given) return registry.resolve()
  const context = registry.all().find((c) => c.id === given) ?? registry.all().find((c) => c.device.name.toLowerCase() === given.toLowerCase())
  if (!context) throw new HttpError(404, `Unknown device "${given}"`)
  return context
}

// `catalog` collects what the server offers, for the settings page.
const buildServer = ({ registry, log, debug }: McpOptions, allowWrite: boolean, catalog?: McpTool[], caller?: McpCaller): McpServer => {
  let write = false
  const server = new McpServer(
    { name: 'my-own-jdownloader', version: '1.0.0' },
    {
      instructions:
        'Controls a JDownloader. The JDownloader has hundreds of settings: find them with search_settings (by topic, e.g. "reconnect", "max simultaneous downloads", "extraction"), never try to list all. ' +
        (allowWrite ? 'Changes are possible (set_setting, reset_setting, add_links): say what you change and the previous value.' : 'This server is read-only.')
    }
  )
  // Every tool call is logged (what, which device), never the arguments' values: they may hold passwords or links.
  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>) => {
    catalog?.push({ name, description, write })
    return server.registerTool(name, { description, inputSchema: shape }, (async (args: z.infer<z.ZodObject<S>>) => {
      log(`MCP ${name}`)
      const done = debug.start('tool', name, args, caller)
      try {
        const result = await run(args)
        done({ result })
        return asJson(result)
      } catch (e) {
        done({ error: e instanceof Error ? e.message : String(e) })
        throw e
      }
    }) as never)
  }

  tool('list_devices', 'The JDownloader devices of the account and whether they are online.', {}, async () => registry.list())

  tool(
    'search_settings',
    'Searches the JDownloader settings (not the hoster plugins, see list_plugins) by words in name, group or description. Returns at most 25, best first, with current value, default, type and allowed options.',
    {
      query: z.string().min(1).describe('Words, most of which must match, e.g. "max connections" or "reconnect"'),
      category: z.enum(['downloads', 'linkgrabber', 'connection', 'extraction', 'captcha', 'update', 'system']).optional(),
      device: deviceParam
    },
    async ({ query, category, device }) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
      const all = flatten(await resolve(registry, device).config.list()).filter((s) => !category || s.category === category)
      const hits = all.map((s) => [score(s, terms), s] as const).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0])
      return { total: hits.length, shown: Math.min(hits.length, MAX_RESULTS), settings: hits.slice(0, MAX_RESULTS).map(([, s]) => present(s)) }
    }
  )

  tool(
    'list_settings_group',
    'All settings of one group (e.g. interfaceName ending in "GeneralSettings"), for when a search found one and you want its neighbours.',
    { interfaceName: z.string(), storage: z.string().nullable().optional(), device: deviceParam },
    async ({ interfaceName, storage, device }) => {
      const found = flatten(await resolve(registry, device).config.list()).filter((s) => s.interfaceName === interfaceName && s.storage === (storage ?? null))
      if (!found.length) throw new HttpError(404, 'Unknown settings group')
      return found.map(present)
    }
  )

  tool(
    'list_plugins',
    'The hoster / crawler plugins that have settings of their own, optionally narrowed by a word in the hostname.',
    { query: z.string().optional(), device: deviceParam },
    async ({ query, device }) => {
      const q = query?.toLowerCase()
      const plugins = (await resolve(registry, device).config.plugins()).filter((p) => !q || p.host.toLowerCase().includes(q))
      return { total: plugins.length, plugins: plugins.slice(0, 50) }
    }
  )

  tool(
    'plugin_settings',
    'The settings of one plugin (interfaceName and storage as list_plugins gave them).',
    { interfaceName: z.string(), storage: z.string(), device: deviceParam },
    async ({ interfaceName, storage, device }) => {
      const group = await resolve(registry, device).config.pluginGroup(interfaceName, storage)
      if (!group) throw new HttpError(404, 'Unknown plugin')
      return group.entries.map((entry) => present({ group: group.label, interfaceName, storage, entry }))
    }
  )

  tool('list_downloads', 'The download list: packages with progress, speed and status, plus the totals.', {
    onlyActive: z.boolean().optional().describe('Only packages that are running right now'),
    query: z.string().optional().describe('Part of the package name'),
    device: deviceParam
  }, async ({ onlyActive, query, device }) => {
    const snapshot = await resolve(registry, device).poller.refresh()
    const q = query?.toLowerCase()
    const packages = snapshot.packages.filter((p) => (!onlyActive || p.running) && (!q || p.name.toLowerCase().includes(q)))
    return {
      totalSpeed: snapshot.totalSpeed,
      runningDownloads: snapshot.runningDownloads,
      linkCount: snapshot.linkCount,
      total: packages.length,
      packages: packages.slice(0, 100)
    }
  })

  tool('package_links', 'The links of one download package.', { uuid: z.number().int(), device: deviceParam }, async ({ uuid, device }) =>
    resolve(registry, device).poller.getLinks(uuid)
  )

  tool('list_linkgrabber', 'What is in the linkgrabber (collected, not yet downloading): packages with their link counts and availability.', { device: deviceParam }, async ({ device }) => {
    const { grabber } = resolve(registry, device)
    const [collecting, packages, links] = await Promise.all([grabber.isCollecting(), grabber.getPackages(), grabber.getLinks()])
    return {
      collecting,
      packages: packages.map((p) => {
        const own = links.filter((l) => l.packageUUID === p.uuid)
        const availability: Record<string, number> = {}
        for (const l of own) availability[l.availability] = (availability[l.availability] ?? 0) + 1
        return { ...p, availability }
      })
    }
  })

  tool('list_accounts', 'The premium accounts: validity, expiry and traffic left (never passwords).', { device: deviceParam }, async ({ device }) => resolve(registry, device).accounts.list())

  tool('list_captchas', 'Open captchas that wait for an answer (solving them is done in the web page or the browser extension).', { device: deviceParam }, async ({ device }) => resolve(registry, device).captchas.list())

  if (!allowWrite) return server
  write = true

  tool(
    'set_setting',
    'Changes one JDownloader setting. Use the interfaceName, storage and key from search_settings; the value is checked against the type and the allowed options. Not for secrets and not for settings this app manages itself.',
    {
      interfaceName: z.string(),
      storage: z.string().nullable().optional(),
      key: z.string(),
      value: z.unknown().describe('boolean, number, string, or a list, as the setting`s type says'),
      device: deviceParam
    },
    async ({ interfaceName, storage, key, value, device }) => {
      const context = resolve(registry, device)
      const { group, entry } = await findSetting(context, interfaceName, storage ?? null, key)
      if (entry.secret) throw new HttpError(403, 'Secrets cannot be changed through MCP, use the web page')
      if (group.note) throw new HttpError(403, `This group is managed by this app: ${group.note}`)
      const checked = checkValue(entry, value)
      await context.config.set(interfaceName, storage ?? null, key, checked)
      return { ok: true, key, previous: entry.value, value: checked }
    }
  )

  tool(
    'reset_setting',
    'Sets one JDownloader setting back to its default.',
    { interfaceName: z.string(), storage: z.string().nullable().optional(), key: z.string(), device: deviceParam },
    async ({ interfaceName, storage, key, device }) => {
      const context = resolve(registry, device)
      const { group, entry } = await findSetting(context, interfaceName, storage ?? null, key)
      if (entry.secret) throw new HttpError(403, 'Secrets cannot be changed through MCP, use the web page')
      if (group.note) throw new HttpError(403, `This group is managed by this app: ${group.note}`)
      await context.config.reset(interfaceName, storage ?? null, key)
      return { ok: true, key, previous: entry.value, default: entry.defaultValue }
    }
  )

  tool(
    'add_links',
    'Adds links to the linkgrabber (one URL per line). They only start downloading if autostart is true.',
    {
      links: z.string().min(1).max(200_000),
      packageName: z.string().max(1000).optional(),
      destinationFolder: z.string().max(1000).optional(),
      autostart: z.boolean().optional(),
      device: deviceParam
    },
    async ({ links, packageName, destinationFolder, autostart, device }) => {
      await resolve(registry, device).grabber.addLinks({ links, packageName, destinationFolder, autostart: autostart === true, autoExtract: false, deepDecrypt: false, overwritePackagizerRules: false })
      return { ok: true }
    }
  )
  return server
}

const findSetting = async (context: DeviceContext, interfaceName: string, storage: string | null, key: string): Promise<{ group: ConfigGroup; entry: ConfigEntry }> => {
  const plugin = storage ? await context.config.pluginGroup(interfaceName, storage) : undefined
  const groups = plugin ? [plugin] : (await context.config.list()).flatMap((c) => c.groups)
  const group = groups.find((g) => g.interfaceName === interfaceName && (g.storage ?? null) === storage)
  const entry = group?.entries.find((e) => e.key === key)
  if (!group || !entry) throw new HttpError(404, 'Unknown setting')
  return { group, entry }
}

const basicUser = (header: string | undefined): string | undefined => {
  if (!header?.startsWith('Basic ')) return undefined
  const user = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':')[0]
  return user ? user.slice(0, 40) : undefined
}

export const registerMcp = (app: FastifyInstance, options: McpOptions): void => {
  const state = readState(options.stateFile)
  const { debug } = options
  debug.enabled = state.debug
  const catalog: McpTool[] = []
  buildServer(options, true, catalog)
  const clients = new Map<string, string>()

  // Stateless: a server and transport per request, nothing is kept between calls (so a change of the
  // write switch applies to the next request).
  app.post('/mcp', async (request, reply) => {
    // Tool calls are logged by the tools themselves; this is the rest of the protocol.
    const body = request.body as { method?: unknown; params?: { clientInfo?: { name?: unknown; version?: unknown } } } | null
    const userAgent = request.headers['user-agent']
    const known = `${request.ip}|${userAgent ?? ''}`
    const info = body?.params?.clientInfo
    if (body?.method === 'initialize' && typeof info?.name === 'string') clients.set(known, `${info.name.slice(0, 60)}${typeof info.version === 'string' ? ` ${info.version.slice(0, 20)}` : ''}`)
    const caller: McpCaller = { client: clients.get(known), user: basicUser(request.headers.authorization), ip: request.ip, userAgent: userAgent?.slice(0, 120) }
    const method = body?.method
    if (typeof method === 'string' && method !== 'tools/call') debug.start('rpc', method, undefined, caller)?.()
    const server = buildServer(options, state.write, undefined, caller)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    reply.hijack()
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(request.raw, reply.raw, request.body)
  })
  const notAllowed = async (_request: unknown, reply: { code: (n: number) => { header: (k: string, v: string) => { send: (b: unknown) => unknown } } }) =>
    reply.code(405).header('Allow', 'POST').send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
  app.get('/mcp', notAllowed)
  app.delete('/mcp', notAllowed)

  // The settings page.
  const view = () => ({ write: state.write, debug: state.debug, tools: catalog })
  app.get('/api/mcp', async () => view())
  app.put<{ Body: { write?: unknown; debug?: unknown } }>('/api/mcp', async (request, reply) => {
    const { write, debug: wantDebug } = request.body ?? {}
    if ((write !== undefined && typeof write !== 'boolean') || (wantDebug !== undefined && typeof wantDebug !== 'boolean') || (write === undefined && wantDebug === undefined)) {
      return reply.code(400).send({ error: 'Invalid body' })
    }
    if (write !== undefined) state.write = write
    if (wantDebug !== undefined) {
      state.debug = wantDebug
      debug.enabled = wantDebug
      // Switching it off forgets what was recorded.
      if (!wantDebug) debug.clear()
    }
    mkdirSync(dirname(options.stateFile), { recursive: true })
    writeFileSync(options.stateFile, JSON.stringify(state), { mode: 0o600 })
    options.log(`MCP settings: write access ${state.write ? 'on' : 'off'}, debug log ${state.debug ? 'on' : 'off'}`)
    return view()
  })

  // The recorded calls: what exists so far, then every change as it happens.
  app.get('/api/mcp/log', (request, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25000)
    send('entries', debug.all())
    const unsubscribe = debug.subscribe((entry) => send('entry', entry))
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })
  app.delete('/api/mcp/log', async () => {
    debug.clear()
    return { ok: true }
  })
}
