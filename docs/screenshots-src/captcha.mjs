import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const source = readFileSync('/shots/ext/background.js', 'utf8')
const start = source.indexOf('const renderInPage = ')
const end = source.indexOf("// Click'n'Load: the page's links", start)
const fn = source.slice(start + 'const renderInPage = '.length, end).trim()
const logo = readFileSync('/shots/ext/logo-outline.svg', 'utf8')

const job = { id: 1, hoster: 'rapidgator.net', challengeType: 'TurnstileChallenge', siteKey: '1x00000000000000000000AA', remaining: 4 * 60_000 + 37_000 }
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark' })
const page = await context.newPage()
await page.route('https://rapidgator.net/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' }))

// A stand-in for the Turnstile widget (the real one shows a test banner with the test key). It only draws the unsolved state.
const widgetStub = `
window.turnstile = { render(el) {
  const box = document.createElement('div')
  box.style.cssText = 'box-sizing:border-box;display:flex;align-items:center;gap:14px;width:300px;height:65px;padding:0 14px;background:#232323;border:1px solid #797979;color:#fff;font:14px system-ui,sans-serif;text-align:left'
  const check = document.createElement('div')
  check.style.cssText = 'flex:none;width:24px;height:24px;box-sizing:border-box;background:#fff;border:2px solid #c6c6c6;border-radius:3px'
  const label = document.createElement('div')
  label.style.cssText = 'flex:1;font-size:15px'
  label.textContent = 'Verify you are human'
  const brand = document.createElement('div')
  brand.style.cssText = 'font-size:9px;line-height:1.5;color:#ccc;text-align:right'
  brand.innerHTML = '<b style="font-size:11px;letter-spacing:.06em">CLOUDFLARE</b><br>Privacy \u00b7 Help'
  box.append(check, label, brand)
  el.append(box)
} }
window.__myjdLoaded && window.__myjdLoaded()
`
await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: widgetStub }))
await page.goto('https://rapidgator.net/')
await page.evaluate(`(${fn})(${JSON.stringify(job)}, ${JSON.stringify(logo)})`)
const wait = Number(process.argv[2] ?? 1500)
await page.waitForTimeout(wait)
await page.screenshot({ path: `/shots/work/captcha.png` })
await browser.close()
