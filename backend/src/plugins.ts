import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Plugins live in one folder: <dir>/<id>/plugin.json (manifest) and <dir>/<id>/index.js (ES module).
// They are trusted code that runs inside the server process: only put plugins there that you trust.

export type SettingValue = string | boolean

export interface SettingDef {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'boolean'
  description?: string
  required?: boolean
  default?: SettingValue
  options?: { value: string; label: string }[]
}

interface Manifest {
  id: string
  name: string
  description?: string
  version?: string
  // File in the plugin folder with the plugin's part of the web UI (an ES module, see DEVELOPER.md).
  ui?: string
  settings: SettingDef[]
}

// Whatever JSON a plugin returns for a package; only the plugin's own frontend part (ui.js) interprets it.
export type PackageData = Record<string, unknown>

const once = <T>(fn: () => Promise<T>): (() => Promise<T>) => {
  let job: Promise<T> | undefined
  return () => (job ??= fn())
}

export interface PackageContext {
  name: string
  // The source URLs of the package's links; looked up on the device only when called (and then remembered).
  urls: () => Promise<string[]>
  settings: Record<string, SettingValue>
  signal: AbortSignal
  // Fetches an https image on demand and returns a URL of this server for it (cached, removed together with the package).
  image: (url: string) => Promise<string>
}

interface PluginModule {
  packageData?: (context: PackageContext) => Promise<PackageData | null | undefined>
}

interface Loaded {
  manifest: Manifest
  module?: PluginModule
  loadError?: string
  lastError?: string
}

interface Stored {
  enabled?: boolean
  values?: Record<string, SettingValue>
}

export interface PluginInfo {
  id: string
  name: string
  description?: string
  version?: string
  ui: boolean
  enabled: boolean
  configured: boolean
  error?: string
  settings: (SettingDef & { value?: SettingValue; set?: boolean })[]
}

const SETTING_TYPES = new Set(['text', 'password', 'select', 'boolean'])
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const DAY = 24 * 3600 * 1000

const parseManifest = (id: string, raw: unknown): Manifest => {
  const m = raw as Partial<Manifest> | null
  if (!m || typeof m !== 'object') throw new Error('plugin.json is not an object')
  if (m.id !== id) throw new Error(`"id" must match the folder name "${id}"`)
  if (typeof m.name !== 'string' || !m.name) throw new Error('"name" is missing')
  const settings = (Array.isArray(m.settings) ? m.settings : []).map((s) => {
    if (!s || typeof s.key !== 'string' || typeof s.label !== 'string' || !SETTING_TYPES.has(s.type)) throw new Error('invalid entry in "settings"')
    if (s.type === 'select' && !Array.isArray(s.options)) throw new Error(`setting "${s.key}" needs "options"`)
    return s
  })
  if (m.ui !== undefined && (typeof m.ui !== 'string' || !/^[\w-]+(\.[\w-]+)*\.js$/.test(m.ui))) throw new Error('"ui" must be a file name ending in .js')
  return { id, name: m.name, description: m.description, version: m.version, ui: m.ui, settings }
}

export class Plugins {
  private plugins = new Map<string, Loaded>()
  private stored: Record<string, Stored> = {}
  private cache = new Map<string, { value: PackageData; until: number }>()
  private pending = new Map<string, Promise<PackageData>>()
  private writing: Promise<void> = Promise.resolve()
  // Poster token -> names of the packages that show it; a poster is deleted when no package is left.
  private posterUsers = new Map<string, Set<string>>()

  constructor(
    private readonly dir: string,
    private readonly settingsFile: string,
    private readonly imageDir: string,
    private readonly log: { info: (m: string) => void; warn: (m: string) => void }
  ) {}

