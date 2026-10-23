// Read-only smoke test: login and list devices. Credentials come from the environment only.
import { MyJdClient } from './myjd/client.js'

const { MYJD_EMAIL, MYJD_PASSWORD } = process.env
if (!MYJD_EMAIL || !MYJD_PASSWORD) throw new Error('MYJD_EMAIL and MYJD_PASSWORD must be set')

const client = new MyJdClient(MYJD_EMAIL, MYJD_PASSWORD)
await client.connect()
const devices = await client.listDevices()
console.log(`Login ok, ${devices.length} device(s):`)
for (const d of devices) console.log(`- ${d.name} (${d.type}, ${d.status ?? 'n/a'})`)

// Read-only: query download packages and print aggregate numbers only.
const device = devices[0]
const packages = await client.callDevice<{ speed?: number; childCount?: number; finished?: boolean }[]>(
  device.id,
  '/downloadsV2/queryPackages',
  [{ maxResults: -1, startAt: 0, speed: true, childCount: true, finished: true }]
)
const links = packages.reduce((sum, p) => sum + (p.childCount ?? 0), 0)
const speed = packages.reduce((sum, p) => sum + (p.speed ?? 0), 0)
console.log(`Download list: ${packages.length} package(s), ${links} link(s), ${speed} B/s`)
