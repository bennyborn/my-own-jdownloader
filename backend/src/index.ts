import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { createAuthHook } from './auth.js'
import { DownloadsPoller } from './downloads.js'
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

app.get('/api/health', async () => ({ status: 'ok' }))
app.get('/api/devices', async () => devices.map(({ id, name, type }) => ({ id, name, type })))
app.get('/api/downloads', async () => poller.refresh())

app.get<{ Params: { uuid: string } }>('/api/packages/:uuid/links', async (request, reply) => {
  const uuid = Number(request.params.uuid)
  if (!Number.isSafeInteger(uuid)) return reply.code(400).send({ error: 'Invalid package uuid' })
  return poller.getLinks(uuid)
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
