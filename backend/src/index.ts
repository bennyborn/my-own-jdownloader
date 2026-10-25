import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import Fastify, { LogController, type FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import { SKIP_TYPES, type SkipType } from './captcha.js'
import { createAuthHook } from './auth.js'
import { DeviceRegistry, legacySolverFile, type DeviceContext } from './devices.js'
import type { Area } from './listops.js'
import { HostIcons } from './icons.js'
import { Plugins } from './plugins.js'
import { join } from 'node:path'
import { SolverTasks } from './solver.js'
import { MyJdClient } from './myjd/client.js'
import { registerMcp } from './mcp.js'
import { McpLog } from './mcplog.js'

const { MYJD_EMAIL, MYJD_PASSWORD, MYJD_DEVICE, MYJD_DEVICES, UI_PASSWORD } = process.env
if (!MYJD_EMAIL || !MYJD_PASSWORD) throw new Error('MYJD_EMAIL and MYJD_PASSWORD must be set')

const port = Number(process.env.PORT ?? 3000)
// Readable log lines; the requests that only poll are not logged, actions and failures are (see the hook below).
const app = Fastify({
  logger: { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } },
  logController: new LogController({ disableRequestLogging: true })
})

const authHook = createAuthHook(UI_PASSWORD)
if (authHook) app.addHook('onRequest', authHook)
else app.log.warn('UI_PASSWORD is not set: UI and API are not protected')

const client = new MyJdClient(MYJD_EMAIL, MYJD_PASSWORD)
await client.connect()

// Registers us as Anti-Captcha service in a device, unless the user has set up one of their own there.
const solverUrl = process.env.JD_SOLVER_URL
const registerSolver = async (context: DeviceContext) => {
  if (!solverUrl) return
  try {
    app.log.info(`Anti-Captcha solver registration for "${context.device.name}": ${await context.solver.register(solverUrl)}`)
  } catch (e) {
    app.log.error(`Anti-Captcha solver registration for "${context.device.name}" failed: ${e instanceof Error ? e.message : e}`)
  }
}
const registry = new DeviceRegistry(client, {
  only: MYJD_DEVICES?.split(',').map((n) => n.trim()).filter(Boolean),
  defaultName: MYJD_DEVICE,
  legacySolverFile: legacySolverFile(),
  onStatus: (context, online) => app.log[online ? 'info' : 'warn'](`Device "${context.device.name}" is ${online ? 'online' : 'offline'}`),
  onOnline: (context) => {
    app.log.info(`Device "${context.device.name}" found`)
    void registerSolver(context)
  }
})
await registry.start()
if (!registry.all().length) throw new Error('No JDownloader device found on this account')

// The device a request is about: ?device=<id> (or "device" in the JSON body), otherwise the default device.
const dev = (request: FastifyRequest): DeviceContext => {
  const fromBody = (request.body as { device?: unknown } | null | undefined)?.device
  const given = (request.query as { device?: string }).device ?? (typeof fromBody === 'string' ? fromBody : undefined)
  return registry.resolve(given)
}
const solverTasks = new SolverTasks()

// What the app does on behalf of the user: every request that is not a plain read, and every failure.
app.addHook('onResponse', async (request, reply) => {
  const path = request.url.split('?')[0]
  if (path === '/getTaskResult' || path === '/getBalance') return
  if (request.method === 'GET' && reply.statusCode < 400) return
  const given = (request.query as { device?: string }).device ?? (request.body as { device?: unknown } | null | undefined)?.device
  const device = registry.all().find((c) => c.id === given)?.device.name ?? (typeof given === 'string' && given ? `unknown device "${given.slice(0, 40)}"` : undefined)
  const line = `${request.method} ${path}${device ? ` [${device}]` : ''} -> ${reply.statusCode} (${Math.round(reply.elapsedTime)} ms)`
  if (reply.statusCode >= 400) app.log.warn(line)
  else app.log.info(line)
})

app.get('/api/health', async () => ({ status: 'ok' }))
app.get('/api/devices', async () => registry.list())
app.get('/api/speed-history', async (request) => ({ now: Date.now(), samples: dev(request).bandwidth.getSamples() }))
app.get('/api/downloads', async (request) => dev(request).poller.refresh())

app.get<{ Params: { uuid: string } }>('/api/packages/:uuid/links', async (request, reply) => {
  const uuid = Number(request.params.uuid)
  if (!Number.isSafeInteger(uuid)) return reply.code(400).send({ error: 'Invalid package uuid' })
  return dev(request).poller.getLinks(uuid)
})

