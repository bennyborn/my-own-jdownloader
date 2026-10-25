// Puts the Anti-Captcha settings of the JDownloader back to what they were before we registered.
import { MyJdClient } from './myjd/client.js'
import { SolverRegistration } from './solver.js'

const { MYJD_EMAIL, MYJD_PASSWORD, MYJD_DEVICE } = process.env
if (!MYJD_EMAIL || !MYJD_PASSWORD) throw new Error('MYJD_EMAIL and MYJD_PASSWORD must be set')
const client = new MyJdClient(MYJD_EMAIL, MYJD_PASSWORD)
await client.connect()
const devices = await client.listDevices()
const device = devices.find((d) => d.name === MYJD_DEVICE) ?? devices[0]
console.log(await new SolverRegistration(client, device.id).restore())
