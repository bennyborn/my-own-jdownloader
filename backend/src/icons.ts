import { lookup } from 'node:dns/promises'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'
import * as simpleIcons from 'simple-icons'

export interface Icon {
  type: string
  data: Buffer
}

const EXTENSIONS: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}
const TYPE_BY_EXTENSION = Object.fromEntries(Object.entries(EXTENSIONS).reverse().map(([type, ext]) => [ext, type]))

const MAX_BYTES = 300 * 1024
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const brandIcons = new Map<string, { svg: string; hex: string }>()
for (const value of Object.values(simpleIcons)) {
  const icon = value as { slug?: string; title?: string; svg?: string; hex?: string }
  if (icon && typeof icon === 'object' && icon.slug && icon.svg && icon.hex) {
    brandIcons.set(normalize(icon.slug), { svg: icon.svg, hex: icon.hex })
    brandIcons.set(normalize(icon.title ?? icon.slug), { svg: icon.svg, hex: icon.hex })
  }
}

// "drive.google.com" -> ["google", "drivegoogle"]; "mega.nz" -> ["mega"]
const brandCandidates = (host: string): string[] => {
  const labels = host.replace(/^www\./, '').split('.')
  const name = labels.length >= 2 ? labels[labels.length - 2] : labels[0]
  const candidates = [normalize(name)]
  if (labels.length > 2) candidates.unshift(normalize(labels[labels.length - 3] + name), normalize(name + labels[labels.length - 3]))
  return candidates
}

const luminance = (hex: string) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const brandIcon = (host: string): Icon | null => {
  for (const candidate of brandCandidates(host)) {
    const icon = brandIcons.get(candidate)
    if (!icon) continue
    // Very dark brand colors would vanish on a dark background.
    const color = luminance(icon.hex) < 0.12 ? '9aa4b2' : icon.hex
    return { type: 'image/svg+xml', data: Buffer.from(icon.svg.replace('<svg ', `<svg fill="#${color}" `)) }
  }
  return null
}

// Last resort: a colored tile with the first letter of the host name.
const letterIcon = (host: string): Icon => {
  const name = host.replace(/^www\./, '')
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const letter = (name[0] ?? '?').toUpperCase().replace(/[<>&"']/g, '?')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="hsl(${hash % 360} 45% 42%)"/>` +
    `<text x="12" y="17" font-family="system-ui,sans-serif" font-size="14" font-weight="600" text-anchor="middle" fill="#fff">${letter}</text></svg>`
  return { type: 'image/svg+xml', data: Buffer.from(svg) }
}

const isPrivateAddress = (address: string): boolean => {
  if (address.includes(':')) return /^(::1?$|f[cd]|fe80)/i.test(address) || address.startsWith('::ffff:')
  const [a, b] = address.split('.').map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

// Fetches icons from the host's own website (done by the server, not the browser).
const safeFetch = async (url: string, accept: string): Promise<Response | null> => {
  const { hostname, protocol } = new URL(url)
  if (protocol !== 'https:' && protocol !== 'http:') return null
  if (isIP(hostname) || !hostname.includes('.')) return null
  const addresses = await lookup(hostname, { all: true })
  if (addresses.some((a) => isPrivateAddress(a.address))) return null
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; my-own-jdownloader icon fetch)', Accept: accept },
    signal: AbortSignal.timeout(6000),
    redirect: 'follow'
  })
  return res.ok ? res : null
}

const readLimited = async (res: Response, limit: number): Promise<Buffer | null> => {
  const data = Buffer.from(await res.arrayBuffer())
  return data.length > 0 && data.length <= limit ? data : null
}