app.get('/api/linkgrabber', async (request) => {
  const { grabber } = dev(request)
  const [collecting, packages, links] = await Promise.all([grabber.isCollecting(), grabber.getPackages(), grabber.getLinks()])
  return { collecting, packages: packages.map((p) => ({ ...p, links: links.filter((l) => l.packageUUID === p.uuid) })) }
})

app.get<{ Querystring: { id?: string } }>('/api/linkgrabber/variants', async (request, reply) => {
  const id = Number(request.query.id)
  if (!Number.isSafeInteger(id)) return reply.code(400).send({ error: 'Invalid link id' })
  return { variants: await dev(request).grabber.getVariants(id) }
})

app.post<{ Body: { linkId?: unknown; variantId?: unknown } }>('/api/linkgrabber/variant', async (request, reply) => {
  const { linkId, variantId } = request.body ?? {}
  if (!Number.isSafeInteger(linkId) || typeof variantId !== 'string' || !variantId || variantId.length > 500) return reply.code(400).send({ error: 'Invalid request' })
  await dev(request).grabber.setVariant(linkId as number, variantId)
  return { ok: true }
})

app.post<{ Body: { linkId?: unknown; variantIds?: unknown } }>('/api/linkgrabber/variants/add', async (request, reply) => {
  const { linkId, variantIds } = request.body ?? {}
  const valid = Array.isArray(variantIds) && variantIds.length > 0 && variantIds.length <= 100 && variantIds.every((v) => typeof v === 'string' && v && v.length <= 500)
  if (!Number.isSafeInteger(linkId) || !valid) return reply.code(400).send({ error: 'Invalid request' })
  await dev(request).grabber.addVariantCopies(linkId as number, variantIds as string[])
  return { ok: true }
})

app.get('/api/linkgrabber/folders', async (request) => dev(request).grabber.getFolders())

const optionalString = (value: unknown, max = 1000): string | undefined =>
  typeof value === 'string' && value.length <= max ? value : undefined

app.post<{ Body: Record<string, unknown> }>('/api/linkgrabber/add', async (request, reply) => {
  const body = request.body ?? {}
  const links = body.links
  if (typeof links !== 'string' || !links.trim() || links.length > 200_000) return reply.code(400).send({ error: 'Invalid links' })
  await dev(request).grabber.addLinks({
    links,
    packageName: optionalString(body.packageName),
    destinationFolder: optionalString(body.destinationFolder),
    extractPassword: optionalString(body.extractPassword),
    downloadPassword: optionalString(body.downloadPassword),
    autostart: body.autostart === true,
    autoExtract: body.autoExtract === true,
    deepDecrypt: body.deepDecrypt === true,
    overwritePackagizerRules: body.overwritePackagizerRules === true
  })
  return { ok: true }
})

// Click'n'Load from the browser extension (the page believes it talks to a local JDownloader).
app.post<{ Body: Record<string, unknown> }>('/api/linkgrabber/cnl', { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
  const body = request.body ?? {}
  const text = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value && value.length <= max ? value : undefined)
  const urls = text(body.urls, 2_000_000)
  const crypted = text(body.crypted, 2_000_000)
  if (!urls && !crypted) return reply.code(400).send({ error: 'Neither urls nor crypted links given' })
  if (crypted && !text(body.jk, 100_000) && !text(body.key, 1000)) return reply.code(400).send({ error: 'Click\'n\'Load key missing' })
  const passwords = text(body.passwords, 5000)
  await dev(request).grabber.addCnl({
    urls,
    crypted,
    jk: text(body.jk, 100_000),
    key: text(body.key, 1000),
    passwords: passwords ? [passwords] : undefined,
    packageName: text(body.packageName, 500),
    source: text(body.source, 2000),
    referrer: text(body.referrer, 2000)
  })
  return { ok: true }
})

app.post<{ Body: { filename?: unknown; dataUrl?: unknown } }>(
  '/api/linkgrabber/add-container',
  { bodyLimit: 10 * 1024 * 1024 },
  async (request, reply) => {
    const { filename, dataUrl } = request.body ?? {}
    const type = typeof filename === 'string' ? filename.split('.').pop()?.toLowerCase() : undefined
    if (!type || !/^[a-z0-9]{2,8}$/.test(type) || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return reply.code(400).send({ error: 'Invalid container file' })
    }
    await dev(request).grabber.addContainer(type, dataUrl)
    return { ok: true }
  }
)

const isIdList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every((v) => Number.isSafeInteger(v))

