import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { BandwidthHistory } from './bandwidth.js'
import { Captchas, SKIP_TYPES, type SkipType } from './captcha.js'
import { createAuthHook } from './auth.js'
import { DownloadsPoller } from './downloads.js'
import { ListOps, type Area } from './listops.js'
import { HostIcons } from './icons.js'
import { SolverRegistration, SolverTasks } from './solver.js'
import { Linkgrabber } from './linkgrabber.js'
import { MyJdClient } from './myjd/client.js'

const { MYJD_EMAIL, MYJD_PASSWORD, MYJD_DEVICE, UI_PASSWORD } = process.env
if (!MYJD_EMAIL || !MYJD_PASSWORD) throw new Error('MYJD_EMAIL and MYJD_PASSWORD must be set')

const port = Number(process.env.PORT ?? 20031)
const app = Fastify({ logger: true })

const authHook = createAuthHook(UI_PASSWORD)
if (authHook) app.addHook('onRequest', authHook)
else app.log.warn('UI_PASSWORD is not set: UI and API are not protected')

const client = new MyJdClient(MYJD_EMAIL, MYJD_PASSWORD)
await client.connect()
const devices = await client.listDevices()
const device = devices.find((d) => d.name === MYJD_DEVICE) ?? devices[0]
if (!device) throw new Error('No JDownloader device found on this account')
app.log.info(`Using device "${device.name}"`)

const poller = new DownloadsPoller(client, device.id)
const grabber = new Linkgrabber(client, device.id)
const captchas = new Captchas(client, device.id)
const solver = new SolverRegistration(client, device.id)
const solverTasks = new SolverTasks()
if (process.env.JD_SOLVER_URL) {
  try {
    app.log.info(`Anti-Captcha solver registration: ${await solver.register(process.env.JD_SOLVER_URL)}`)
  } catch (e) {
    app.log.error(`Anti-Captcha solver registration failed: ${e instanceof Error ? e.message : e}`)
  }
}
const bandwidth = new BandwidthHistory(client, device.id)
bandwidth.start()

app.get('/api/health', async () => ({ status: 'ok' }))
app.get('/api/devices', async () => devices.map(({ id, name, type }) => ({ id, name, type })))
app.get('/api/speed-history', async () => ({ now: Date.now(), samples: bandwidth.getSamples() }))
app.get('/api/downloads', async () => poller.refresh())

app.get<{ Params: { uuid: string } }>('/api/packages/:uuid/links', async (request, reply) => {
  const uuid = Number(request.params.uuid)
  if (!Number.isSafeInteger(uuid)) return reply.code(400).send({ error: 'Invalid package uuid' })
  return poller.getLinks(uuid)
})

app.get('/api/linkgrabber', async () => {
  const [collecting, packages, links] = await Promise.all([grabber.isCollecting(), grabber.getPackages(), grabber.getLinks()])
  return { collecting, packages: packages.map((p) => ({ ...p, links: links.filter((l) => l.packageUUID === p.uuid) })) }
})

app.get('/api/linkgrabber/folders', async () => grabber.getFolders())

const optionalString = (value: unknown, max = 1000): string | undefined =>
  typeof value === 'string' && value.length <= max ? value : undefined

