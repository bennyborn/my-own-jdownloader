<script setup lang="ts">
import { withDevice } from './devices'
import { Clock, Download, Link2, Package, Plus, ShieldCheck } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { formatBytes, formatLongEta, formatSpeed } from './format'
import SpeedGraph, { type SpeedSample } from './SpeedGraph.vue'
import type { DownloadsSnapshot } from './types'
import type { CaptchaJob } from './useCaptchas'

const props = defineProps<{ snapshot: DownloadsSnapshot | null; connected: boolean; solverJobs: CaptchaJob[]; device: string }>()
defineEmits<{ addLinks: [] }>()

const WINDOW_SECONDS = 300

// Speed history for the background graph: prefilled from the backend (which records it all the time),
// then extended with every live update.
const samples = ref<SpeedSample[]>([])
let clockOffset = 0 // browser time minus server time, so both agree on "now"
const addSamples = (added: SpeedSample[]) => {
  const newest = Math.max(0, ...added.map((s) => s.t))
  const cutoff = newest - (WINDOW_SECONDS + 30) * 1000
  samples.value = [...samples.value, ...added].filter((s) => s.t >= cutoff).sort((a, b) => a.t - b.t)
}

// "device" is empty in the overview of all devices: no history to fetch, the graph then only shows live updates.
const prefill = async () => {
  samples.value = []
  if (!props.device) return
  const device = props.device
  try {
    const res = await fetch(withDevice('/api/speed-history', device))
    if (!res.ok || device !== props.device) return
    const data = (await res.json()) as { now: number; samples: SpeedSample[] }
    clockOffset = Date.now() - data.now
    addSamples(data.samples.map((s) => ({ t: s.t + clockOffset, v: s.v })))
  } catch {
    /* the graph then simply starts empty */
  }
}
onMounted(prefill)
watch(() => props.device, prefill)

watch(
  () => props.snapshot?.updatedAt,
  (t) => {
    if (!t || !props.snapshot) return
    addSamples([{ t: t + clockOffset, v: props.snapshot.totalSpeed }])
  }
)

const totals = computed(() => {
  const packages = props.snapshot?.packages ?? []
  const total = packages.reduce((sum, p) => sum + p.bytesTotal, 0)
  const loaded = packages.reduce((sum, p) => sum + p.bytesLoaded, 0)
  const speed = props.snapshot?.totalSpeed ?? 0
  return { total, loaded, speed, eta: speed > 0 ? (total - loaded) / speed : null }
})

</script>

<template>
  <div class="fade" aria-hidden="true" />
  <footer class="statusbar">
    <SpeedGraph :samples="samples" :window-seconds="WINDOW_SECONDS" />
    <button type="button" class="fab" title="Add links" aria-label="Add links" @click="$emit('addLinks')"><Plus :size="24" /></button>
    <div class="content">
      <button type="button" class="add" @click="$emit('addLinks')"><Plus :size="15" /> Add links</button>
      <dl>
        <div>
          <dt>Queue</dt>
          <dd class="icons">
            <span title="Packages"><Package :size="14" />{{ snapshot?.packages.length ?? '–' }}</span>
            <span title="Running downloads"><Download :size="14" />{{ snapshot?.runningDownloads ?? '–' }}</span>
            <span title="Links"><Link2 :size="14" />{{ snapshot?.linkCount ?? '–' }}</span>
          </dd>
        </div>
        <div title="Bytes loaded / total bytes">
          <dt>Loaded</dt>
          <dd>{{ formatBytes(totals.loaded) }} <span class="dim">/ {{ formatBytes(totals.total) }}</span></dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>
            {{ formatSpeed(totals.speed) }}
            <span class="dim eta" title="Finished in"><Clock :size="13" />{{ formatLongEta(totals.eta) }}</span>
          </dd>
        </div>
      </dl>
      <a v-if="solverJobs[0]?.openUrl" class="solve" :href="solverJobs[0].openUrl" target="_blank" rel="noopener" :title="`${solverJobs[0].hoster} waits for a captcha`">
        <ShieldCheck :size="15" /> Solve captcha<span v-if="solverJobs.length > 1" class="count">{{ solverJobs.length }}</span>
      </a>
      <span class="dot" :class="{ on: connected }" :title="connected ? 'connected' : 'disconnected'" />
    </div>
  </footer>
</template>

<style scoped>
.fade {
  position: fixed;
  inset: auto 0 0 0;
  height: calc(200px + var(--tabbar-h, 0px));
  pointer-events: none;
  background: linear-gradient(to top, var(--bg) 35%, transparent);
}
.statusbar {
  z-index: 1;
  position: fixed;
  bottom: calc(24px + var(--tabbar-h, 0px));
  left: 50%;
  transform: translateX(-50%);
  box-sizing: border-box;
  width: min(900px, calc(100% - 32px));
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.content { position: relative; display: flex; align-items: center; gap: 20px; padding: 8px 14px; overflow-x: auto; }
.add { display: inline-flex; align-items: center; gap: 5px; flex: none; background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 8px 12px; font: inherit; cursor: pointer; }
dl { display: flex; flex: 1; gap: 28px; margin: 0; white-space: nowrap; }
dl div { display: flex; flex-direction: column; }
dt { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
dd { display: flex; align-items: center; gap: 10px; margin: 0; font-variant-numeric: tabular-nums; }
.icons span { display: inline-flex; align-items: center; gap: 4px; }
.icons svg { color: var(--muted); }
.solve { display: inline-flex; align-items: center; gap: 5px; flex: none; padding: 8px 12px; background: #d14343; color: #fff; border-radius: 6px; text-decoration: none; white-space: nowrap; animation: pulse 2s ease-in-out infinite; }
.solve .count { min-width: 16px; padding: 0 5px; background: rgba(255, 255, 255, 0.25); border-radius: 999px; font-size: 0.75rem; text-align: center; }
@keyframes pulse { 50% { box-shadow: 0 0 0 4px rgba(209, 67, 67, 0.3); } }
@media (prefers-reduced-motion: reduce) { .solve { animation: none; } }
.fab { display: none; }
/* Phones: two rows instead of a sideways scroll, "Add links" is a round button hanging over the bottom right corner of the bar. */
@media (max-width: 640px) {
  .statusbar { overflow: visible; }
  .content { flex-wrap: wrap; gap: 6px 16px; padding: 10px 40px 10px 14px; overflow: visible; }
  .add { display: none; }
  .fab {
    display: inline-flex; align-items: center; justify-content: center; position: absolute; right: -8px; bottom: -14px;
    width: 48px; height: 48px; padding: 0; background: var(--accent); color: #fff; border: 0; border-radius: 50%;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4); cursor: pointer;
  }
  .solve { order: -1; flex: 1 1 100%; justify-content: center; }
  dl { flex-wrap: wrap; gap: 6px 20px; }
  dl div:last-child { order: -1; flex: 1 1 100%; }
  dl div:last-child dd { font-size: 1.1rem; }
  .dot { position: absolute; top: 12px; right: 14px; }
}
.dim { color: var(--muted); }
.eta { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; }
.dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: #d14343; }
.dot.on { background: var(--ok); }
</style>
