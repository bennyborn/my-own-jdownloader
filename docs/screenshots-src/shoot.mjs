import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { frameImage } from './frame.mjs'

const base = 'http://host.docker.internal:20031'
const auth = 'Basic ' + Buffer.from('x:' + process.env.UI_PASSWORD).toString('base64')
const MB = 1024 * 1024
const GB = 1024 * MB
const DEV = 'demo'
const MOVIE = '2001: A Space Odyssey (1968) [tmdbid=62]'
// A new id per run: the app keeps plugin answers for a day and deletes posters of packages it does not know, so an old answer can point to a poster that is gone.
const MOVIE_UUID = 100000 + Math.floor(Math.random() * 900000)
const VIDEO_ID = '9bZkp7q19f0'
const VIDEO_TITLE = 'PSY - GANGNAM STYLE(강남스타일) M/V'

// ---- the fake state ---------------------------------------------------------------------------------------------
const pkg = (o) => ({ enabled: true, running: false, finished: false, speed: 0, bytesLoaded: 0, saveTo: '/downloads', hosts: [], activeHosts: [], ...o })
const link = (o) => ({ enabled: true, running: false, finished: false, skipped: false, speed: 0, bytesLoaded: 0, ...o })

const movieLinks = [
  link({ uuid: 101, name: '2001.A.Space.Odyssey.1968.1080p.BluRay.x264.part1.rar', host: 'rapidgator.net', finished: true, bytesTotal: 2.1 * GB, bytesLoaded: 2.1 * GB, status: 'Finished' }),
  link({ uuid: 102, name: '2001.A.Space.Odyssey.1968.1080p.BluRay.x264.part2.rar', host: 'ddownload.com', finished: true, bytesTotal: 2.1 * GB, bytesLoaded: 2.1 * GB, status: 'Finished' }),
  link({ uuid: 103, name: '2001.A.Space.Odyssey.1968.1080p.BluRay.x264.part3.rar', host: 'nitroflare.com', running: true, speed: 19.4 * MB, bytesTotal: 2.1 * GB, bytesLoaded: 1.32 * GB, eta: 41, status: 'Download' }),
  link({ uuid: 104, name: '2001.A.Space.Odyssey.1968.1080p.BluRay.x264.part4.rar', host: '1fichier.com', running: true, speed: 12.1 * MB, bytesTotal: 2.1 * GB, bytesLoaded: 0.58 * GB, eta: 128, status: 'Download' }),
  link({ uuid: 105, name: '2001.A.Space.Odyssey.1968.1080p.BluRay.x264.part5.rar', host: 'rapidgator.net', bytesTotal: 0.4 * GB, status: 'Waiting' })
]
const packages = [
  pkg({ uuid: MOVIE_UUID, name: MOVIE, saveTo: '/downloads/Movies', running: true, speed: 31.5 * MB, bytesTotal: 8.8 * GB, bytesLoaded: 6.1 * GB, eta: 90, childCount: 5, hosts: ['rapidgator.net', 'ddownload.com', 'nitroflare.com', '1fichier.com'], activeHosts: ['nitroflare.com', '1fichier.com'] }),
  pkg({ uuid: 2, name: VIDEO_TITLE, saveTo: '/downloads/YouTube', running: true, speed: 14.2 * MB, bytesTotal: 0.46 * GB, bytesLoaded: 0.24 * GB, eta: 16, childCount: 1, hosts: ['youtube.com'], activeHosts: ['youtube.com'] }),
  pkg({ uuid: 3, name: 'ubuntu-24.04.1-desktop-amd64', saveTo: '/downloads/ISOs', running: true, speed: 13.3 * MB, bytesTotal: 6.2 * GB, bytesLoaded: 1.4 * GB, eta: 370, childCount: 1, hosts: ['mega.nz'], activeHosts: ['mega.nz'] }),
  pkg({ uuid: 4, name: 'Sintel.2010.2160p.WEB-DL.x265', saveTo: '/downloads/Movies', finished: true, extraction: 'running', status: 'Extracting', bytesTotal: 3.4 * GB, bytesLoaded: 3.4 * GB, childCount: 4, hosts: ['ddownload.com'] }),
  pkg({ uuid: 5, name: 'Tears.of.Steel.2012.1080p.BluRay', saveTo: '/downloads/Movies', bytesTotal: 5.1 * GB, childCount: 3, hosts: ['ddownload.com', 'nitroflare.com'] }),
  pkg({ uuid: 6, name: 'Big.Buck.Bunny.2008.1080p', saveTo: '/downloads/Movies', finished: true, extraction: 'done', bytesTotal: 1.1 * GB, bytesLoaded: 1.1 * GB, childCount: 2, hosts: ['rapidgator.net'] })
]
const linksOf = { [MOVIE_UUID]: movieLinks }

