<script setup lang="ts">
import { ref, watch } from 'vue'
import { ChevronDown, Download } from 'lucide-vue-next'
import JdSettings from './JdSettings.vue'
import LoadingState from './LoadingState.vue'
import { settingsDevice } from './devices'
import { askConfirm } from './confirm'
import type { ConfigGroup } from './jdconfig'
import { extensions, extensionsError, extensionsState, fetchExtensionGroup, installExtension, loadExtensions, setExtensionEnabled, type JdExtension } from './extensions'
import { powerAction } from './jdSystem'
import { showError } from './toast'
import { finishedWatches, watchUpdate } from './updateWatch'

watch([settingsDevice, finishedWatches], () => {
  open.value = null
  void loadExtensions()
})
void loadExtensions()

// The settings of one extension are open at a time, loaded when they are opened.
const open = ref<string | null>(null)
const group = ref<ConfigGroup | null>(null)
const toggleSettings = async (e: JdExtension) => {
  if (open.value === e.id) {
    open.value = null
    return
  }
  open.value = e.id
  group.value = null
  try {
    const loaded = await fetchExtensionGroup(e.id)
    if (open.value === e.id) group.value = loaded
  } catch (err) {
    showError(`${e.name}: ${err instanceof Error ? err.message : err}`)
    if (open.value === e.id) open.value = null
  }
}

const busy = ref<string | null>(null)
const run = async (id: string, what: string, job: () => Promise<void>): Promise<boolean> => {
  busy.value = id
  try {
    await job()
    return true
  } catch (e) {
    showError(`${what}: ${e instanceof Error ? e.message : e}`)
    void loadExtensions() // the switch shows what the JDownloader says
    return false
  } finally {
    busy.value = null
  }
}

const toggle = async (e: JdExtension, enabled: boolean) => {
  if (!enabled && !(await askConfirm({ title: `Turn off ${e.name}`, message: `${e.name} stops working until it is turned on again.`, confirmLabel: 'Turn off', danger: true }))) {
    void loadExtensions()
    return
  }
  await run(e.id, 'Switching failed', () => setExtensionEnabled(e.id, enabled))
}

// JD only finishes an installation when it starts the next time.
const install = async (e: JdExtension) => {
  if (!(await askConfirm({ title: `Install ${e.name}`, message: `The JDownloader downloads ${e.name} from its update server. It has to restart to finish the installation, and the extension is off until you turn it on.`, confirmLabel: 'Install' }))) return
  if (!(await run(e.id, 'Installing failed', () => installExtension(e.id)))) return
  if (!(await askConfirm({ title: 'Restart now?', message: `${e.name} is ready to be installed. The JDownloader restarts and stops all downloads meanwhile.`, confirmLabel: 'Restart now', danger: true }))) return
  if (await run(e.id, 'Restart failed', () => powerAction('restart-jd'))) watchUpdate(settingsDevice.value, true)
}
</script>

<template>
  <p v-if="extensionsState === 'error'" class="error">The extensions could not be loaded: {{ extensionsError }}</p>
  <LoadingState v-else-if="extensionsState === 'loading' && !extensions.length" text="Loading extensions…" />
  <template v-else>
    <article v-for="e in extensions" :key="e.id" class="card" :class="{ off: !e.installed || !e.enabled }">
      <div class="head">
        <strong>{{ e.name }}</strong>
        <span class="badge" :class="{ ok: e.installed && e.enabled }">{{ !e.installed ? 'Not installed' : e.enabled ? 'On' : 'Off' }}</span>
      </div>
      <p class="dim">{{ e.description }}</p>
      <div class="row-actions">
        <label v-if="e.installed" class="switch"><input type="checkbox" :checked="e.enabled" :disabled="busy !== null" @change="toggle(e, ($event.target as HTMLInputElement).checked)" /> Enabled</label>
        <button v-else type="button" :disabled="busy !== null" @click="install(e)"><Download :size="15" /> {{ busy === e.id ? 'Installing…' : 'Install' }}</button>
        <span class="spacer"></span>
        <button v-if="e.installed && e.configInterface" type="button" :aria-expanded="open === e.id" @click="toggleSettings(e)">Settings <ChevronDown :size="15" :class="{ flipped: open === e.id }" /></button>
      </div>
      <div v-if="open === e.id" class="settings">
        <LoadingState v-if="!group" text="Loading settings…" />
        <JdSettings v-else :key="e.id" :groups="[group]" :title="e.name" />
      </div>
    </article>
    <p v-if="!extensions.length" class="dim">This JDownloader has no extensions.</p>
  </template>
</template>

<style scoped>
.dim { color: var(--muted); margin: 0; font-size: 0.85rem; }
.error { color: #d14343; font-size: 0.85rem; overflow-wrap: anywhere; }
.card { display: grid; gap: 10px; margin-bottom: 12px; padding: 14px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
.card.off strong { color: var(--muted); }
.head { display: flex; align-items: center; gap: 10px; }
.badge { padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; background: var(--hover); color: var(--muted); }
.badge.ok { color: #3fb27f; background: color-mix(in srgb, #3fb27f 15%, transparent); }
.row-actions { display: flex; align-items: center; gap: 4px; }
.spacer { flex: 1; }
.flipped { transform: rotate(180deg); }
.settings { padding-top: 6px; border-top: 1px solid var(--border); }
.switch { display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; cursor: pointer; }
button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