app.post<{ Body: Record<string, unknown> }>('/api/linkgrabber/add', async (request, reply) => {
  const body = request.body ?? {}
  const links = body.links
  if (typeof links !== 'string' || !links.trim() || links.length > 200_000) return reply.code(400).send({ error: 'Invalid links' })
  await grabber.addLinks({
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
  await grabber.addCnl({
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
    await grabber.addContainer(type, dataUrl)
    return { ok: true }
  }
)

const isIdList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every((v) => Number.isSafeInteger(v))

app.post<{ Body: { packageIds?: unknown; afterPackageId?: unknown } }>('/api/linkgrabber/packages/move', async (request, reply) => {
  const { packageIds, afterPackageId } = request.body ?? {}
  if (!isIdList(packageIds) || !Number.isSafeInteger(afterPackageId)) return reply.code(400).send({ error: 'Invalid body' })
  await grabber.movePackages(packageIds, afterPackageId as number)
  return { ok: true }
})

app.post<{ Params: { uuid: string }; Body: { linkIds?: unknown; afterLinkId?: unknown } }>('/api/linkgrabber/packages/:uuid/links/move', async (request, reply) => {
  const packageId = Number(request.params.uuid)
  const { linkIds, afterLinkId } = request.body ?? {}
  if (!Number.isSafeInteger(packageId) || !isIdList(linkIds) || !Number.isSafeInteger(afterLinkId)) {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  await grabber.moveLinks(packageId, linkIds, afterLinkId as number)
  return { ok: true }
})

app.post<{ Body: { destPackageId?: unknown; packageIds?: unknown } }>('/api/linkgrabber/merge', async (request, reply) => {
  const { destPackageId, packageIds } = request.body ?? {}
  if (!Number.isSafeInteger(destPackageId) || !Array.isArray(packageIds) || !packageIds.length || !packageIds.every((v) => Number.isSafeInteger(v))) {
    return reply.code(400).send({ error: 'Invalid body' })
  }
  await grabber.merge(destPackageId as number, packageIds as number[])
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
    await grabber[action](linkIds, packageIds)
    return { ok: true }
  })
}

// Rename, enable/disable and download folder, for both the download list and the linkgrabber.
const listOps: Record<Area, ListOps> = {
  downloads: new ListOps(client, device.id, 'downloads'),
  linkgrabber: new ListOps(client, device.id, 'linkgrabber')
}
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
  return { urls: await listOps[area].getUrls(kind, id) }
})

app.post<{ Params: { area: string }; Body: { kind?: unknown; id?: unknown; name?: unknown } }>('/api/:area/rename', async (request, reply) => {
  const { area } = request.params
  const { kind, id, name } = request.body ?? {}
  if ((area !== 'downloads' && area !== 'linkgrabber') || !Number.isSafeInteger(id) || typeof name !== 'string' || !name.trim() || name.length > 500) {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  if (kind === 'package') await listOps[area].renamePackage(id as number, name.trim())
  else if (kind === 'link') await listOps[area].renameLink(id as number, name.trim())
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
  await listOps[area].setEnabled(enabled, linkIds, packageIds)
  return { ok: true }
})

app.post<{ Params: { area: string }; Body: { directory?: unknown; packageIds?: unknown } }>('/api/:area/directory', async (request, reply) => {
  const { area } = request.params
  const { directory } = request.body ?? {}
  const packageIds = idList(request.body?.packageIds)
  if ((area !== 'downloads' && area !== 'linkgrabber') || typeof directory !== 'string' || !directory.trim() || directory.length > 1000 || !packageIds?.length) {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  await listOps[area].setDirectory(directory.trim(), packageIds)
  return { ok: true }
})

app.post<{ Body: { linkIds?: unknown; packageIds?: unknown; deleteFiles?: unknown } }>('/api/downloads/remove', async (request, reply) => {
  const linkIds = idList(request.body?.linkIds ?? [])
  const packageIds = idList(request.body?.packageIds ?? [])
  const { deleteFiles } = request.body ?? {}
  if (!linkIds || !packageIds || linkIds.length + packageIds.length === 0 || typeof deleteFiles !== 'boolean') {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  await listOps.downloads.removeFromDownloads(linkIds, packageIds, deleteFiles)
  return { ok: true }
})

app.post<{ Params: { area: string }; Body: { packageId?: unknown; dryRun?: unknown } }>('/api/:area/interleave', async (request, reply) => {
  const { area } = request.params
  const { packageId, dryRun } = request.body ?? {}
  if ((area !== 'downloads' && area !== 'linkgrabber') || !Number.isSafeInteger(packageId) || typeof dryRun !== 'boolean') {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  return listOps[area].interleaveHosts(packageId as number, dryRun)
})

app.post<{ Params: { area: string }; Body: { kind?: unknown; ids?: unknown; position?: unknown } }>('/api/:area/move-to-edge', async (request, reply) => {
  const { area } = request.params
  const { kind, position } = request.body ?? {}
  const ids = idList(request.body?.ids)
  if ((area !== 'downloads' && area !== 'linkgrabber') || (kind !== 'package' && kind !== 'link') || (position !== 'top' && position !== 'bottom') || !ids?.length) {
    return reply.code(400).send({ error: 'Invalid request' })
  }
  await listOps[area].moveToEdge(kind, ids, position)
  return { ok: true }
})

app.post<{ Body: { linkIds?: unknown; packageIds?: unknown } }>('/api/downloads/start', async (request, reply) => {
  const linkIds = idList(request.body?.linkIds ?? [])
  const packageIds = idList(request.body?.packageIds ?? [])
  if (!linkIds || !packageIds || linkIds.length + packageIds.length === 0) return reply.code(400).send({ error: 'Invalid request' })
  await listOps.downloads.startDownload(linkIds, packageIds)
  return { ok: true }
})

app.post<{ Body: { destPackageId?: unknown; packageIds?: unknown } }>('/api/downloads/merge', async (request, reply) => {
  const { destPackageId } = request.body ?? {}
  const packageIds = idList(request.body?.packageIds)
  if (!Number.isSafeInteger(destPackageId) || !packageIds?.length) return reply.code(400).send({ error: 'Invalid body' })
  await listOps.downloads.mergeInto(destPackageId as number, packageIds)
  return { ok: true }
})

app.post<{ Params: { area: string }; Body: { packageIds?: unknown } }>('/api/:area/split-by-host', async (request, reply) => {
  const { area } = request.params
  const packageIds = idList(request.body?.packageIds)
  if ((area !== 'downloads' && area !== 'linkgrabber') || !packageIds?.length) return reply.code(400).send({ error: 'Invalid request' })
  await listOps[area].splitByHoster(packageIds)
  return { ok: true }
})

// The JDownloader this app is bound to: whether it answers right now (the device list's own status
// field is always UNKNOWN) and the download totals, like the web UI's status bar. Used by the browser
// extension's popup, which shows one card per device (only one device so far).
app.get('/api/device', async () => {
  const reachable = await client
    .callDevice(device.id, '/downloadcontroller/getCurrentState', [])
    .then(() => true)
    .catch(() => false)
  const snapshot = poller.getSnapshot()
  const packages = snapshot?.packages ?? []
  const bytesTotal = packages.reduce((sum, p) => sum + p.bytesTotal, 0)
  const bytesLoaded = packages.reduce((sum, p) => sum + p.bytesLoaded, 0)
  const speed = snapshot?.totalSpeed ?? 0
  return {
    name: device.name,
    type: device.type,
    status: reachable ? 'ONLINE' : 'OFFLINE',
    queue: { packages: packages.length, links: snapshot?.linkCount ?? 0, running: snapshot?.runningDownloads ?? 0 },
    downloads: {
      running: snapshot?.runningDownloads ?? 0,
      speed,
      bytesLoaded,
      bytesTotal,
      eta: speed > 0 ? (bytesTotal - bytesLoaded) / speed : null
    }
  }
})

app.get('/api/captcha', async () => [...(await captchas.list()), ...solverTasks.jobs()])

app.get<{ Params: { id: string } }>('/api/captcha/:id', async (request, reply) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id)) return reply.code(400).send({ error: 'Invalid id' })
  const task = solverTasks.get(id)
  if (task) return solverTasks.details(task)
  const details = await captchas.details(id)
  request.log.info({ captcha: details }, 'captcha job details')
  return details ?? reply.code(404).send({ error: 'Captcha is no longer open' })
})

app.get<{ Params: { id: string } }>('/api/captcha/:id/image', async (request, reply) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id)) return reply.code(400).send({ error: 'Invalid id' })
  const image = await captchas.image(id)
  if (!image) return reply.code(404).send({ error: 'No picture for this captcha' })
  return reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').type(image.type).send(image.data)
})

