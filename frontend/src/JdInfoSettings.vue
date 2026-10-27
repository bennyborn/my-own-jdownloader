<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Moon, Power, RefreshCw, RotateCw, Snowflake, X } from 'lucide-vue-next'
import LoadingState from './LoadingState.vue'
import { devices, loadUpdates, settingsDevice, withDevice } from './devices'
import { askConfirm } from './confirm'
import { formatBytes } from './format'
import { checkForUpdates, loadSystemInfo, powerAction, systemError, systemInfo as info, systemState, type PowerAction } from './jdSystem'
import { showError, showSuccess } from './toast'
import { watchUpdate } from './updateWatch'

watch(settingsDevice, () => void loadSystemInfo())
void loadSystemInfo()

const deviceName = computed(() => devices.value.find((d) => d.id === settingsDevice.value)?.name ?? 'the JDownloader')

const duration = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  return days ? `${days} d ${hours} h` : hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`
}
const percent = (part: number, whole: number) => (whole ? Math.min(100, Math.round((part / whole) * 100)) : 0)

// --- Update check ---------------------------------------------------------------------------------------
const checking = ref(false)
const check = async () => {
  checking.value = true
  try {
    await checkForUpdates()
    // JD asks its update server in the background: the answer is there after a moment.
    await new Promise((r) => setTimeout(r, 8000))
    await loadUpdates()
    const res = await fetch(withDevice('/api/update', settingsDevice.value))
    const available = res.ok && (await res.json()).available === true
    showSuccess(available ? `An update for ${deviceName.value} is available (the yellow button in the header installs it).` : `${deviceName.value} is up to date.`)
  } catch (e) {
    showError(`Update check failed: ${e instanceof Error ? e.message : e}`)
  } finally {
    checking.value = false
  }
}

// --- Power ----------------------------------------------------------------------------------------------
const ACTIONS: { id: PowerAction; label: string; icon: unknown; text: string; ask: (name: string) => string }[] = [
  { id: 'restart-jd', label: 'Restart JDownloader', icon: RotateCw, text: 'Closes and starts the JDownloader again.', ask: (n) => `All downloads on ${n} stop and the JDownloader restarts.` },
  { id: 'exit-jd', label: 'Close JDownloader', icon: X, text: 'Closes the JDownloader. It does not come back by itself (one in a container usually does).', ask: (n) => `All downloads on ${n} stop and the JDownloader closes. It may not come back by itself.` },
  { id: 'shutdown', label: 'Shut down the computer', icon: Power, text: 'Shuts down the computer the JDownloader runs on.', ask: (n) => `The computer of ${n} shuts down. Everything running there stops.` },
  { id: 'standby', label: 'Standby', icon: Moon, text: 'Puts the computer to sleep.', ask: (n) => `The computer of ${n} goes to sleep. Downloads stop meanwhile.` },
  { id: 'hibernate', label: 'Hibernate', icon: Snowflake, text: 'Hibernates the computer.', ask: (n) => `The computer of ${n} hibernates. Downloads stop meanwhile.` }
]
const busy = ref(false)
const power = async (a: (typeof ACTIONS)[number]) => {
  if (!(await askConfirm({ title: a.label, message: a.ask(deviceName.value), confirmLabel: a.label, danger: true }))) return
  busy.value = true
  try {
    await powerAction(a.id)
    if (a.id === 'restart-jd') watchUpdate(settingsDevice.value, true)
    else showSuccess(`${a.label}: sent to ${deviceName.value}.`)
  } catch (e) {
    showError(`${a.label} failed: ${e instanceof Error ? e.message : e}`)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <p v-if="systemState === 'error'" class="error">The system information could not be loaded: {{ systemError }}</p>
  <LoadingState v-else-if="!info" text="Loading system information…" />
  <template v-else>
    <section class="card">
      <h3>JDownloader</h3>
      <dl class="facts">
        <div><dt>Version</dt><dd>{{ info.version }} <span class="dim">(core {{ info.coreRevision }})</span></dd></div>
        <div><dt>Running for</dt><dd>{{ duration(info.uptime) }}</dd></div>
        <div><dt>System</dt><dd>{{ info.os || info.osFamily }} {{ info.arch }}<span v-if="info.docker" class="dim"> · container</span></dd></div>
        <div><dt>Java</dt><dd>{{ info.java }}<span v-if="info.javaVendor" class="dim"> · {{ info.javaVendor }}</span></dd></div>
      </dl>
      <div class="meter">
        <span>Memory {{ formatBytes(info.heapUsed) }} of {{ formatBytes(info.heapMax) }}</span>
        <span class="bar"><span :style="{ width: percent(info.heapUsed, info.heapMax) + '%' }"></span></span>
      </div>
      <div class="actions">
        <button type="button" :disabled="checking" @click="check"><RefreshCw :size="15" :class="{ spin: checking }" /> Check for updates now</button>
        <button type="button" :disabled="busy" @click="loadSystemInfo"><RefreshCw :size="15" /> Reload</button>
      </div>
    </section>

    <section v-if="info.storage.length" class="card">
      <h3>Storage</h3>
      <div v-for="s in info.storage" :key="s.path" class="meter">
        <span>{{ s.path }}: {{ formatBytes(s.free) }} free of {{ formatBytes(s.size) }}</span>
        <span class="bar" :class="{ low: percent(s.free, s.size) < 10 }"><span :style="{ width: percent(s.size - s.free, s.size) + '%' }"></span></span>
      </div>
    </section>

    <section class="card">
      <h3>Power</h3>
      <div v-for="a in ACTIONS" :key="a.id" class="power">
        <div class="what">
          <strong>{{ a.label }}</strong>
          <span class="dim">{{ a.text }}</span>
        </div>
        <button type="button" class="danger" :disabled="busy" @click="power(a)"><component :is="a.icon" :size="15" /> {{ a.label }}</button>
      </div>
    </section>
  </template>
</template>

<style scoped>
.dim { color: var(--muted); }
.error { color: #d14343; font-size: 0.85rem; overflow-wrap: anywhere; }
.card { display: grid; gap: 14px; margin-bottom: 12px; padding: 14px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
h3 { margin: 0; font-size: 0.95rem; }
.facts { display: grid; gap: 8px; margin: 0; font-size: 0.85rem; }
.facts div { display: flex; gap: 12px; }
.facts dt { flex: none; width: 90px; color: var(--muted); }
.facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.meter { display: grid; gap: 6px; font-size: 0.85rem; overflow-wrap: anywhere; }
.bar { display: block; height: 6px; background: var(--hover); border-radius: 3px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); }
.bar.low span { background: #d14343; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.power { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.what { display: grid; min-width: 0; flex: 1 1 220px; font-size: 0.85rem; }
button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.danger:hover:not(:disabled) { color: #d14343; border-color: #d14343; }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
