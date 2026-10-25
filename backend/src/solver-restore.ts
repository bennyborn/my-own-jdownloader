// Puts the Anti-Captcha settings of JDownloader devices back to what they were before we registered.
// Usage: solver-restore.ts [device name ...]   (default: the device named in MYJD_DEVICE, else the first one)
import { DeviceRegistry, legacySolverFile } from './devices.js'
import { MyJdClient } from './myjd/client.js'

const { MYJD_EMAIL, MYJD_PASSWORD, MYJD_DEVICE } = process.env
if (!MYJD_EMAIL || !MYJD_PASSWORD) throw new Error('MYJD_EMAIL and MYJD_PASSWORD must be set')
const client = new MyJdClient(MYJD_EMAIL, MYJD_PASSWORD)
await client.connect()
const registry = new DeviceRegistry(client, { defaultName: MYJD_DEVICE, legacySolverFile: legacySolverFile() })
await registry.refresh()
const names = process.argv.slice(2)
const targets = names.length ? registry.all().filter((c) => names.includes(c.device.name)) : [registry.resolve()]
for (const c of targets) console.log(`${c.device.name}: ${await c.solver.restore()}`)
registry.stop()
