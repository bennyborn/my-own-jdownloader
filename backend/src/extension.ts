import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'

export interface ExtensionFile {
  path: string
  size: number
  sha256: string
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (data: Buffer): number => {
  let c = 0xffffffff
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const listFiles = (root: string, dir = ''): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.name.startsWith('.') || path === 'README.md') return []
    return entry.isDirectory() ? listFiles(root, path) : [path]
  })

type Manifest = Record<string, unknown>

// What a package depends on besides the source: the public address of the backend and the id of the Firefox add-on.
export interface ExtensionContext {
  publicUrl: string
  firefoxId: string
  // Where Firefox asks for updates when it is not this backend (the release build, scripts/release-extension.mjs).
  updateUrl?: string
}

export interface ExtensionTarget {
  label: string
  // File extension of the package for the first installation.
  ext: 'zip' | 'xpi'
  // The manifest of this browser's package.
  manifest: (source: Manifest, context: ExtensionContext) => Manifest
  // Files only this package has.
  extra?: (context: ExtensionContext) => Record<string, string>
}

// One package per kind of browser, all made from the same `extension/` folder; they differ in the manifest only. A new browser is a new
// entry here (and a card in the web interface, BrowserExtensionSettings.vue).
export const EXTENSION_TARGETS: Record<string, ExtensionTarget> = {
  chromium: {
    label: 'Chrome, Edge, Brave and other Chromium browsers',
    ext: 'zip',
    // Chromium reports keys it does not know as warnings.
    manifest: ({ browser_specific_settings: _gecko, ...rest }) => rest
  },
  firefox: {
    label: 'Firefox',
    ext: 'xpi',
    // The address this backend is reached at over https: Firefox does not get on with plain http, so the extension starts with this one.
    extra: ({ publicUrl }) => ({ 'defaults.json': JSON.stringify({ backendUrl: publicUrl }) + '\n' }),
    // Firefox has no service worker for extensions (background scripts instead). It installs only what Mozilla signed (firefox.ts) and
    // updates an installed extension by itself from the `update_url`, which has to be https (the backend answers it).
    manifest: ({ background, browser_specific_settings, ...rest }, { publicUrl, firefoxId, updateUrl }) => {
      const { service_worker, ...more } = background as { service_worker: string }
      const gecko = (browser_specific_settings as { gecko: Manifest }).gecko
      return {
        ...rest,
        background: { ...more, scripts: [service_worker] },
        browser_specific_settings: {
          gecko: {
            ...gecko,
            id: firefoxId,
            // The extension sends what it handles to the backend of its owner only, nothing else.
            data_collection_permissions: { required: ['none'] },
            update_url: updateUrl ?? `${publicUrl}/api/extension/firefox/updates.json`
          }
        }
      }
    }
  }
}

// The browser extension as shipped in the image (the `extension/` folder): the web interface and the extension itself offer it for
// download and for updating. Read once at start; a new version comes with a new image.
export class ExtensionBundle {
  readonly version: string
  readonly files: ExtensionFile[]
  // Changes with every change of the package, whatever the time stamps in the ZIP say.
  readonly fingerprint: string
  private readonly contents = new Map<string, Buffer>()
  private readonly built = new Date() // in the ZIP, so the same package always has the same checksum
  private packed?: Buffer

  private constructor(root: string, target: string, context: ExtensionContext) {
    const source = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Manifest
    this.version = String(source.version)
    for (const path of listFiles(root).sort()) this.contents.set(path, readFileSync(join(root, path)))
    for (const [path, text] of Object.entries(EXTENSION_TARGETS[target].extra?.(context) ?? {})) this.contents.set(path, Buffer.from(text))
    this.contents.set('manifest.json', Buffer.from(JSON.stringify(EXTENSION_TARGETS[target].manifest(source, context), null, 2) + '\n'))
    this.files = [...this.contents].map(([path, data]) => ({ path, size: data.length, sha256: createHash('sha256').update(data).digest('hex') }))
    this.fingerprint = createHash('sha256').update(JSON.stringify(this.files)).digest('hex')
  }

  // Target id -> package; empty when the image has no extension folder. Firefox only with a public https address (see firefox.ts).
  static loadAll(root: string, context: ExtensionContext): Map<string, ExtensionBundle> {
    if (!existsSync(join(root, 'manifest.json')) || !statSync(root).isDirectory()) return new Map()
    const targets = Object.keys(EXTENSION_TARGETS).filter((target) => target !== 'firefox' || context.publicUrl)
    return new Map(targets.map((target) => [target, new ExtensionBundle(root, target, context)]))
  }

  read(path: string): Buffer | undefined {
    return this.contents.get(path)
  }

  pack(): Buffer {
    return (this.packed ??= this.zip(this.contents))
  }

  // A plain ZIP (deflate, no extras): Windows can unpack it with "Extract all".
  private zip(contents: Map<string, Buffer>): Buffer {
    const now = this.built
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
    const parts: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    for (const [path, data] of contents) {
      const name = Buffer.from(path)
      const packed = deflateRawSync(data)
      const crc = crc32(data)
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4) // version needed
      local.writeUInt16LE(0x0800, 6) // names are UTF-8
      local.writeUInt16LE(8, 8) // deflate
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(packed.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(name.length, 26)
      const entry = Buffer.alloc(46)
      entry.writeUInt32LE(0x02014b50, 0)
      entry.writeUInt16LE(20, 4) // made by
      local.copy(entry, 6, 4, 30) // version needed ... name length, the same fields as the local header
      entry.writeUInt32LE(offset, 42)
      central.push(entry, name)
      parts.push(local, name, packed)
      offset += 30 + name.length + packed.length
    }
    const centralSize = central.reduce((sum, b) => sum + b.length, 0)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(contents.size, 8)
    end.writeUInt16LE(contents.size, 10)
    end.writeUInt32LE(centralSize, 12)
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...parts, ...central, end])
  }
}
