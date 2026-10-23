import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { createAuthHook } from './auth.js'
import { DownloadsPoller } from './downloads.js'
import { ConflictError, ListOps, type Area } from './listops.js'
import { HostIcons } from './icons.js'
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

app.get('/api/health', async () => ({ status: 'ok' }))
app.get('/api/devices', async () => devices.map(({ id, name, type }) => ({ id, name, type })))
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
  if (error instanceof ConflictError) return reply.code(409).send({ error: error.message })
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

const isIdList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every((v) => Number.isSafeInteger(v))

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