app.post<{ Body: { packageIds?: unknown; afterPackageId?: unknown } }>('/api/linkgrabber/packages/move', async (request, reply) => {
  const { packageIds, afterPackageId } = request.body ?? {}
  if (!isIdList(packageIds) || !Number.isSafeInteger(afterPackageId)) return reply.code(400).send({ error: 'Invalid body' })
  await dev(request).grabber.movePackages(packageIds, afterPackageId as number)
  return { ok: true }
})

app.post<{ Params: { uuid: string }; Body: { linkIds?: unknown; afterLinkId?: unknown } }>('/api/linkgrabber/packages/:uuid/links/move', async (request, reply) => {
  const packageId = Number(request.params.uuid)
  const { linkIds, afterLinkId } = request.body ?? {}
  if (!Number.isSafeInteger(packageId) || !isIdList(linkIds) || !Number.isSafeInteger(afterLinkId)) {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  await dev(request).grabber.moveLinks(packageId, linkIds, afterLinkId as number)
  return { ok: true }
})

app.post<{ Body: { destPackageId?: unknown; packageIds?: unknown } }>('/api/linkgrabber/merge', async (request, reply) => {
  const { destPackageId, packageIds } = request.body ?? {}
  if (!Number.isSafeInteger(destPackageId) || !Array.isArray(packageIds) || !packageIds.length || !packageIds.every((v) => Number.isSafeInteger(v))) {
    return reply.code(400).send({ error: 'Invalid body' })
  }
  await dev(request).grabber.merge(destPackageId as number, packageIds as number[])
  return { ok: true }
})

const toIds = (value: unknown): number[] | null =>
  value === undefined ? [] : Array.isArray(value) && value.every((v) => Number.isSafeInteger(v)) ? (value as number[]) : null

for (const [route, action] of [
  ['move-to-downloads', 'moveToDownloads'],
  ['remove', 'remove']
] as const) {
  app.post<{ Body: { linkIds?: unknown; packageIds?: unknown } }>(`/api/linkgrabber/${route}`, async (request, reply) => {
    const linkIds = toIds(request.body?.linkIds)
    const packageIds = toIds(request.body?.packageIds)
    if (!linkIds || !packageIds || linkIds.length + packageIds.length === 0) return reply.code(400).send({ error: 'Invalid body' })
    await dev(request).grabber[action](linkIds, packageIds)
    return { ok: true }
  })
}

// Rename, enable/disable and download folder, for both the download list and the linkgrabber.
const idList = (value: unknown): number[] | null =>
  Array.isArray(value) && value.every((v) => Number.isSafeInteger(v)) ? (value as number[]) : null

app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
  app.log.error(error)
  return reply.code(error.statusCode ?? 500).send({ error: error.message })
})

