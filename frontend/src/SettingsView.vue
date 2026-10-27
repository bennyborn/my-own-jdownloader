<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, HardDrive, Monitor, ServerOff, Smartphone } from 'lucide-vue-next'
import { deviceName, devices, pickSettingsDevice, settingsDevice, showingAll } from './devices'
import { phone, SECTIONS, settingsOpen, settingsSection, type SettingsSection } from './settings'
import ContextMenuSettings from './ContextMenuSettings.vue'
import AccountSettings from './AccountSettings.vue'
import BrowserExtensionSettings from './BrowserExtensionSettings.vue'
import ExtensionSettings from './ExtensionSettings.vue'
import JdInfoSettings from './JdInfoSettings.vue'
import BasicAuthSettings from './BasicAuthSettings.vue'
import AppCaptchaSettings from './AppCaptchaSettings.vue'
import AppLinksSettings from './AppLinksSettings.vue'
import AppNotificationsSettings from './AppNotificationsSettings.vue'
import AppPrivacySettings from './AppPrivacySettings.vue'
import AppSettings from './AppSettings.vue'
import AppUpdateSettings from './AppUpdateSettings.vue'
import HosterSettings from './HosterSettings.vue'
import McpSettings from './McpSettings.vue'
import JdSettings from './JdSettings.vue'
import PluginSettings from './PluginSettings.vue'

const current = computed(() => SECTIONS.find((s) => s.id === settingsSection.value) ?? SECTIONS[0])
const uiSections = SECTIONS.filter((s) => s.scope === 'ui')
const appSections = SECTIONS.filter((s) => s.scope === 'app')
const jdSections = SECTIONS.filter((s) => s.scope === 'jd')
const name = computed(() => deviceName(settingsDevice.value))

// Phone: the list of sections, grouped like the sidebar of the desktop.
const groups = computed(() =>
  [
    { id: 'app', label: 'App', icon: Smartphone, sections: appSections },
    { id: 'ui', label: 'This interface', icon: Monitor, sections: uiSections },
    { id: 'jd', label: 'JDownloader', icon: HardDrive, sections: jdSections }
  ].filter((g) => g.sections.length)
)
// Opening a section adds a history entry, so "back" (the browser's, the app's) returns to the list. A page opened directly by its
// link has no list behind it: the back arrow then just shows the list.
let cameFromList = false
const openSection = (s: SettingsSection) => {
  settingsSection.value = s.id
  settingsOpen.value = true
  cameFromList = true
}
const back = () => {
  if (cameFromList) {
    cameFromList = false
    history.back()
  } else settingsOpen.value = false
}
// Which way the page slides: into a section from the right, back to the list from the left. Set before the page changes
// (also by the back button, which only changes the anchor), none when the page was just opened.
const slide = ref<'' | 'slide-in' | 'slide-out'>('')
watch(settingsOpen, (open) => (slide.value = open ? 'slide-in' : 'slide-out'), { flush: 'sync' })
watch(settingsOpen, () => window.scrollTo(0, 0))

// In the overview of all devices every device gets its own block; only the one in use is unfolded.
const open = (deviceId: string, s: SettingsSection) => {
  pickSettingsDevice(deviceId)
  settingsSection.value = s.id
}
const fold = (deviceId: string) => {
  pickSettingsDevice(deviceId)
  if (current.value.scope !== 'jd') settingsSection.value = jdSections[0].id
}
</script>

