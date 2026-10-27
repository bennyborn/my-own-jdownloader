import type { MyJdClient } from './myjd/client.js'

// The settings of the JDownloader itself, read and written through its config API. The list of what exists
// comes from the device (/config/list), this file only decides what we show and where.
export interface RawEntry {
  interfaceName: string
  storage?: string | null
  key: string
  type?: string
  abstractType: string
  value?: unknown
  defaultValue?: unknown
  docs?: string
  enumOptions?: [string, string | null][]
  enumLabel?: string
}

export interface ConfigEntry {
  key: string
  label: string
  type: string
  value?: unknown
  defaultValue?: unknown
  docs?: string
  options?: { value: string; label: string }[]
  secret?: boolean
  set?: boolean
}

export interface ConfigGroup {
  interfaceName: string
  storage?: string | null
  label: string
  // Set for settings this app manages itself: the page marks the group and says what it is used for.
  note?: string
  noteTitle?: string
  entries: ConfigEntry[]
}

export interface ConfigCategory {
  id: string
  groups: ConfigGroup[]
}

// What the UI reacts to (see JdConfig.settings).
export interface JdSettings {
  extractionEnabled: boolean
  packagizerEnabled: boolean
  // Defaults of the "Add links" dialog.
  autostart: boolean
  autoExtract: boolean
  overwritePackagizerRules: boolean
  defaultFolder: string | null
  // Bytes per second JD is limited to while paused.
  pauseSpeed: number
  // Bytes per second of the speed limit; 0 when the limit is off.
  speedLimit: number
}
const DEFAULT_SETTINGS: JdSettings = { extractionEnabled: true, packagizerEnabled: true, autostart: false, autoExtract: false, overwritePackagizerRules: true, defaultFolder: null, pauseSpeed: 10240, speedLimit: 0 }

// Category -> the interfaces (matched by the end of their name) that belong to it. The ids are used by the
// frontend's sidebar. Interfaces that match nothing (plugins, the desktop GUI) are not shown.
const CATEGORIES: [string, string[]][] = [
  ['downloads', ['settings.GeneralSettings', 'DownloadControllerConfig', 'HosterRuleConfig', 'settings.AccountSettings']],
  ['linkgrabber', ['LinkgrabberSettings', 'LinkCollectorConfig', 'LinkCrawlerConfig', 'LinkCheckerConfig', 'LinkFilterSettings', 'PackagizerSettings', 'FavIconsConfig']],
  ['connection', ['InternetConnectionSettings', 'ReconnectConfig', 'LiveHeaderReconnectSettings', 'UPUPReconnectSettings']],
  ['extraction', ['ExtractionConfig', 'FFmpegSetup']],
  ['captcha', ['captcha.CaptchaSettings', 'CaptchaMyJDownloaderRemoteSolverSettings', 'JACSolverConfig', 'AntiCaptchaComConfigInterface', 'CheapCaptchaConfigInterface', 'DeathByCaptchaSettings', 'EndCaptchaConfigInterface', 'ImageTyperzConfigInterface', 'Captcha9kwSettings', 'TwoCaptchaConfigInterface']],
  ['update', ['UpdateSettings', 'LastChanceSettings']],
  ['system', ['SilentModeSettings', 'LogConfig', 'Extension', 'MyJDownloaderSettings', 'RemoteAPIConfig']]
]

// Left out of the core sections on purpose: the plugins (hosters, media libraries; they have their own page) and what only steers the desktop GUI of the JDownloader.
// Everything that is neither here nor in CATEGORIES is logged once (see JdConfig.list), so that settings added by a
// newer JDownloader do not go unnoticed.
const PLUGIN = /^(org\.jdownloader\.plugins|jd\.plugins)\./
const EXCLUDED = [PLUGIN, /\.GraphicalUserInterfaceSettings$/, /\.BubbleNotifyConfig$/, /\.ShortcutSettings$/, /\.SoundSettings$/, /\.ExtFileSystemViewSettings$/]