app.get<{ Params: { area: string }; Querystring: { kind?: string; id?: string } }>('/api/:area/urls', async (request, reply) => {
  const { area } = request.params
  const { kind } = request.query
  const id = Number(request.query.id)
  if ((area !== 'downloads' && area !== 'linkgrabber') || (kind !== 'package' && kind !== 'link') || !Number.isSafeInteger(id)) {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  return { urls: await dev(request).listOps[area].getUrls(kind, id) }
})

app.post<{ Params: { area: string }; Body: { kind?: unknown; id?: unknown; name?: unknown } }>('/api/:area/rename', async (request, reply) => {
  const { area } = request.params
  const { kind, id, name } = request.body ?? {}
  if ((area !== 'downloads' && area !== 'linkgrabber') || !Number.isSafeInteger(id) || typeof name !== 'string' || !name.trim() || name.length > 500) {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  if (kind === 'package') await dev(request).listOps[area].renamePackage(id as number, name.trim())
  else if (kind === 'link') await dev(request).listOps[area].renameLink(id as number, name.trim())
  else return reply.code(400).send({ error: 'Invalid kind' })
  return { ok: true }
})

app.post<{ Params: { area: string }; Body: { enabled?: unknown; linkIds?: unknown; packageIds?: unknown } }>('/api/:area/enabled', async (request, reply) => {
  const { area } = request.params
  const { enabled } = request.body ?? {}
  const linkIds = idList(request.body?.linkIds ?? [])
  const packageIds = idList(request.body?.packageIds ?? [])
  if ((area !== 'downloads' && area !== 'linkgrabber') || typeof enabled !== 'boolean' || !linkIds || !packageIds || linkIds.length + packageIds.length === 0) {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  await dev(request).listOps[area].setEnabled(enabled, linkIds, packageIds)
  return { ok: true }
})

app.post<{ Params: { area: string }; Body: { directory?: unknown; packageIds?: unknown } }>('/api/:area/directory', async (request, reply) => {
  const { area } = request.params
  const { directory } = request.body ?? {}
  const packageIds = idList(request.body?.packageIds)
  if ((area !== 'downloads' && area !== 'linkgrabber') || typeof directory !== 'string' || !directory.trim() || directory.length > 1000 || !packageIds?.length) {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  await dev(request).listOps[area].setDirectory(directory.trim(), packageIds)
  return { ok: true }
})

app.post<{ Body: { linkIds?: unknown; packageIds?: unknown; deleteFiles?: unknown } }>('/api/downloads/remove', async (request, reply) => {
  const linkIds = idList(request.body?.linkIds ?? [])
  const packageIds = idList(request.body?.packageIds ?? [])
  const { deleteFiles } = request.body ?? {}
  if (!linkIds || !packageIds || linkIds.length + packageIds.length === 0 || typeof deleteFiles !== 'boolean') {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  await dev(request).listOps.downloads.removeFromDownloads(linkIds, packageIds, deleteFiles)
  return { ok: true }
})

app.post<{ Params: { area: string }; Body: { packageId?: unknown; dryRun?: unknown } }>('/api/:area/interleave', async (request, reply) => {
  const { area } = request.params
  const { packageId, dryRun } = request.body ?? {}
  if ((area !== 'downloads' && area !== 'linkgrabber') || !Number.isSafeInteger(packageId) || typeof dryRun !== 'boolean') {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  return dev(request).listOps[area].interleaveHosts(packageId as number, dryRun)
})

app.post<{ Params: { area: string }; Body: { packageId?: unknown } }>('/api/:area/sort-links', async (request, reply) => {
  const { area } = request.params
  const { packageId } = request.body ?? {}
  if ((area !== 'downloads' && area !== 'linkgrabber') || !Number.isSafeInteger(packageId)) {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  return dev(request).listOps[area].sortLinks(packageId as number)
})

app.post<{ Params: { area: string }; Body: { kind?: unknown; ids?: unknown; position?: unknown } }>('/api/:area/move-to-edge', async (request, reply) => {
  const { area } = request.params
  const { kind, position } = request.body ?? {}
  const ids = idList(request.body?.ids)
  if ((area !== 'downloads' && area !== 'linkgrabber') || (kind !== 'package' && kind !== 'link') || (position !== 'top' && position !== 'bottom') || !ids?.length) {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  await dev(request).listOps[area].moveToEdge(kind, ids, position)
  return { ok: true }
})

app.post<{ Body: { linkIds?: unknown; packageIds?: unknown } }>('/api/downloads/start', async (request, reply) => {
  const linkIds = idList(request.body?.linkIds ?? [])
  const packageIds = idList(request.body?.packageIds ?? [])
  if (!linkIds || !packageIds || linkIds.length + packageIds.length === 0) return reply.code(400).send({ error: 'Invalid request' })
  const { listOps, poller } = dev(request)
  await listOps.downloads.startDownload(linkIds, packageIds)
  poller.markForced(linkIds, packageIds)
  return { ok: true }
})

app.post<{ Body: { linkId?: unknown; packageId?: unknown } }>('/api/downloads/stop-mark', async (request, reply) => {
  const { linkId, packageId } = request.body ?? {}
  const valid = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0
  if (valid(linkId) === valid(packageId)) return reply.code(400).send({ error: 'Invalid request' })
  await dev(request).listOps.downloads.setStopMark(valid(linkId) ? linkId : undefined, valid(packageId) ? packageId : undefined)
  return { ok: true }
})

app.post('/api/downloads/stop-mark/remove', async (request) => {
  await dev(request).listOps.downloads.removeStopMark()
  return { ok: true }
})

app.post<{ Body: { linkIds?: unknown; packageIds?: unknown } }>('/api/downloads/archives', async (request, reply) => {
  const linkIds = idList(request.body?.linkIds ?? [])
  const packageIds = idList(request.body?.packageIds ?? [])
  if (!linkIds || !packageIds || linkIds.length + packageIds.length === 0) return reply.code(400).send({ error: 'Invalid request' })
  return dev(request).listOps.downloads.getArchives(linkIds, packageIds)
})

app.post<{ Body: { archiveIds?: unknown; settings?: Record<string, unknown> } }>('/api/downloads/archive-settings', async (request, reply) => {
  const { archiveIds, settings } = request.body ?? {}
  const keys = ['autoExtract', 'removeFilesAfterExtraction', 'removeDownloadLinksAfterExtraction']
  const entries = Object.entries(settings ?? {})
  if (!Array.isArray(archiveIds) || !archiveIds.length || !archiveIds.every((id) => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id))) return reply.code(400).send({ error: 'Invalid request' })
  if (!entries.length || !entries.every(([k, v]) => keys.includes(k) && typeof v === 'boolean')) return reply.code(400).send({ error: 'Invalid request' })
  await dev(request).listOps.downloads.setArchiveSettings(archiveIds as string[], Object.fromEntries(entries))
  return { ok: true }
})

app.post<{ Body: { linkIds?: unknown; packageIds?: unknown } }>('/api/downloads/extract', async (request, reply) => {
  const linkIds = idList(request.body?.linkIds ?? [])
  const packageIds = idList(request.body?.packageIds ?? [])
  if (!linkIds || !packageIds || linkIds.length + packageIds.length === 0) return reply.code(400).send({ error: 'Invalid request' })
  await dev(request).listOps.downloads.startExtraction(linkIds, packageIds)
  return { ok: true }
})

app.post<{ Body: { linkIds?: unknown; packageIds?: unknown } }>('/api/downloads/reset', async (request, reply) => {
  const linkIds = idList(request.body?.linkIds ?? [])
  const packageIds = idList(request.body?.packageIds ?? [])
  if (!linkIds || !packageIds || linkIds.length + packageIds.length === 0) return reply.code(400).send({ error: 'Invalid request' })
  await dev(request).listOps.downloads.resetLinks(linkIds, packageIds)
  return { ok: true }
})

app.post<{ Body: { destPackageId?: unknown; packageIds?: unknown } }>('/api/downloads/merge', async (request, reply) => {
  const { destPackageId } = request.body ?? {}
  const packageIds = idList(request.body?.packageIds)
  if (!Number.isSafeInteger(destPackageId) || !packageIds?.length) return reply.code(400).send({ error: 'Invalid body' })
  await dev(request).listOps.downloads.mergeInto(destPackageId as number, packageIds)
  return { ok: true }
})

app.post<{ Params: { area: string }; Body: { packageIds?: unknown } }>('/api/:area/split-by-host', async (request, reply) => {
  const { area } = request.params
  const packageIds = idList(request.body?.packageIds)
  if ((area !== 'downloads' && area !== 'linkgrabber') || !packageIds?.length) return reply.code(400).send({ error: 'Invalid request' })
  await dev(request).listOps[area].splitByHoster(packageIds)
  return { ok: true }
})

// One JDownloader device: whether it answers right now (the device list's own status field is always
// UNKNOWN) and the download totals, like the web UI's status bar. Used by the browser extension's popup,
// which shows one card per device.
app.get('/api/device', async (request) => {
  const { device, poller, online } = dev(request)
  const reachable = online !== false
  const snapshot = reachable ? await poller.refresh() : poller.getSnapshot()
  const packages = snapshot.packages
  const bytesTotal = packages.reduce((sum, p) => sum + p.bytesTotal, 0)
  const bytesLoaded = packages.reduce((sum, p) => sum + p.bytesLoaded, 0)
  const speed = reachable ? snapshot.totalSpeed : 0
  return {
    id: device.id,
    name: device.name,
    type: device.type,
    status: reachable ? 'ONLINE' : 'OFFLINE',
    queue: { packages: packages.length, links: snapshot.linkCount, running: reachable ? snapshot.runningDownloads : 0 },
    downloads: {
      running: reachable ? snapshot.runningDownloads : 0,
      speed,
      bytesLoaded,
      bytesTotal,
      eta: speed > 0 ? (bytesTotal - bytesLoaded) / speed : null
    }
  }
})

// Open captchas. Without ?device= those of all devices: they have to be answered whichever device is
// shown right now. Every job says which device it belongs to; the other captcha routes need that device.
app.get<{ Querystring: { device?: string } }>('/api/captcha', async (request) => {
  const contexts = request.query.device ? [registry.resolve(request.query.device)] : registry.all()
  const lists = await Promise.all(
    contexts.map(async (c) => {
      const own = c.online === false ? [] : await c.captchas.list().catch(() => [])
      return [...own, ...solverTasks.jobs(c.id)].map((j) => ({ ...j, device: c.id, deviceName: c.device.name }))
    })
  )
  return lists.flat()
})

app.get<{ Params: { id: string } }>('/api/captcha/:id', async (request, reply) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id)) return reply.code(400).send({ error: 'Invalid id' })
  const task = solverTasks.get(id)
  if (task) return solverTasks.details(task)
  const details = await dev(request).captchas.details(id)
  request.log.info({ captcha: details }, 'captcha job details')
  return details ?? reply.code(404).send({ error: 'Captcha is no longer open' })
})

app.get<{ Params: { id: string } }>('/api/captcha/:id/image', async (request, reply) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id)) return reply.code(400).send({ error: 'Invalid id' })
  const image = await dev(request).captchas.image(id)
  if (!image) return reply.code(404).send({ error: 'No picture for this captcha' })
  return reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').type(image.type).send(image.data)
})

// Token captchas (token) or image captchas (text).
app.post<{ Params: { id: string }; Body: { token?: unknown; text?: unknown } }>('/api/captcha/:id/solve', async (request, reply) => {
  const id = Number(request.params.id)
  const { token, text } = request.body ?? {}
  if (!Number.isSafeInteger(id)) return reply.code(400).send({ error: 'Invalid request' })
  if (typeof text === 'string' && text.trim() && text.length <= 200) {
    await dev(request).captchas.solveText(id, text.trim())
    return { ok: true }
  }
  if (typeof token !== 'string' || !token || token.length > 10_000) return reply.code(400).send({ error: 'Invalid request' })
  if (solverTasks.has(id)) solverTasks.solve(id, token)
  else await dev(request).captchas.solve(id, token)
  return { ok: true }
})

app.post<{ Params: { id: string }; Body: { type?: unknown } }>('/api/captcha/:id/skip', async (request, reply) => {
  const id = Number(request.params.id)
  const type = request.body?.type
  if (!Number.isSafeInteger(id) || !SKIP_TYPES.includes(type as SkipType)) return reply.code(400).send({ error: 'Invalid request' })
  await dev(request).captchas.skip(id, type as SkipType)
  return { ok: true }
})

// Anti-Captcha compatible endpoints for JDownloader (registered via JD_SOLVER_URL). JD sends captchas it
// cannot show itself (Cloudflare Turnstile) here; they appear in the captcha list and the browser
// extension solves them on the hoster's page. Every device has its own clientKey, which says whose task it is.
type AntiCaptchaBody = { clientKey?: unknown; task?: Record<string, unknown>; taskId?: unknown }
const antiCaptchaDenied = { errorId: 1, errorCode: 'ERROR_KEY_DOES_NOT_EXIST', errorDescription: 'Invalid key' }
app.post<{ Body: AntiCaptchaBody }>('/getBalance', async (request, reply) => {
  if (!registry.bySolverKey(request.body?.clientKey)) return reply.code(401).send(antiCaptchaDenied)
  return { errorId: 0, balance: 1 }
})
app.post<{ Body: AntiCaptchaBody }>('/createTask', async (request, reply) => {
  const owner = registry.bySolverKey(request.body?.clientKey)
  if (!owner) return reply.code(401).send(antiCaptchaDenied)
  const task = request.body?.task ?? {}
  request.log.info({ task, device: owner.device.name }, 'anti-captcha createTask')
  let url: URL | undefined
  try {
    url = new URL(String(task.websiteURL))
  } catch {
    /* handled below */
  }
  if (!SolverTasks.supports(task.type) || !url || !/^https?:$/.test(url.protocol) || typeof task.websiteKey !== 'string' || !task.websiteKey) {
    return { errorId: 1, errorCode: 'ERROR_NO_SLOT_AVAILABLE', errorDescription: 'Task type not supported' }
  }
  return { errorId: 0, taskId: solverTasks.create(owner.id, String(task.type), url.toString(), task.websiteKey).id }
})
app.post<{ Body: AntiCaptchaBody }>('/getTaskResult', async (request, reply) => {
  const owner = registry.bySolverKey(request.body?.clientKey)
  if (!owner) return reply.code(401).send(antiCaptchaDenied)
  const task = solverTasks.get(Number(request.body?.taskId))
  if (!task || task.deviceId !== owner.id) return { errorId: 1, errorCode: 'ERROR_NO_SUCH_CAPCHA_ID', errorDescription: 'Unknown or expired task' }
  if (!task.token) return { errorId: 0, status: 'processing' }
  return { errorId: 0, status: 'ready', solution: { token: task.token }, cost: '0', createTime: Math.floor(task.created / 1000), endTime: Math.floor(Date.now() / 1000), solveCount: 1 }
})

// Host icons: brand icons (simple-icons), the host's own favicon (cached on disk), then a generated letter tile.
const hostIcons = new HostIcons(process.env.ICON_CACHE_DIR ?? './data/icons')

app.get<{ Params: { host: string } }>('/api/icons/:host', async (request, reply) => {
  const host = request.params.host.toLowerCase()
  if (!/^[a-z0-9.-]{1,100}$/.test(host)) return reply.code(400).send({ error: 'Invalid host' })
  const icon = await hostIcons.get(host)
  return reply
    .header('Cache-Control', 'public, max-age=86400')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
    .type(icon.type)
    .send(icon.data)
})

// Plugins (see plugins.ts): trusted code from one folder, settings in the data directory.
const dataDir = process.env.DATA_DIR ?? './data'
const plugins = new Plugins(
  process.env.PLUGINS_DIR ?? fileURLToPath(new URL('../../plugins', import.meta.url)),
  join(dataDir, 'settings.json'),
  join(dataDir, 'plugin-images'),
  app.log
)
await plugins.load()

// Premium accounts of one device. Passwords go in, never out.
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
app.get('/api/accounts', async (request) => dev(request).accounts.list())
app.get('/api/accounts/hosters', async (request) => dev(request).accounts.premiumHosters())
app.post<{ Body: { hostname?: unknown; username?: unknown; password?: unknown } }>('/api/accounts', async (request, reply) => {
  const { hostname, username, password } = request.body ?? {}
  if (!text(hostname) || !text(username) || typeof password !== 'string') return reply.code(400).send({ error: 'Invalid body' })
  await dev(request).accounts.add(hostname.trim(), username, password)
  return { ok: true }
})
app.post<{ Body: { ids?: unknown } }>('/api/accounts/remove', async (request, reply) => {
  const { ids } = request.body ?? {}
  if (!isIdList(ids)) return reply.code(400).send({ error: 'Invalid body' })
  await dev(request).accounts.remove(ids)
  return { ok: true }
})
app.post<{ Body: { ids?: unknown; enabled?: unknown } }>('/api/accounts/set-enabled', async (request, reply) => {
  const { ids, enabled } = request.body ?? {}
  if (!isIdList(ids) || typeof enabled !== 'boolean') return reply.code(400).send({ error: 'Invalid body' })
  await dev(request).accounts.setEnabled(ids, enabled)
  return { ok: true }
})
app.post<{ Body: { id?: unknown; username?: unknown; password?: unknown } }>('/api/accounts/credentials', async (request, reply) => {
  const { id, username, password } = request.body ?? {}
  if (!Number.isSafeInteger(id) || !text(username) || typeof password !== 'string') return reply.code(400).send({ error: 'Invalid body' })
  await dev(request).accounts.setCredentials(id as number, username, password)
  return { ok: true }
})
app.post<{ Body: { ids?: unknown } }>('/api/accounts/refresh', async (request, reply) => {
  const { ids } = request.body ?? {}
  if (!isIdList(ids)) return reply.code(400).send({ error: 'Invalid body' })
  await dev(request).accounts.refresh(ids)
  return { ok: true }
})

// The JDownloader's own settings of one device (the page "Settings > JDownloader"). Written straight to the device.
app.get('/api/jd-config', async (request) => dev(request).config.list())
// The settings of the JDownloader's plugins (hosters, crawlers, ...): the list first, one plugin's settings on demand.
app.get('/api/jd-plugins', async (request) => dev(request).config.plugins())
app.get<{ Querystring: { interfaceName?: string; storage?: string } }>('/api/jd-plugins/config', async (request, reply) => {
  const { interfaceName, storage } = request.query
  if (!text(interfaceName) || !text(storage)) return reply.code(400).send({ error: 'Invalid query' })
  const group = await dev(request).config.pluginGroup(interfaceName, storage)
  return group ?? reply.code(404).send({ error: 'Unknown plugin' })
})
app.put<{ Body: { interfaceName?: unknown; storage?: unknown; key?: unknown; value?: unknown } }>('/api/jd-config', async (request, reply) => {
  const { interfaceName, storage, key, value } = request.body ?? {}
  if (typeof interfaceName !== 'string' || typeof key !== 'string' || (storage != null && typeof storage !== 'string') || value === undefined) return reply.code(400).send({ error: 'Invalid body' })
  await dev(request).config.set(interfaceName, (storage as string | null | undefined) ?? null, key, value)
  return { ok: true }
})
app.post<{ Body: { interfaceName?: unknown; storage?: unknown; key?: unknown } }>('/api/jd-config/reset', async (request, reply) => {
  const { interfaceName, storage, key } = request.body ?? {}
  if (typeof interfaceName !== 'string' || typeof key !== 'string' || (storage != null && typeof storage !== 'string')) return reply.code(400).send({ error: 'Invalid body' })
  await dev(request).config.reset(interfaceName, (storage as string | null | undefined) ?? null, key)
  return { ok: true }
})

app.get('/api/plugins', async () => plugins.list())
app.put<{ Params: { id: string }; Body: { enabled?: unknown; values?: unknown } }>('/api/plugins/:id', async (request) => plugins.update(request.params.id, request.body ?? {}))
app.get<{ Params: { id: string }; Querystring: { name?: string; uuid?: string; area?: string } }>('/api/plugins/:id/package', async (request, reply) => {
  const name = request.query.name
  const uuid = Number(request.query.uuid)
  if (!name || name.length > 500) return reply.code(400).send({ error: 'Invalid name' })
  if (!Number.isSafeInteger(uuid)) return reply.code(400).send({ error: 'Invalid package uuid' })
  const area = request.query.area === 'linkgrabber' ? 'linkgrabber' : 'downloads'
  const context = dev(request)
  const urls = () => (area === 'linkgrabber' ? context.grabber.getUrls(uuid) : context.poller.getUrls(uuid))
  return (await plugins.packageData(request.params.id, name, `${context.id}\0${area}\0${uuid}`, urls)) ?? {}
})
app.get<{ Params: { id: string } }>('/api/plugins/:id/ui.js', async (request, reply) => {
  const source = await plugins.uiSource(request.params.id)
  if (source === null) return reply.code(404).send({ error: 'Not found' })
  return reply.header('Cache-Control', 'no-cache').type('text/javascript; charset=utf-8').send(source)
})
app.get<{ Params: { id: string; token: string } }>('/api/plugins/:id/image/:token', async (request, reply) => {
  const image = await plugins.image(request.params.id, request.params.token)
  if (!image) return reply.code(404).send({ error: 'Not found' })
  return reply
    .header('Cache-Control', 'public, max-age=86400')
    .header('X-Content-Type-Options', 'nosniff')
    .type(image.type)
    .send(image.data)
})

// Cached plugin data (posters) of packages that were deleted is removed. Only done when every device has
// fresh, complete data: an offline device or a stale list would make its packages look deleted.
setInterval(() => {
  const contexts = registry.all()
  const now = Date.now()
  if (!contexts.length || contexts.some((c) => c.online !== true || now - c.poller.getSnapshot().updatedAt > 30000)) return
  const names = new Set(contexts.flatMap((c) => c.poller.getSnapshot().packages.map((p) => p.name)))
  void plugins.prune(names).then((n) => n && app.log.info(`Plugins: removed ${n} unused poster${n === 1 ? '' : 's'}`))
}, 60000).unref()

app.post<{ Body: { packageIds?: unknown; afterPackageId?: unknown } }>('/api/packages/move', async (request, reply) => {
  const { packageIds, afterPackageId } = request.body ?? {}
  if (!isIdList(packageIds) || !Number.isSafeInteger(afterPackageId)) return reply.code(400).send({ error: 'Invalid body' })
  await dev(request).poller.movePackages(packageIds, afterPackageId as number)
  return { ok: true }
})

app.post<{ Params: { uuid: string }; Body: { linkIds?: unknown; afterLinkId?: unknown } }>(
  '/api/packages/:uuid/links/move',
  async (request, reply) => {
    const packageId = Number(request.params.uuid)
    const { linkIds, afterLinkId } = request.body ?? {}
    if (!Number.isSafeInteger(packageId) || !isIdList(linkIds) || !Number.isSafeInteger(afterLinkId)) {
      return reply.code(400).send({ error: 'Invalid request' })
    }
    await dev(request).poller.moveLinks(packageId, linkIds, afterLinkId as number)
    return { ok: true }
  }
)

// Server-sent events: pushes a new snapshot whenever a poller has fresh data. ?device=<id> streams one
// device, ?device=all every online device (each event says which device it is about).
app.get<{ Querystring: { device?: string } }>('/api/events', (request, reply) => {
  const contexts = request.query.device === 'all' ? registry.all().filter((c) => c.online !== false) : [dev(request)]
  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25000)
  const unsubscribes = contexts.map((c) => {
    const send = (snapshot: unknown) => reply.raw.write(`event: downloads\ndata: ${JSON.stringify({ device: c.id, ...(snapshot as object) })}\n\n`)
    const unsubscribe = c.poller.subscribe(send)
    send(c.poller.getSnapshot())
    return unsubscribe
  })
  request.raw.on('close', () => {
    clearInterval(heartbeat)
    for (const unsubscribe of unsubscribes) unsubscribe()
  })
})

// MCP server for assistants (read-only unless switched on in the settings or by MCP_WRITE=true), behind the same password as the rest.
registerMcp(app, { registry, stateFile: join(dataDir, 'mcp.json'), debug: new McpLog(), log: (m) => app.log.info(m) })

// Serve the built frontend if present (production / Docker)
const publicDir = fileURLToPath(new URL('../public', import.meta.url))
if (existsSync(publicDir)) {
  await app.register(fastifyStatic, { root: publicDir })
}

await app.listen({ port, host: '0.0.0.0' })
