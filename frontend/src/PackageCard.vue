<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { formatBytes, formatEta, formatSpeed } from './format'
import { reorderLocally, useDragReorder } from './dragReorder'
import type { DownloadLink, DownloadPackage } from './types'

const props = defineProps<{ pkg: DownloadPackage }>()

const expanded = ref(false)
const packageDraggable = ref(false)
const links = ref<DownloadLink[] | null>(null)
const error = ref('')
const moveLink = async (id: number, afterId: number) => {
  if (links.value) links.value = reorderLocally(links.value, (l) => l.uuid, id, afterId)
  try {
    const res = await fetch(`/api/packages/${props.pkg.uuid}/links/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkIds: [id], afterLinkId: afterId })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    error.value = ''
  } catch (e) {
    error.value = `Moving failed: ${e instanceof Error ? e.message : e}`
  }
}
const drag = useDragReorder(() => (links.value ?? []).map((l) => l.uuid), moveLink)

let timer: ReturnType<typeof setInterval> | undefined

const percentOf = (loaded: number, total: number) => (total > 0 ? Math.min(100, (loaded / total) * 100) : 0)
const percent = computed(() => percentOf(props.pkg.bytesLoaded, props.pkg.bytesTotal))
const stateOf = (x: { finished: boolean; running: boolean; enabled: boolean }) =>
  x.finished ? 'finished' : x.running ? 'running' : x.enabled ? 'idle' : 'disabled'
const state = computed(() => stateOf(props.pkg))

const loadLinks = async () => {
  try {
    const res = await fetch(`/api/packages/${props.pkg.uuid}/links`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const fresh = await res.json()
    if (drag.dragId.value === null) links.value = fresh
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

// Links are only fetched (and refreshed) while the package is expanded.
watch(expanded, (open) => {
  clearInterval(timer)
  if (open) {
    void loadLinks()
    timer = setInterval(loadLinks, 3000)
  }
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <article class="package" :class="state" :draggable="packageDraggable" @mouseup="packageDraggable = false">
    <button class="head" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="grip" title="Drag to reorder" @mousedown.stop="packageDraggable = true" @touchstart.passive="packageDraggable = true">⠿</span>
      <span class="chevron" :class="{ open: expanded }">▸</span>
      <h2>{{ pkg.name }}</h2>
      <span class="badge">{{ state }}</span>
    </button>
    <div class="bar"><div class="fill" :style="{ width: percent + '%' }" /></div>
    <div class="row meta">
      <span>{{ formatBytes(pkg.bytesLoaded) }} / {{ formatBytes(pkg.bytesTotal) }} ({{ percent.toFixed(1) }}%)</span>
      <span v-if="pkg.running">{{ formatSpeed(pkg.speed) }} · ETA {{ formatEta(pkg.eta) }}</span>
      <span>{{ pkg.childCount }} links</span>
      <span v-if="pkg.hosts.length">{{ pkg.hosts.join(', ') }}</span>
    </div>
    <div v-if="pkg.status" class="meta status">{{ pkg.status }}</div>

    <div v-if="expanded" class="links">
            <p v-if="error" class="meta">Could not load links: {{ error }}</p>
      <p v-else-if="!links" class="meta">Loading…</p>
      <div v-for="l in links ?? []"
        :key="l.uuid"
        class="link"
        :class="[stateOf(l), drag.dropClass(l.uuid), { dragging: drag.dragId.value === l.uuid }]"
        draggable="true"
        @dragstart.stop="drag.onDragStart(l.uuid, $event)"
        @dragover.stop="drag.onDragOver(l.uuid, $event)"
        @drop.stop="drag.onDrop($event)"
        @dragend.stop="drag.onDragEnd()">
        <div class="row">
          <span class="name">{{ l.name }}</span>
          <span class="badge">{{ l.skipped ? 'skipped' : stateOf(l) }}</span>
        </div>
        <div class="bar small"><div class="fill" :style="{ width: percentOf(l.bytesLoaded, l.bytesTotal) + '%' }" /></div>
        <div class="row meta">
          <span>{{ formatBytes(l.bytesLoaded) }} / {{ formatBytes(l.bytesTotal) }}</span>
          <span v-if="l.running">{{ formatSpeed(l.speed) }} · ETA {{ formatEta(l.eta) }}</span>
          <span v-if="l.host">{{ l.host }}</span>
        </div>
        <div v-if="l.status" class="meta">{{ l.status }}</div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 0;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.head h2 { flex: 1; }
.chevron { display: inline-block; transition: transform 0.15s; color: var(--muted); }
.chevron.open { transform: rotate(90deg); }
.toolbar { display: flex; justify-content: flex-end; }
.grip { cursor: grab; color: var(--muted); user-select: none; }
.dragging { opacity: 0.4; }
.drop-before { box-shadow: 0 -3px 0 var(--accent); }
.drop-after { box-shadow: 0 3px 0 var(--accent); }
.link[draggable=true] { cursor: grab; }
.links { margin-top: 12px; display: grid; gap: 8px; }
.link { padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; }
.link.disabled { opacity: 0.6; }
.name { overflow-wrap: anywhere; font-size: 0.9rem; }
.bar.small { height: 5px; margin: 6px 0; }
</style>
