<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, HardDrive, Monitor, ServerOff, Smartphone } from 'lucide-vue-next'
import { deviceName, devices, pickSettingsDevice, settingsDevice, showingAll } from './devices'
import { SECTIONS, settingsSection, type SettingsSection } from './settings'
import AccountSettings from './AccountSettings.vue'
import AppCaptchaSettings from './AppCaptchaSettings.vue'
import AppLinksSettings from './AppLinksSettings.vue'
import AppNotificationsSettings from './AppNotificationsSettings.vue'
import AppPrivacySettings from './AppPrivacySettings.vue'
import AppSettings from './AppSettings.vue'
import HosterSettings from './HosterSettings.vue'
import McpSettings from './McpSettings.vue'
import JdSettings from './JdSettings.vue'
import PluginSettings from './PluginSettings.vue'

const current = computed(() => SECTIONS.find((s) => s.id === settingsSection.value) ?? SECTIONS[0])
const uiSections = SECTIONS.filter((s) => s.scope === 'ui')
const appSections = SECTIONS.filter((s) => s.scope === 'app')
const jdSections = SECTIONS.filter((s) => s.scope === 'jd')
const name = computed(() => deviceName(settingsDevice.value))

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
  <div class="settings">
    <div class="sidebar" role="navigation" aria-label="Settings sections">
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
    <section class="content">
      <p class="scope" :class="current.scope">
        <template v-if="current.scope === 'jd'">
          <HardDrive :size="14" /> Stored on the JDownloader<template v-if="name"> “{{ name }}”</template>: changes apply at once and to every client of it.
        </template>
        <template v-else-if="current.scope === 'app'"><Smartphone :size="14" /> Stored on this phone only: neither the backend nor the JDownloader is affected.</template>
        <template v-else><Monitor :size="14" /> Stored in this web interface only: the JDownloader is not affected.</template>
      </p>
      <h2 class="title">{{ current.label }}</h2>
      <Transition name="sub" mode="out-in">
        <div :key="current.id">
        <AppSettings v-if="current.id === 'app-connection'" />
        <AppNotificationsSettings v-else-if="current.id === 'app-notifications'" />
        <AppCaptchaSettings v-else-if="current.id === 'app-captchas'" />
        <AppLinksSettings v-else-if="current.id === 'app-links'" />
        <AppPrivacySettings v-else-if="current.id === 'app-privacy'" />
        <PluginSettings v-else-if="current.id === 'plugins'" />
        <McpSettings v-else-if="current.id === 'mcp'" />
        <AccountSettings v-else-if="current.id === 'accounts'" />
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
.scope { display: flex; align-items: center; gap: 6px; margin: 0 0 12px; padding: 8px 12px; border-radius: 8px; font-size: 0.8rem; line-height: 1.4; }
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
</style>
