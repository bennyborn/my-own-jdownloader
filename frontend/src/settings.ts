import { ref, type Component } from 'vue'
import { Archive, Cog, CreditCard, Download, KeyRound, Globe, Link2, Network, Plug, Puzzle, RefreshCw } from 'lucide-vue-next'
import { parseHash } from './devices'

// The sections of the settings page (the sidebar). `scope` says where the settings of a section live:
// "jd" on the JDownloader of the shown device (its own config, shared with every other client), "ui" only in
// this web interface. The page shows that clearly. New settings get a new entry here and a component.
export type SettingsScope = 'jd' | 'ui'
export interface SettingsSection {
  id: string
  label: string
  icon: Component
  scope: SettingsScope
  // Scope "jd": the category of backend/src/jdconfig.ts
  category?: string
}
export const SECTIONS: SettingsSection[] = [
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

export const settingsSection = ref<string>(SECTIONS.find((s) => s.id === parseHash().section)?.id ?? SECTIONS[0].id)
