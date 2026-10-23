<script setup lang="ts">
import { computed } from 'vue'
import { formatBytes, formatLongEta, formatSpeed } from './format'
import type { DownloadsSnapshot } from './types'

const props = defineProps<{ snapshot: DownloadsSnapshot | null; connected: boolean }>()

const totals = computed(() => {
  const packages = props.snapshot?.packages ?? []
  const total = packages.reduce((sum, p) => sum + p.bytesTotal, 0)
  const loaded = packages.reduce((sum, p) => sum + p.bytesLoaded, 0)
  const speed = props.snapshot?.totalSpeed ?? 0
  return { total, loaded, speed, eta: speed > 0 ? (total - loaded) / speed : null }
})

const metrics = computed(() => [
  ['Packages', String(props.snapshot?.packages.length ?? '–')],
  ['Total bytes', formatBytes(totals.value.total)],
  ['Bytes loaded', formatBytes(totals.value.loaded)],
  ['Running downloads', String(props.snapshot?.runningDownloads ?? '–')],
  ['Links', String(props.snapshot?.linkCount ?? '–')],
  ['Speed', formatSpeed(totals.value.speed)],
  ['Finished in', formatLongEta(totals.value.eta)]
])
</script>

<template>
  <footer class="statusbar">
    <button type="button" class="grabber" disabled title="Coming soon">Linkgrabber</button>
    <dl>
      <div v-for="[label, value] in metrics" :key="label">
        <dt>{{ label }}</dt>
        <dd>{{ value }}</dd>
      </div>
    </dl>
    <span class="dot" :class="{ on: connected }" :title="connected ? 'connected' : 'disconnected'" />
  </footer>
</template>

<style scoped>
.statusbar {
  position: fixed;
  inset: auto 0 0 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: var(--card);
  border-top: 1px solid var(--border);
  overflow-x: auto;
}
dl { display: flex; gap: 20px; margin: 0; flex: 1; }
dl div { display: flex; flex-direction: column; white-space: nowrap; }
dt { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; }
dd { margin: 0; font-variant-numeric: tabular-nums; }
.grabber {
  background: var(--accent);
  color: #fff;
  border: 0;
  border-radius: 6px;
  padding: 8px 12px;
  font: inherit;
}
.grabber:disabled { opacity: 0.5; }
.dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: #d14343; }
.dot.on { background: var(--ok); }
</style>