// A speed curve that looks lived in: a ramp up, a hoster that slows down for a while, some noise.
const speedAt = (age) => {
  const t = 300 - age
  const base = 46 + 9 * Math.sin(t / 23) + 5 * Math.sin(t / 7.3) + 3 * Math.sin(t / 3.1)
  const ramp = Math.min(1, t / 30)
  const dip = 1 - 0.38 * Math.exp(-(((t - 150) / 22) ** 2))
  return Math.max(0, base * ramp * dip) * MB
}
const grabberPackages = [
  { uuid: 9001, name: 'Blender Foundation - Open Movies', enabled: true, bytesTotal: 9.6 * GB, childCount: 3, hosts: ['rapidgator.net', 'ddownload.com'], saveTo: '/downloads/Movies', links: [
    { uuid: 9101, packageUUID: 9001, name: 'Sintel.2010.1080p.BluRay.x264.mkv', host: 'rapidgator.net', enabled: true, bytesTotal: 4.2 * GB, availability: 'ONLINE' },
    { uuid: 9102, packageUUID: 9001, name: 'Tears.of.Steel.2012.1080p.BluRay.x264.mkv', host: 'ddownload.com', enabled: true, bytesTotal: 3.9 * GB, availability: 'ONLINE' },
    { uuid: 9103, packageUUID: 9001, name: 'Big.Buck.Bunny.2008.1080p.BluRay.x264.mkv', host: 'rapidgator.net', enabled: true, bytesTotal: 1.5 * GB, availability: 'ONLINE' }
  ] },
  { uuid: 9002, name: 'debian-12.7.0-amd64-DVD-1', enabled: true, bytesTotal: 3.9 * GB, childCount: 1, hosts: ['mega.nz'], saveTo: '/downloads/ISOs', links: [
    { uuid: 9201, packageUUID: 9002, name: 'debian-12.7.0-amd64-DVD-1.iso', host: 'mega.nz', enabled: true, bytesTotal: 3.9 * GB, availability: 'ONLINE' }
  ] },
  { uuid: 9003, name: 'Kosmos.Documentary.S01', enabled: true, bytesTotal: 7.3 * GB, childCount: 3, hosts: ['nitroflare.com', '1fichier.com'], saveTo: '/downloads/Series', links: [
    { uuid: 9301, packageUUID: 9003, name: 'Kosmos.S01E01.1080p.WEB-DL.mkv', host: 'nitroflare.com', enabled: true, bytesTotal: 2.5 * GB, availability: 'ONLINE' },
    { uuid: 9302, packageUUID: 9003, name: 'Kosmos.S01E02.1080p.WEB-DL.mkv', host: 'nitroflare.com', enabled: true, bytesTotal: 2.4 * GB, availability: 'ONLINE' },
    { uuid: 9303, packageUUID: 9003, name: 'Kosmos.S01E03.1080p.WEB-DL.mkv', host: '1fichier.com', enabled: true, bytesTotal: 2.4 * GB, availability: 'OFFLINE' }
  ] }
]
const grabber = { device: DEV, collecting: false, packages: grabberPackages }

const total = packages.reduce((s, p) => s + p.speed, 0)

const snapshot = () => ({ device: DEV, updatedAt: Date.now(), packages, totalSpeed: total, linkCount: packages.reduce((n, p) => n + p.childCount, 0), runningDownloads: 4, state: 'running' })
const devicesList = [{ id: DEV, name: 'nas', type: 'jd', online: true, default: true }]

// EventSource stand-in: delivers what the real stream would, and keeps the page "connected".
const fakeStream = `(() => {
  const state = { snapshot: ${JSON.stringify(snapshot())}, devices: ${JSON.stringify(devicesList)} }
  window.__fake = state
  class FakeES extends EventTarget {
    constructor(url) {
      super()
      this.url = url
      setTimeout(() => {
        this.onopen && this.onopen({})
        const send = (name, data) => this.dispatchEvent(Object.assign(new Event(name), { data: JSON.stringify(data) }))
        send('captcha', [])
        send('dialogs', [])
        send('devices', state.devices)
        send('downloads', { ...state.snapshot, updatedAt: Date.now() })
        send('grabber', ${JSON.stringify(grabber)})
      }, 50)
    }
    close() {}
  }
  window.EventSource = FakeES
})()`