// The value types the page can edit (the frontend renders each of them). Any other type is shown as raw JSON.
const KNOWN_TYPES = new Set(['BOOLEAN', 'ENUM', 'INT', 'LONG', 'DOUBLE', 'STRING', 'STRING_LIST', 'INT_LIST', 'OBJECT', 'OBJECT_LIST', 'ENUM_LIST'])
const reported = new Set<string>()
const reportOnce = (what: string, message: string) => {
  if (reported.has(what)) return
  reported.add(what)
  console.warn(`JD config: ${message}`)
}

const GROUP_LABELS: Record<string, string> = {
  GeneralSettings: 'General',
  DownloadControllerConfig: 'Download controller',
  HosterRuleConfig: 'Hoster rules',
  AccountSettings: 'Accounts',
  LinkgrabberSettings: 'Linkgrabber',
  LinkCollectorConfig: 'Link collector',
  LinkCrawlerConfig: 'Link crawler',
  LinkCheckerConfig: 'Link checker',
  LinkFilterSettings: 'Link filter',
  PackagizerSettings: 'Packagizer',
  FavIconsConfig: 'Favicons',
  InternetConnectionSettings: 'Internet connection',
  ReconnectConfig: 'Reconnect',
  LiveHeaderReconnectSettings: 'Reconnect: LiveHeader',
  UPUPReconnectSettings: 'Reconnect: UPnP',
  ExtractionConfig: 'Extraction',
  FFmpegSetup: 'FFmpeg',
  CaptchaSettings: 'Captcha: general',
  CaptchaMyJDownloaderRemoteSolverSettings: 'Captcha: MyJDownloader solver',
  JACSolverConfig: 'Captcha: JAC (automatic)',
  AntiCaptchaComConfigInterface: 'Captcha: anti-captcha.com',
  CheapCaptchaConfigInterface: 'Captcha: CheapCaptcha',
  DeathByCaptchaSettings: 'Captcha: DeathByCaptcha',
  EndCaptchaConfigInterface: 'Captcha: EndCaptcha',
  ImageTyperzConfigInterface: 'Captcha: ImageTyperz',
  Captcha9kwSettings: 'Captcha: 9kw.eu',
  TwoCaptchaConfigInterface: 'Captcha: 2captcha',
  MyJDownloaderSettings: 'MyJDownloader',
  RemoteAPIConfig: 'Local API',
  UpdateSettings: 'Updates',
  LastChanceSettings: 'Last chance',
  SilentModeSettings: 'Silent mode',
  LogConfig: 'Logging'
}

// Interfaces the app writes itself, with what the user should know before touching them.
const MANAGED: Record<string, { title: string; text: string }> = {
  AntiCaptchaComConfigInterface: {
    title: 'Managed by this interface.',
    text: 'This service is taken over by this web interface: the JDownloader sends the captchas it cannot show itself (e.g. Cloudflare Turnstile) to it, and they appear here to be solved. The address and key are set automatically; changing them or switching it off stops these captchas from arriving.'
  },
  MyJDownloaderSettings: {
    title: 'Handle with care.',
    text: 'This is the connection of the JDownloader to MyJDownloader, which this interface uses to reach it. A wrong device name, port or connect mode can make the JDownloader unreachable from here, and it has to be fixed on the machine itself.'
  }
}

const SECRET = /pass(word|wd)?$|token|secret|apikey|api_key|cookie|login$|^user(name)?$/i

const words = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/_/g, ' ').trim()
const simple = (name: string): string => name.split(/[.$]/).pop() ?? name
const labelOf = (key: string): string => {
  const w = words(key).replace(/\bI Ps\b/g, 'IPs').replace(/\bUpnp\b/g, 'UPnP').replace(/\bI P\b/g, 'IP')
  return w.charAt(0).toUpperCase() + w.slice(1)
}

const categoryOf = (interfaceName: string): string | undefined => {
  if (EXCLUDED.some((re) => re.test(interfaceName))) return undefined
  return CATEGORIES.find(([, names]) => names.some((n) => interfaceName === n || interfaceName.endsWith(`.${n}`) || interfaceName.endsWith(`$${n}`)))?.[0]
}