<template>
  <div class="settings" :class="[{ phone }, phone ? slide : '']">
    <div v-if="!phone" class="sidebar" role="navigation" aria-label="Settings sections">
      <template v-if="appSections.length">
        <h2 class="app"><Smartphone :size="13" /> App</h2>
        <button v-for="s in appSections" :key="s.id" type="button" class="app" :class="{ active: settingsSection === s.id }" @click="settingsSection = s.id">
          <component :is="s.icon" :size="16" /> {{ s.label }}
        </button>
      </template>

      <h2 class="ui"><Monitor :size="13" /> This interface</h2>
      <button v-for="s in uiSections" :key="s.id" type="button" class="ui" :class="{ active: settingsSection === s.id }" @click="settingsSection = s.id">
        <component :is="s.icon" :size="16" /> {{ s.label }}
      </button>

      <h2 class="jd"><HardDrive :size="13" /> JDownloader<span v-if="!showingAll && name" class="device">{{ name }}</span></h2>
      <template v-if="showingAll">
        <div v-for="d in devices" :key="d.id" class="dev" :class="{ unfolded: settingsDevice === d.id }">
          <button type="button" class="devhead" :disabled="d.online === false" :aria-expanded="settingsDevice === d.id" @click="fold(d.id)">
            <ChevronRight :size="14" class="chevron" />
            <span class="devname">{{ d.name }}</span>
            <ServerOff v-if="d.online === false" :size="13" aria-label="offline" />
          </button>
          <template v-if="settingsDevice === d.id">
            <button v-for="s in jdSections" :key="s.id" type="button" class="jd nested" :class="{ active: settingsSection === s.id }" @click="open(d.id, s)">
              <component :is="s.icon" :size="16" /> {{ s.label }}
            </button>
          </template>
        </div>
      </template>
      <template v-else>
        <button v-for="s in jdSections" :key="s.id" type="button" class="jd" :class="{ active: settingsSection === s.id }" @click="settingsSection = s.id">
          <component :is="s.icon" :size="16" /> {{ s.label }}
        </button>
      </template>
    </div>
    <div v-else-if="!settingsOpen" class="menu" role="navigation" aria-label="Settings sections">
      <template v-for="g in groups" :key="g.id">
        <h2 class="group" :class="g.id">
          <component :is="g.icon" :size="13" /> {{ g.label }}<span v-if="g.id === 'jd' && !showingAll && name" class="device">{{ name }}</span>
        </h2>
        <select v-if="g.id === 'jd' && showingAll" class="devpick" aria-label="Device" :value="settingsDevice" @change="pickSettingsDevice(($event.target as HTMLSelectElement).value)">
          <option v-for="d in devices" :key="d.id" :value="d.id" :disabled="d.online === false">{{ d.name }}{{ d.online === false ? ' (offline)' : '' }}</option>
        </select>
        <ul class="rows">
          <li v-for="s in g.sections" :key="s.id">
            <button type="button" class="row" @click="openSection(s)">
              <component :is="s.icon" :size="18" /><span class="label">{{ s.label }}</span><ChevronRight :size="16" class="go" />
            </button>
          </li>
        </ul>
      </template>
    </div>
    <section v-if="!phone || settingsOpen" class="content">
      <button v-if="phone" type="button" class="back" @click="back"><ChevronLeft :size="18" /> Settings</button>
      <p class="scope" :class="current.scope">
        <template v-if="current.scope === 'jd'">
          <HardDrive :size="14" /> Stored on the JDownloader<template v-if="name"> “{{ name }}”</template>: changes apply at once and to every client of it.
        </template>
        <template v-else-if="current.scope === 'app'"><Smartphone :size="14" /> Stored on this phone only: neither the backend nor the JDownloader is affected.</template>
        <template v-else><Monitor :size="14" /> Stored by this web interface (for every browser that opens it): the JDownloader is not affected.</template>
      </p>
      <h2 class="title">{{ current.label }}</h2>
      <Transition name="sub" mode="out-in">
        <div :key="current.id">
        <AppSettings v-if="current.id === 'app-connection'" />
        <AppNotificationsSettings v-else-if="current.id === 'app-notifications'" />
        <AppCaptchaSettings v-else-if="current.id === 'app-captchas'" />
        <AppLinksSettings v-else-if="current.id === 'app-links'" />
        <AppPrivacySettings v-else-if="current.id === 'app-privacy'" />
        <AppUpdateSettings v-else-if="current.id === 'app-update'" />
        <BrowserExtensionSettings v-else-if="current.id === 'install'" />
        <PluginSettings v-else-if="current.id === 'plugins'" />
        <ContextMenuSettings v-else-if="current.id === 'context-menu'" />
        <McpSettings v-else-if="current.id === 'mcp'" />
        <JdInfoSettings v-else-if="current.id === 'jd-info'" />
        <ExtensionSettings v-else-if="current.id === 'extensions'" />
        <AccountSettings v-else-if="current.id === 'accounts'" />
        <BasicAuthSettings v-else-if="current.id === 'basic-auth'" />
        <HosterSettings v-else-if="current.id === 'hosters'" />
        <JdSettings v-else-if="current.category" :key="current.id" :category="current.category" :title="current.label" />
        </div>
      </Transition>
    </section>
  </div>
</template>