  async load(): Promise<void> {
    try {
      this.stored = JSON.parse(await readFile(this.settingsFile, 'utf8')).plugins ?? {}
    } catch {
      this.stored = {}
    }
    try {
      const index: Record<string, string[]> = JSON.parse(await readFile(join(this.imageDir, 'index.json'), 'utf8'))
      this.posterUsers = new Map(Object.entries(index).map(([token, names]) => [token, new Set(names)]))
    } catch {
      /* no posters cached yet */
    }
    let entries: string[] = []
    try {
      entries = (await readdir(this.dir, { withFileTypes: true })).filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(e.name)).map((e) => e.name).sort()
    } catch {
      this.log.info(`No plugins folder at ${this.dir}`)
    }
    for (const id of entries) {
      try {
        const manifest = parseManifest(id, JSON.parse(await readFile(join(this.dir, id, 'plugin.json'), 'utf8')))
        const loaded: Loaded = { manifest }
        this.plugins.set(id, loaded)
        try {
          loaded.module = (await import(pathToFileURL(join(this.dir, id, 'index.js')).href)).default ?? {}
        } catch (e) {
          loaded.loadError = `index.js: ${e instanceof Error ? e.message : e}`
          this.log.warn(`Plugin "${id}" could not be loaded: ${loaded.loadError}`)
        }
      } catch (e) {
        this.log.warn(`Plugin folder "${id}" skipped: ${e instanceof Error ? e.message : e}`)
      }
    }
    this.log.info(`Plugins: ${[...this.plugins.keys()].join(', ') || 'none'}`)
  }

  private valuesOf(loaded: Loaded): Record<string, SettingValue> {
    const given = this.stored[loaded.manifest.id]?.values ?? {}
    const values: Record<string, SettingValue> = {}
    for (const s of loaded.manifest.settings) {
      const v = given[s.key] ?? s.default
      if (v !== undefined) values[s.key] = v
    }
    return values
  }

  private configured(loaded: Loaded): boolean {
    const values = this.valuesOf(loaded)
    return loaded.manifest.settings.every((s) => !s.required || (s.type === 'boolean' ? true : Boolean(values[s.key])))
  }

  list(): PluginInfo[] {
    return [...this.plugins.values()].map((loaded) => {
      const values = this.valuesOf(loaded)
      return {
        id: loaded.manifest.id,
        name: loaded.manifest.name,
        description: loaded.manifest.description,
        version: loaded.manifest.version,
        ui: Boolean(loaded.manifest.ui),
        enabled: this.stored[loaded.manifest.id]?.enabled === true,
        configured: this.configured(loaded),
        error: loaded.loadError ?? loaded.lastError,
        // Secrets never leave the server: the UI only learns whether one is set.
        settings: loaded.manifest.settings.map((s) => (s.type === 'password' ? { ...s, set: Boolean(values[s.key]) } : { ...s, value: values[s.key] }))
      }
    })
  }

  // `values` only holds the settings that change; for a password "" or null removes it.
  async update(id: string, change: { enabled?: unknown; values?: unknown }): Promise<PluginInfo> {
    const loaded = this.plugins.get(id)
    if (!loaded) throw Object.assign(new Error('Unknown plugin'), { statusCode: 404 })
    const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 })
    const entry = (this.stored[id] ??= {})
    if (change.enabled !== undefined) {
      if (typeof change.enabled !== 'boolean') throw bad('"enabled" must be a boolean')
      entry.enabled = change.enabled
    }
    if (change.values !== undefined) {
      if (!change.values || typeof change.values !== 'object') throw bad('"values" must be an object')
      const values = { ...(entry.values ?? {}) }
      for (const [key, raw] of Object.entries(change.values)) {
        const def = loaded.manifest.settings.find((s) => s.key === key)
        if (!def) throw bad(`Unknown setting "${key}"`)
        if (def.type === 'boolean') {
          if (typeof raw !== 'boolean') throw bad(`"${key}" must be a boolean`)
          values[key] = raw
        } else if (raw === null || raw === '') {
          delete values[key]
        } else if (typeof raw !== 'string' || raw.length > 2000) {
          throw bad(`"${key}" must be a string`)
        } else if (def.type === 'select' && !def.options?.some((o) => o.value === raw)) {
          throw bad(`"${key}" is not one of the options`)
        } else {
          values[key] = raw.trim()
        }
      }
      entry.values = values
    }
    loaded.lastError = undefined
    for (const key of [...this.cache.keys()]) if (key.startsWith(`${id}\0`)) this.cache.delete(key)
    await this.save()
    return this.list().find((p) => p.id === id)!
  }

  private save(): Promise<void> {
    // Written one after the other; the file holds API keys, so only the server's user may read it.
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.settingsFile), { recursive: true })
      const tmp = `${this.settingsFile}.tmp`
      await writeFile(tmp, JSON.stringify({ plugins: this.stored }, null, 2), { mode: 0o600 })
      await rename(tmp, this.settingsFile)
    })
    return this.writing
  }

  private isActive(loaded: Loaded): boolean {
    return this.stored[loaded.manifest.id]?.enabled === true && this.configured(loaded)
  }

  // The plugin's UI module (served to the browser), only while the plugin is installed.
  async uiSource(id: string): Promise<string | null> {
    const file = this.plugins.get(id)?.manifest.ui
    if (!file) return null
    try {
      return await readFile(join(this.dir, id, file), 'utf8')
    } catch {
      return null
    }
  }

  // What one enabled plugin knows about a package (null: nothing, or the plugin is off / not set up).
  async packageData(id: string, name: string, key: string, urls: () => Promise<string[]>): Promise<PackageData | null> {
    const loaded = this.plugins.get(id)
    if (!loaded?.module?.packageData || !this.isActive(loaded)) return null
    return this.dataFor(loaded, name, key, urls)
  }

  // `packageKey` tells packages apart that have the same name (the device and the package's uuid).
  private dataFor(loaded: Loaded, name: string, packageKey: string, urls: () => Promise<string[]>): Promise<PackageData> {
    const key = `${loaded.manifest.id}\0${packageKey}\0${name}`
    const cached = this.cache.get(key)
    if (cached && cached.until > Date.now()) return Promise.resolve(cached.value)
    let job = this.pending.get(key)
    if (!job) {
      job = (async () => {
        let value: PackageData = {}
        let ttl = DAY
        try {
          const result = await loaded.module!.packageData!({
            name,
            urls: once(urls),
            settings: this.valuesOf(loaded),
            signal: AbortSignal.timeout(10000),
            image: (url) => this.registerImage(loaded.manifest.id, url, name)
          })
          value = result && typeof result === 'object' ? result : {}
          loaded.lastError = undefined
          if (!Object.keys(value).length) ttl = 3600 * 1000
        } catch (e) {
          // Failures (bad key, service down) are retried soon and shown in the settings dialog.
          loaded.lastError = e instanceof Error ? e.message : String(e)
          this.log.warn(`Plugin "${loaded.manifest.id}" failed for "${name.slice(0, 80)}": ${loaded.lastError}`)
          ttl = 60 * 1000
        }
        this.cache.set(key, { value, until: Date.now() + ttl })
        return value
      })().finally(() => this.pending.delete(key))
      this.pending.set(key, job)
    }
    return job
  }

  // Images are fetched by the server and cached on disk; the browser only ever sees our own URL.
  // Every plugin has its own folder and its own route (/api/plugins/<id>/image/<token>).
  private async registerImage(pluginId: string, url: string, packageName: string): Promise<string> {
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('image() only takes https URLs')
    const token = createHash('sha256').update(url).digest('hex').slice(0, 32)
    try {
      await mkdir(this.imageFolder(pluginId), { recursive: true })
      await writeFile(join(this.imageFolder(pluginId), `${token}.url`), url)
      const key = `${pluginId}/${token}`
      const users = this.posterUsers.get(key) ?? new Set<string>()
      if (!users.has(packageName)) {
        this.posterUsers.set(key, users.add(packageName))
        await this.saveIndex()
      }
    } catch {
      /* the image route answers 404 if the URL is unknown */
    }
    return `/api/plugins/${pluginId}/image/${token}`
  }

  private imageFolder(pluginId: string): string {
    return join(this.imageDir, pluginId)
  }

  private async saveIndex(): Promise<void> {
    const index = Object.fromEntries([...this.posterUsers].map(([token, names]) => [token, [...names]]))
    await writeFile(join(this.imageDir, 'index.json'), JSON.stringify(index))
  }

  // Drops everything cached for packages that no longer exist; a poster goes once no package uses it.
  // `existing` must be complete (all packages of all devices), otherwise posters of unknown packages would go.
  async prune(existing: Set<string>): Promise<number> {
    let removed = 0
    for (const key of [...this.cache.keys()]) if (!existing.has(key.slice(key.indexOf('\0') + 1))) this.cache.delete(key)
    for (const [key, names] of this.posterUsers) {
      for (const n of names) if (!existing.has(n)) names.delete(n)
      if (names.size) continue
      this.posterUsers.delete(key)
      const [pluginId, token] = key.split('/')
      try {
        for (const f of (await readdir(this.imageFolder(pluginId))).filter((f) => f.startsWith(`${token}.`))) await rm(join(this.imageFolder(pluginId), f), { force: true })
        removed++
      } catch {
        /* already gone */
      }
    }
    if (removed || this.posterUsers.size) await this.saveIndex().catch(() => undefined)
    return removed
  }

  async image(pluginId: string, token: string): Promise<{ type: string; data: Buffer } | null> {
    if (!this.plugins.has(pluginId) || !/^[0-9a-f]{32}$/.test(token)) return null
    const folder = this.imageFolder(pluginId)
    try {
      const file = (await readdir(folder)).find((f) => f.startsWith(`${token}.`) && !f.endsWith('.url'))
      if (file) {
        const ext = file.split('.').pop()!
        return { type: Object.keys(IMAGE_TYPES).find((t) => IMAGE_TYPES[t] === ext) ?? 'image/jpeg', data: await readFile(join(folder, file)) }
      }
      const url = await readFile(join(folder, `${token}.url`), 'utf8')
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
      if (!res.ok || !IMAGE_TYPES[type]) return null
      const data = Buffer.from(await res.arrayBuffer())
      if (!data.length || data.length > MAX_IMAGE_BYTES) return null
      await writeFile(join(folder, `${token}.${IMAGE_TYPES[type]}`), data).catch(() => undefined)
      return { type, data }
    } catch {
      return null
    }
  }
}
