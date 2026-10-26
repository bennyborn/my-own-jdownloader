import { ref, type Component } from 'vue'
import { Archive, Bell, Cog, Lock, ShieldCheck, CreditCard, Download, KeyRound, Globe, Link2, Network, Plug, Puzzle, RefreshCw } from 'lucide-vue-next'
import { inApp } from './appBridge'
import { parseHash } from './devices'

// The sections of the settings page (the sidebar). `scope` says where the settings of a section live:
// "jd" on the JDownloader of the shown device (its own config, shared with every other client), "ui" only in
// this web interface, "app" on the phone (Android app only). The page shows that clearly. New settings get a new entry here and a component.
export type SettingsScope = 'jd' | 'ui' | 'app'
export interface SettingsSection {
  id: string
  label: string
  icon: Component
  scope: SettingsScope
  // Scope "jd": the category of backend/src/jdconfig.ts
  category?: string
}
const ALL_SECTIONS: SettingsSection[] = [
  { id: 'app-connection', label: 'Connection', icon: Network, scope: 'app' },
  { id: 'app-notifications', label: 'Notifications', icon: Bell, scope: 'app' },
  { id: 'app-captchas', label: 'Captchas', icon: ShieldCheck, scope: 'app' },
  { id: 'app-links', label: 'Incoming links', icon: Link2, scope: 'app' },
  { id: 'app-privacy', label: 'Privacy', icon: Lock, scope: 'app' },
  { id: 'plugins', label: 'Plugins', icon: Puzzle, scope: 'ui' },
  { id: 'mcp', label: 'MCP server', icon: Plug, scope: 'ui' },
  { id: 'accounts', label: 'Accounts', icon: CreditCard, scope: 'jd' },
  { id: 'hosters', label: 'Hosters', icon: Globe, scope: 'jd' },
  { id: 'downloads', label: 'Downloads', icon: Download, scope: 'jd', category: 'downloads' },
  { id: 'linkgrabber', label: 'Linkgrabber', icon: Link2, scope: 'jd', category: 'linkgrabber' },
  { id: 'connection', label: 'Connection', icon: Network, scope: 'jd', category: 'connection' },
  { id: 'extraction', label: 'Extraction', icon: Archive, scope: 'jd', category: 'extraction' },
  { id: 'captcha', label: 'Captcha', icon: KeyRound, scope: 'jd', category: 'captcha' },
  { id: 'update', label: 'Updates', icon: RefreshCw, scope: 'jd', category: 'update' },
  { id: 'system', label: 'System', icon: Cog, scope: 'jd', category: 'system' }
]
// The group "App" only exists inside the Android app.
export const SECTIONS = ALL_SECTIONS.filter((s) => s.scope !== 'app' || inApp)

export const settingsSection = ref<string>(SECTIONS.find((s) => s.id === parseHash().section)?.id ?? SECTIONS[0].id)

// On a phone the settings are a list first, and a section opens as a page of its own. The URL tells which: "#settings" is the
// list, "#settings/downloads" the page (so the back button of the browser / the app goes from the page to the list).
const phoneQuery = window.matchMedia('(max-width: 640px)')
export const phone = ref(phoneQuery.matches)
phoneQuery.addEventListener('change', (e) => (phone.value = e.matches))
export const settingsOpen = ref(Boolean(parseHash().section))