<style scoped>
.settings { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 24px; align-items: start; }
.sidebar { display: grid; gap: 2px; position: sticky; top: 12px; }
.sidebar h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; white-space: nowrap; margin: 0 12px 8px; padding: 0; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.sidebar h2.jd, .sidebar h2.ui:not(:first-child) { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border); }
.sidebar h2.jd { color: var(--accent); }
.sidebar h2.ui, .sidebar h2.app { color: var(--muted); }
.sidebar .device { flex-basis: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--muted); }
.sidebar button { display: flex; align-items: center; gap: 8px; white-space: nowrap; padding: 8px 12px; background: none; border: 0; border-radius: 8px; color: var(--muted); font: inherit; text-align: left; cursor: pointer; }
.sidebar button:hover { color: var(--text); background: var(--hover); }
.sidebar button.active { color: var(--text); background: var(--card); box-shadow: inset 0 0 0 1px var(--border); }
.sidebar button.jd.active { box-shadow: inset 3px 0 0 var(--accent), inset 0 0 0 1px var(--border); }
.dev { display: grid; gap: 2px; margin-bottom: 4px; }
.dev .devhead { padding: 6px 12px; font-weight: 600; color: var(--text); }
.dev .devhead:disabled { color: var(--muted); font-weight: 400; cursor: default; }
.dev .devhead:disabled:hover { background: none; }
.devname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chevron { flex: none; color: var(--muted); transition: transform 0.15s; }
.unfolded .chevron { transform: rotate(90deg); }
.sidebar button.nested { margin-left: 14px; }
.scope { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 12px; padding: 8px 12px; border-radius: 8px; font-size: 0.8rem; line-height: 1.4; }
.scope svg { flex: none; margin-top: 2px; }
.scope.jd { color: var(--text); background: color-mix(in srgb, var(--accent) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); }
.scope.ui, .scope.app { color: var(--muted); background: var(--card); border: 1px solid var(--border); }
.sub-enter-active, .sub-leave-active { transition: opacity 0.12s ease, transform 0.12s ease; }
.sub-enter-from { opacity: 0; transform: translateY(8px); }
.sub-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .sub-enter-active, .sub-leave-active { transition: none; } }
.title { margin: 0 0 12px; font-size: 1.1rem; }
@media (max-width: 720px) {
  .settings { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .sidebar { position: static; display: flex; flex-wrap: wrap; align-items: center; }
  .sidebar h2 { flex-basis: 100%; margin: 0 0 4px; }
  .sidebar h2.jd, .sidebar h2.ui:not(:first-child) { margin-top: 12px; padding-top: 12px; }
  .sidebar { gap: 6px; }
  .sidebar button { padding: 7px 12px; border: 1px solid var(--border); border-radius: 999px; }
  .sidebar button.active, .sidebar button.jd.active { background: var(--card); border-color: var(--accent); box-shadow: none; color: var(--text); }
  .dev { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 6px; }
  .dev .devhead { flex-basis: 100%; border: 0; border-radius: 8px; padding: 6px 4px; }
  .sidebar button.nested { margin-left: 0; }
}
/* Phone: list of sections, then a page per section. */
.settings.phone { grid-template-columns: minmax(0, 1fr); gap: 0; }
.menu { display: grid; gap: 8px; }
.group { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; margin: 14px 4px 0; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.group:first-child { margin-top: 0; }
.group.jd { color: var(--accent); }
.group .device { flex-basis: 100%; text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--muted); }
.devpick { padding: 10px 12px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 10px; font: inherit; }
.rows { list-style: none; margin: 0; padding: 0; background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.rows li + li { border-top: 1px solid var(--border); }
.row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 0 14px; background: none; border: 0; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.row:active { background: var(--hover); }
.row .label { flex: 1; }
.row svg { flex: none; color: var(--muted); }
.phone .content { display: flex; flex-direction: column; }
.back { align-self: flex-start; display: inline-flex; align-items: center; gap: 2px; margin: -6px 0 6px -8px; padding: 8px 12px 8px 4px; background: none; border: 0; border-radius: 8px; color: var(--accent); font: inherit; cursor: pointer; }
.phone .title { order: 1; margin: 0 0 4px; font-size: 1.3rem; }
.phone .scope { order: 2; margin: 4px 0 16px; }
.phone .content > div { order: 3; }
@keyframes slide-in { from { opacity: 0; transform: translateX(28px); } }
@keyframes slide-out { from { opacity: 0; transform: translateX(-28px); } }
.phone.slide-in > .content, .phone.slide-in > .menu { animation: slide-in 0.2s ease-out; }
.phone.slide-out > .content, .phone.slide-out > .menu { animation: slide-out 0.2s ease-out; }
@media (prefers-reduced-motion: reduce) { .phone > .content, .phone > .menu { animation: none !important; } }
</style>