// Token captchas (token) or image captchas (text).
app.post<{ Params: { id: string }; Body: { token?: unknown; text?: unknown } }>('/api/captcha/:id/solve', async (request, reply) => {
  const id = Number(request.params.id)
  const { token, text } = request.body ?? {}
  if (!Number.isSafeInteger(id)) return reply.code(400).send({ error: 'Invalid request' })
  if (typeof text === 'string' && text.trim() && text.length <= 200) {
    await captchas.solveText(id, text.trim())
    return { ok: true }
  }
  if (typeof token !== 'string' || !token || token.length > 10_000) return reply.code(400).send({ error: 'Invalid request' })
  if (solverTasks.has(id)) solverTasks.solve(id, token)
  else await captchas.solve(id, token)
  return { ok: true }
})

app.post<{ Params: { id: string }; Body: { type?: unknown } }>('/api/captcha/:id/skip', async (request, reply) => {
  const id = Number(request.params.id)
  const type = request.body?.type
  if (!Number.isSafeInteger(id) || !SKIP_TYPES.includes(type as SkipType)) return reply.code(400).send({ error: 'Invalid request' })
  await captchas.skip(id, type as SkipType)
  return { ok: true }
})

// Anti-Captcha compatible endpoints for JDownloader (registered via JD_SOLVER_URL). JD sends captchas it
// cannot show itself (Cloudflare Turnstile) here; they appear in the captcha list and the browser
// extension solves them on the hoster's page.
type AntiCaptchaBody = { clientKey?: unknown; task?: Record<string, unknown>; taskId?: unknown }
const antiCaptchaOk = (body: AntiCaptchaBody | undefined) => typeof body?.clientKey === 'string' && body.clientKey === solver.apiKey
const antiCaptchaDenied = { errorId: 1, errorCode: 'ERROR_KEY_DOES_NOT_EXIST', errorDescription: 'Invalid key' }
app.post<{ Body: AntiCaptchaBody }>('/getBalance', async (request, reply) => {
  if (!antiCaptchaOk(request.body)) return reply.code(401).send(antiCaptchaDenied)
  return { errorId: 0, balance: 1 }
})
app.post<{ Body: AntiCaptchaBody }>('/createTask', async (request, reply) => {
  if (!antiCaptchaOk(request.body)) return reply.code(401).send(antiCaptchaDenied)
  const task = request.body?.task ?? {}
  request.log.info({ task }, 'anti-captcha createTask')
  let url: URL | undefined
  try {
    url = new URL(String(task.websiteURL))
  } catch {
    /* handled below */
  }
  if (!SolverTasks.supports(task.type) || !url || !/^https?:$/.test(url.protocol) || typeof task.websiteKey !== 'string' || !task.websiteKey) {
    return { errorId: 1, errorCode: 'ERROR_NO_SLOT_AVAILABLE', errorDescription: 'Task type not supported' }
  }
  return { errorId: 0, taskId: solverTasks.create(String(task.type), url.toString(), task.websiteKey).id }
})
app.post<{ Body: AntiCaptchaBody }>('/getTaskResult', async (request, reply) => {
  if (!antiCaptchaOk(request.body)) return reply.code(401).send(antiCaptchaDenied)
  const task = solverTasks.get(Number(request.body?.taskId))
  if (!task) return { errorId: 1, errorCode: 'ERROR_NO_SUCH_CAPCHA_ID', errorDescription: 'Unknown or expired task' }
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

app.post<{ Body: { packageIds?: unknown; afterPackageId?: unknown } }>('/api/packages/move', async (request, reply) => {
  const { packageIds, afterPackageId } = request.body ?? {}
  if (!isIdList(packageIds) || !Number.isSafeInteger(afterPackageId)) return reply.code(400).send({ error: 'Invalid body' })
  await poller.movePackages(packageIds, afterPackageId as number)
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
    await poller.moveLinks(packageId, linkIds, afterLinkId as number)
    return { ok: true }
  }
)

// Server-sent events: pushes a new snapshot whenever the poller has fresh data.
app.get('/api/events', (request, reply) => {
  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  const send = (snapshot: unknown) => reply.raw.write(`event: downloads\ndata: ${JSON.stringify(snapshot)}\n\n`)
  const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25000)
  const unsubscribe = poller.subscribe(send)
  send(poller.getSnapshot())
  request.raw.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
})

// Serve the built frontend if present (production / Docker)
const publicDir = fileURLToPath(new URL('../public', import.meta.url))
if (existsSync(publicDir)) {
  await app.register(fastifyStatic, { root: publicDir })
}

await app.listen({ port, host: '0.0.0.0' })