const toEntry = (e: RawEntry): ConfigEntry => {
  const secret = e.abstractType === 'STRING' && SECRET.test(e.key)
  const entry: ConfigEntry = { key: e.key, label: labelOf(e.key), type: e.abstractType }
  if (e.docs) entry.docs = e.docs
  if (e.enumOptions) entry.options = e.enumOptions.map(([value, label]) => ({ value, label: label ?? labelOf(value.toLowerCase()) }))
  if (secret) {
    // Secrets never leave the backend, the page only learns whether one is set.
    entry.secret = true
    entry.set = typeof e.value === 'string' && e.value !== ''
  } else {
    entry.value = e.value
    entry.defaultValue = e.defaultValue
  }
  return entry
}

// A plugin's settings: its storage path says what and for which site ("cfg/plugins/HOSTER/rapidgator.net").
export interface PluginConfig {
  interfaceName: string
  storage: string
  host: string
  kind: string
  count: number
}

const pluginOf = (interfaceName: string, storage: string | null | undefined): { host: string; kind: string } => {
  const m = /^cfg\/plugins\/([^/]+)\/(.+)$/.exec(storage ?? '')
  return m ? { kind: m[1], host: m[2] } : { kind: 'OTHER', host: labelOf(simple(interfaceName)) }
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export class JdConfig {
  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string
  ) {}

  async list(): Promise<ConfigCategory[]> {
    // pattern, returnDescription, returnValues, returnDefaultValues, returnEnumInfo
    const raw = await this.client.callDevice<RawEntry[]>(this.deviceId, '/config/list', ['.*', true, true, true, true])
    const groups = new Map<string, ConfigGroup>()
    const order = new Map<string, number>()
    for (const e of raw) {
      const id = categoryOf(e.interfaceName)
      if (!id) {
        if (!EXCLUDED.some((re) => re.test(e.interfaceName))) reportOnce(e.interfaceName, `unknown interface ${e.interfaceName}, not shown (add it to CATEGORIES or EXCLUDED in jdconfig.ts)`)
        continue
      }
      if (!KNOWN_TYPES.has(e.abstractType)) reportOnce(`${e.abstractType}`, `unknown value type ${e.abstractType} (${e.interfaceName}.${e.key}), shown as JSON (see DEVELOPER.md, "JDownloader settings")`)
      const key = `${e.interfaceName}\0${e.storage ?? ''}`
      let group = groups.get(key)
      if (!group) {
        const name = simple(e.interfaceName)
        group = { interfaceName: e.interfaceName, storage: e.storage ?? null, label: GROUP_LABELS[name] ?? words(name), note: MANAGED[name]?.text, noteTitle: MANAGED[name]?.title, entries: [] }
        groups.set(key, group)
        order.set(key, CATEGORIES.findIndex(([c]) => c === id) * 1000 + (CATEGORIES.find(([c]) => c === id)?.[1].findIndex((n) => e.interfaceName.endsWith(n)) ?? 0))
      }
      group.entries.push(toEntry(e))
    }
    const categories = new Map<string, ConfigGroup[]>(CATEGORIES.map(([id]) => [id, []]))
    const rank = (key: string, group: ConfigGroup) => (group.note ? -1 : order.get(key)!)
    for (const [, group] of [...groups].sort((a, b) => rank(a[0], a[1]) - rank(b[0], b[1]))) {
      const id = categoryOf(group.interfaceName)!
      categories.get(id)!.push(group)
    }
    return [...categories].map(([id, g]) => ({ id, groups: g }))
  }

  // The few JDownloader settings the UI itself reacts to (hides options, preselects defaults). Grows with the UI.
  // Unknown (older JDownloader, failed call) falls back to DEFAULT_SETTINGS, so the UI stays usable.
  // The few JDownloader settings the UI itself reacts to (hides options, preselects defaults). Grows with the UI.
  // Unknown (older JDownloader, failed call) falls back to DEFAULT_SETTINGS, so the UI stays usable.
  settings(): Promise<JdSettings> {
    return this.loadSettings().catch(() => DEFAULT_SETTINGS)
  }

  private async loadSettings(): Promise<JdSettings> {
    const raw = await this.client.callDevice<RawEntry[]>(this.deviceId, '/config/list', ['.*(Extension|LinkgrabberSettings|PackagizerSettings|GeneralSettings).*', false, true, false, false])
    const value = (iface: string, key: string): unknown => raw.find((e) => simple(e.interfaceName) === iface && e.key === key)?.value
    const bool = (iface: string, key: string, fallback: boolean): boolean => {
      const v = value(iface, key)
      return typeof v === 'boolean' ? v : fallback
    }
    const folder = value('GeneralSettings', 'DefaultDownloadFolder')
    const pauseSpeed = value('GeneralSettings', 'PauseSpeed')
    const speedLimit = value('GeneralSettings', 'DownloadSpeedLimit')
    return {
      extractionEnabled: bool('Extension', 'EnableExtractionExtension', DEFAULT_SETTINGS.extractionEnabled),
      packagizerEnabled: bool('PackagizerSettings', 'PackagizerEnabled', DEFAULT_SETTINGS.packagizerEnabled),
      autostart: bool('LinkgrabberSettings', 'LinkgrabberAutoStartEnabled', DEFAULT_SETTINGS.autostart),
      autoExtract: bool('LinkgrabberSettings', 'AutoExtractionEnabled', DEFAULT_SETTINGS.autoExtract),
      overwritePackagizerRules: bool('LinkgrabberSettings', 'AddLinksDialogOverwritesPackagizerRulesEnabled', DEFAULT_SETTINGS.overwritePackagizerRules),
      defaultFolder: typeof folder === 'string' && folder ? folder : null,
      speedLimit: bool('GeneralSettings', 'DownloadSpeedLimitEnabled', false) && typeof speedLimit === 'number' && speedLimit > 0 ? speedLimit : 0,
      pauseSpeed: typeof pauseSpeed === 'number' && pauseSpeed > 0 ? pauseSpeed : DEFAULT_SETTINGS.pauseSpeed
    }
  }

  // Read-only: whether JD's last update check found an update. Unknown (failed call) counts as none.
  async updateAvailable(): Promise<boolean> {
    try {
      return (await this.client.callDevice<unknown>(this.deviceId, '/update/isUpdateAvailable', [])) === true
    } catch {
      return false
    }
  }

  // Restarts JD and installs the update. Only ever on an explicit request of the user.
  async installUpdate(): Promise<void> {
    await this.client.callDevice(this.deviceId, '/update/restartAndUpdate', [])
  }

  async set(interfaceName: string, storage: string | null, key: string, value: unknown): Promise<unknown> {
    const result = await this.client.callDevice(this.deviceId, '/config/set', [interfaceName, storage, key, value])
    return result
  }

  async reset(interfaceName: string, storage: string | null, key: string): Promise<unknown> {
    const result = await this.client.callDevice(this.deviceId, '/config/reset', [interfaceName, storage, key])
    return result
  }

  // The plugins that have settings (hosters, crawlers, ...), without their entries.
  async plugins(): Promise<PluginConfig[]> {
    const raw = await this.client.callDevice<RawEntry[]>(this.deviceId, '/config/list', ['.*', false, false, false, false])
    const found = new Map<string, PluginConfig>()
    for (const e of raw) {
      if (!PLUGIN.test(e.interfaceName) || !e.storage) continue
      const id = `${e.interfaceName}\0${e.storage}`
      const plugin = found.get(id) ?? { interfaceName: e.interfaceName, storage: e.storage, ...pluginOf(e.interfaceName, e.storage), count: 0 }
      plugin.count++
      found.set(id, plugin)
    }
    return [...found.values()].sort((a, b) => a.host.localeCompare(b.host))
  }

  // One plugin's settings.
  async pluginGroup(interfaceName: string, storage: string): Promise<ConfigGroup | undefined> {
    if (!PLUGIN.test(interfaceName)) return undefined
    const raw = await this.client.callDevice<RawEntry[]>(this.deviceId, '/config/list', [`.*${escapeRegex(interfaceName)}.*`, true, true, true, true])
    const entries = raw.filter((e) => e.interfaceName === interfaceName && e.storage === storage)
    if (!entries.length) return undefined
    return { interfaceName, storage, label: pluginOf(interfaceName, storage).host, entries: entries.map(toEntry) }
  }
}
