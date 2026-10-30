import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { frameImage } from './frame.mjs'

// The popup of the browser extension with a stand-in for the chrome API and two made-up devices.
const MB = 1024 * 1024
const GB = 1024 * MB
const ORIGIN = 'https://ext.test'
const devices = [
  { id: 'nas', name: 'nas', default: true },
  { id: 'office', name: 'office-pc' }
]
const details = {
  nas: { id: 'nas', name: 'nas', status: 'ONLINE', downloads: { speed: 59 * MB, running: 4, eta: 222, bytesLoaded: 12.2 * GB, bytesTotal: 25.1 * GB }, queue: { packages: 6, running: 4, links: 16 } },
  office: { id: 'office', name: 'office-pc', status: 'ONLINE', downloads: { speed: 0, running: 0, eta: null, bytesLoaded: 0, bytesTotal: 0 }, queue: { packages: 2, running: 0, links: 5 } }
}
const speedAt = (age) => (46 + 9 * Math.sin((300 - age) / 23) + 5 * Math.sin((300 - age) / 7.3) + 3 * Math.sin((300 - age) / 3.1)) * Math.min(1, (300 - age) / 30) * MB
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css', '.json': 'application/json' }
const stub = `window.chrome = {
  runtime: { getURL: (p) => '${ORIGIN}/' + p, openOptionsPage() {}, sendMessage: async () => ({}) },
  storage: { local: { get: async () => ({ backendUrl: '${ORIGIN}', password: 'x' }) } },
  tabs: { create() {} }
}`

const browser = await chromium.launch()
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 364, height: 400 }, deviceScaleFactor: 2, colorScheme: scheme, locale: 'en-US' })
  await context.addInitScript(stub)
  const page = await context.newPage()
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/api/devices') return json(devices)
    if (path === '/api/device') return json(details[new URL(route.request().url()).searchParams.get('device')])
    if (path === '/api/captcha') return json([])
    if (path === '/api/speed-history') {
      const now = Date.now()
      const device = new URL(route.request().url()).searchParams.get('device')
      const samples = []
      if (device === 'nas') for (let age = 300; age >= 0; age -= 3) samples.push({ t: now - age * 1000, v: speedAt(age) })
      return json({ now, samples })
    }
    const file = path === '/' ? '/popup.html' : path
    try {
      return route.fulfill({ contentType: mime[extname(file)] ?? 'application/octet-stream', body: readFileSync(`/shots/ext${file}`) })
    } catch {
      return route.fulfill({ status: 404, body: '' })
    }
  })
  await page.goto(`${ORIGIN}/popup.html`)
  await page.waitForTimeout(2000)
  const height = await page.evaluate(() => document.body.getBoundingClientRect().height + 24)
  await page.setViewportSize({ width: 364, height: Math.ceil(height) })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `/shots/work/site-popup-${scheme}.png` })
  await frameImage(browser, `/shots/work/site-popup-${scheme}.png`, scheme === 'light' ? '#d0d7de' : undefined)
  await context.close()
}
await browser.close()