// ---- the browser ---------------------------------------------------------------------------------------------
const thumbnail = Buffer.from(await (await fetch(`https://i.ytimg.com/vi/${VIDEO_ID}/mqdefault.jpg`)).arrayBuffer())
const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })

const browser = await chromium.launch()
const shoot = async (name, { viewport, mobile, scheme = 'dark', expand = true, scale = 2, tab = 'downloads' }) => {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: scheme,
    locale: process.env.LOCALE ?? 'de-DE',
    ...(process.env.UI_PASSWORD ? { httpCredentials: { username: 'x', password: process.env.UI_PASSWORD } } : {})
  })
  await context.addInitScript(fakeStream)
  const page = await context.newPage()
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/devices') return json(route, devicesList)
    if (path === '/api/downloads') return json(route, snapshot())
    if (path === '/api/captcha' || path === '/api/dialogs') return json(route, [])
    if (path === '/api/update') return json(route, { available: false })
    if (path === '/api/jd-settings') return json(route, { pauseSpeed: 0, speedLimit: 0 })
    if (path === '/api/linkgrabber') return json(route, { collecting: false, packages: grabberPackages })
    if (path === '/api/speed-history') {
      const now = Date.now()
      const samples = []
      for (let age = 300; age >= 0; age -= 3) samples.push({ t: now - age * 1000, v: speedAt(age) })
      return json(route, { now, samples })
    }
    const links = /^\/api\/packages\/(\d+)\/links$/.exec(path)
    if (links) return json(route, linksOf[links[1]] ?? [])
    if (path === '/api/plugins/youtube-thumbnail/package') {
      if (url.searchParams.get('name') !== VIDEO_TITLE) return json(route, {})
      return json(route, { thumbnail: '/api/plugins/youtube-thumbnail/image/demo', title: VIDEO_TITLE, author: 'officialpsy', url: `https://www.youtube.com/watch?v=${VIDEO_ID}` })
    }
    if (path === '/api/plugins/youtube-thumbnail/image/demo') return route.fulfill({ contentType: 'image/jpeg', body: thumbnail })
    // The poster comes from the real TMDB plugin of the app; it only needs the name (no device call is made for it).
    if (path === '/api/plugins/tmdb-poster/package') {
      url.searchParams.delete('device')
      return route.continue({ url: url.toString() })
    }
    return route.continue()
  })
  await page.goto(`${base}/#${tab}?device=${DEV}`)
  await page.waitForTimeout(2500)
  if (expand) {
    await page.getByText('2001.A.Space', { exact: false }).first().waitFor({ timeout: 1000 }).catch(() => undefined)
  }
  return { page, context, name }
}

const expandMovie = async (page) => {
  await page.locator('.card, article, .package').filter({ hasText: '2001: Odyssee' }).first().locator('button, [role=button]').first().click().catch(() => undefined)
}
const siteShots = []
for (const scheme of ['light', 'dark']) {
  const desktop = { viewport: { width: 1280, height: 800 }, mobile: false, scale: 2, scheme }
  siteShots.push([`site-downloads-${scheme}`, desktop], [`site-linkgrabber-${scheme}`, { ...desktop, tab: 'linkgrabber', expand: false }], [`site-settings-${process.env.SECTION ?? 'plugins'}-${scheme}`, { ...desktop, tab: `settings/${process.env.SECTION ?? 'plugins'}`, expand: false }])
}
const shots = process.env.SITE
  ? siteShots
  : [
      ['desktop', { viewport: { width: 960, height: 1040 }, mobile: false, scale: 2 }],
      ['mobile', { viewport: { width: 390, height: 844 }, mobile: true, scale: 3, expand: false }]
    ]
for (const [name, options] of shots) {
  const { page, context } = await shoot(name, options)
  if (options.expand !== false) await page.getByText('2001: A Space Odyssey').first().locator('xpath=ancestor::*[contains(@class,"card") or self::article][1]').locator('button').first().click().catch((e) => console.log('expand failed', e.message))
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `/shots/work/${name}.png` })
  await frameImage(browser, `/shots/work/${name}.png`, options.scheme === 'light' ? '#d0d7de' : undefined)
  await context.close()
}
await browser.close()