const parseIconLinks = (html: string, base: string): string[] => {
  const links: { href: string; score: number }[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel\s*=\s*["'][^"']*icon[^"']*["']/i.test(tag)) continue
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    const isSvg = /type\s*=\s*["']image\/svg\+xml["']/i.test(tag) || /\.svg(\?|$)/i.test(href)
    try {
      links.push({ href: new URL(href, base).toString(), score: isSvg ? 2 : /apple-touch/i.test(tag) ? 0 : 1 })
    } catch {
      /* ignore invalid urls */
    }
  }
  return links.sort((a, b) => b.score - a.score).map((l) => l.href)
}

const sniffType = (data: Buffer, declared: string): string | null => {
  const head = data.subarray(0, 512).toString('latin1').trimStart()
  if (/^(<\?xml|<svg)/i.test(head) && /<svg/i.test(head)) return 'image/svg+xml'
  if (data.subarray(0, 4).toString('hex') === '89504e47') return 'image/png'
  if (data.subarray(0, 4).toString('hex') === '00000100') return 'image/x-icon'
  if (data.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif'
  if (data.subarray(0, 2).toString('hex') === 'ffd8') return 'image/jpeg'
  if (data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return declared in EXTENSIONS ? declared : null
}

// ICO files often hold several sizes and the larger ones can carry a lot of transparent padding,
// which looks like empty space when the browser scales them down. Keep only the 16px frame
// (or the smallest one above that) as a single-image ICO.
const singleFrameIco = (data: Buffer): Buffer => {
  try {
    const count = data.readUInt16LE(4)
    if (data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1 || count < 2) return data
    const frames = Array.from({ length: count }, (_, i) => {
      const entry = data.subarray(6 + i * 16, 22 + i * 16)
      return { entry, width: entry[0] || 256, size: entry.readUInt32LE(8), offset: entry.readUInt32LE(12) }
    })
    const best = frames.filter((f) => f.width >= 16).sort((a, b) => a.width - b.width)[0] ?? frames[0]
    const image = data.subarray(best.offset, best.offset + best.size)
    if (image.length !== best.size) return data
    const header = Buffer.from([0, 0, 1, 0, 1, 0])
    const entry = Buffer.from(best.entry)
    entry.writeUInt32LE(22, 12)
    return Buffer.concat([header, entry, image])
  } catch {
    return data
  }
}

const normalizeIcon = (icon: Icon): Icon => (icon.type === 'image/x-icon' ? { ...icon, data: singleFrameIco(icon.data) } : icon)

const fetchFavicon = async (host: string): Promise<Icon | null> => {
  const origin = `https://${host}/`
  const candidates: string[] = []
  try {
    const page = await safeFetch(origin, 'text/html')
    if (page) candidates.push(...parseIconLinks((await readLimited(page, 1024 * 1024)) ?.toString('utf8') ?? '', page.url))
  } catch {
    /* fall through to /favicon.ico */
  }
  candidates.push(`${origin}favicon.ico`)
  for (const url of candidates.slice(0, 4)) {
    try {
      const res = await safeFetch(url, 'image/svg+xml,image/png,image/*')
      const data = res && (await readLimited(res, MAX_BYTES))
      const type = data && res ? sniffType(data, (res.headers.get('content-type') ?? '').split(';')[0].trim()) : null
      if (data && type) return { type, data }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

export class HostIcons {
  private memory = new Map<string, { icon: Icon; until: number }>()
  private pending = new Map<string, Promise<Icon>>()

  constructor(private readonly cacheDir: string) {}

  get(host: string): Promise<Icon> {
    const cached = this.memory.get(host)
    if (cached && cached.until > Date.now()) return Promise.resolve(cached.icon)
    let job = this.pending.get(host)
    if (!job) {
      job = this.resolve(host).finally(() => this.pending.delete(host))
      this.pending.set(host, job)
    }
    return job
  }

  private async resolve(host: string): Promise<Icon> {
    const day = 24 * 3600 * 1000
    const brand = brandIcon(host)
    if (brand) return this.remember(host, brand, 7 * day)

    const onDisk = await this.readDisk(host)
    if (onDisk) return this.remember(host, normalizeIcon(onDisk), day)

    const fetched = await fetchFavicon(host).catch(() => null)
    if (fetched) {
      await this.writeDisk(host, fetched)
      return this.remember(host, normalizeIcon(fetched), day)
    }
    return this.remember(host, letterIcon(host), 6 * 3600 * 1000)
  }

  private remember(host: string, icon: Icon, ttl: number): Icon {
    this.memory.set(host, { icon, until: Date.now() + ttl })
    return icon
  }

  private async readDisk(host: string): Promise<Icon | null> {
    try {
      const file = (await readdir(this.cacheDir)).find((f) => f.startsWith(`${host}.`))
      if (!file) return null
      return { type: TYPE_BY_EXTENSION[file.split('.').pop() ?? ''] ?? 'image/png', data: await readFile(join(this.cacheDir, file)) }
    } catch {
      return null
    }
  }

  private async writeDisk(host: string, icon: Icon): Promise<void> {
    try {
      await mkdir(this.cacheDir, { recursive: true })
      await writeFile(join(this.cacheDir, `${host}.${EXTENSIONS[icon.type] ?? 'png'}`), icon.data)
    } catch {
      /* the cache is optional */
    }
  }
}
