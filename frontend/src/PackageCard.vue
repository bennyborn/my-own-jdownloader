<script setup lang="ts">
import { ChevronRight, Folder, GripVertical, PowerOff } from 'lucide-vue-next'
import { expandedDownloads } from './expandedState'
import { clearHovered, changeTick, openMenu, setHovered, type Target } from './itemActions'
import { computed, onUnmounted, ref, watch } from 'vue'
import { formatBytes, formatEta, formatSpeed } from './format'
import { reorderLocally, useDragReorder } from './dragReorder'
import type { DownloadLink, DownloadPackage } from './types'

const props = defineProps<{ pkg: DownloadPackage }>()

const expanded = ref(expandedDownloads.has(props.pkg.uuid))
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

const pkgTarget = computed<Target>(() => ({
  area: 'downloads',
  kind: 'package',
  id: props.pkg.uuid,
  name: props.pkg.name,
  enabled: props.pkg.enabled,
  running: props.pkg.running,
  saveTo: props.pkg.saveTo
}))
const linkTarget = (l: DownloadLink): Target => ({ area: 'downloads', kind: 'link', id: l.uuid, name: l.name, enabled: l.enabled, running: l.running })

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
watch(changeTick, () => expanded.value && void loadLinks())

watch(
  expanded,
  (open) => {
    clearInterval(timer)
    if (open) {
      expandedDownloads.add(props.pkg.uuid)
      void loadLinks()
      timer = setInterval(loadLinks, 3000)
    } else {
      expandedDownloads.delete(props.pkg.uuid)
    }
  },
  { immediate: true }
)
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <article
    class="package"
    :class="state"
    :draggable="packageDraggable"
    @mouseup="packageDraggable = false"
    @pointerenter="setHovered(pkgTarget)"
    @pointerleave="clearHovered(pkgTarget)"
    @contextmenu="openMenu($event, pkgTarget)"
  >
    <button class="head" :aria-expanded="expanded" @click="expanded = !expanded">
      <GripVertical :size="16" class="grip" title="Drag to reorder" @mousedown.stop="packageDraggable = true" @touchstart.passive="packageDraggable = true" />
      <ChevronRight :size="16" class="chevron" :class="{ open: expanded }" />
      <h2>{{ pkg.name }}</h2>
      <span v-if="!pkg.enabled" class="off"><PowerOff :size="13" /> disabled</span>
      <span v-else class="badge">{{ state }}</span>
    </button>
    <div v-if="pkg.saveTo" class="path" :title="pkg.saveTo"><Folder :size="13" /><span>{{ pkg.saveTo }}</span></div>
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
      <div
        v-for="l in links ?? []"
        :key="l.uuid"
        class="link"
        :class="[stateOf(l), drag.dropClass(l.uuid), { dragging: drag.dragId.value === l.uuid }]"
        :style="{ '--p': percentOf(l.bytesLoaded, l.bytesTotal) + '%' }"
        :title="l.name"
        @pointerenter="setHovered(linkTarget(l))"
        @pointerleave="setHovered(pkgTarget)"
        @contextmenu.stop="openMenu($event, linkTarget(l))"
        draggable="true"
        @dragstart.stop="drag.onDragStart(l.uuid, $event)"
        @dragover.stop="drag.onDragOver(l.uuid, $event)"
        @drop.stop="drag.onDrop($event)"
        @dragend.stop="drag.onDragEnd()"
      >
        <div class="main">
          <span class="name">{{ l.name }}</span>
          <span class="sub">
            <img v-if="l.host" class="hosticon" :src="`/api/icons/${l.host}`" alt="" width="14" height="14" loading="lazy" @error="($event.target as HTMLElement).style.display = 'none'" />
            {{ [l.host, l.status].filter(Boolean).join(' · ') }}
          </span>
        </div>
        <div class="cell size">
          <span>{{ formatBytes(l.bytesTotal) }}</span>
          <span class="sub">{{ l.running ? formatBytes(l.bytesLoaded) + ' loaded' : '' }}</span>
        </div>
        <div class="cell state">
          <span class="badge">{{ l.skipped ? 'skipped' : stateOf(l) }}</span>
          <span class="sub">{{ l.running ? `${formatSpeed(l.speed)} · ${formatEta(l.eta)}` : '' }}</span>
        </div>
        <div class="pbar"><div class="pfill" /><span>{{ percentOf(l.bytesLoaded, l.bytesTotal).toFixed(0) }}%</span></div>
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
.chevron { flex: none; transition: transform 0.15s; color: var(--muted); }
.chevron.open { transform: rotate(90deg); }
.toolbar { display: flex; justify-content: flex-end; }
.path { display: flex; align-items: center; gap: 5px; margin: 2px 0 0 24px; color: var(--muted); font-size: 0.78rem; min-width: 0; }
.path svg { flex: none; }
.path span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.off { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 0.75rem; }
.package:not(.finished):not(.running).disabled { border-style: dashed; }
.grip { cursor: grab; color: var(--muted); user-select: none; }
.dragging { opacity: 0.4; }
.drop-before { box-shadow: 0 -3px 0 var(--accent); }
.drop-after { box-shadow: 0 3px 0 var(--accent); }
.link[draggable=true] { cursor: grab; }
.links { margin-top: 10px; display: grid; }
.link {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 84px 124px 120px;
  align-items: center;
  gap: 14px;
  min-height: 44px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.85rem;
  line-height: 1.3;
}
.link + .link { border-top: 1px solid var(--border); }
.link:hover { background-color: var(--hover); }
.link.disabled { opacity: 0.55; }
.link .main, .link .cell { display: flex; flex-direction: column; min-width: 0; }
.link .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 0.75rem; min-height: 1em; }
.hosticon { vertical-align: -2px; margin-right: 4px; border-radius: 2px; }
.link .size { text-align: right; font-variant-numeric: tabular-nums; }
.link .state { font-variant-numeric: tabular-nums; }
.pbar { position: relative; height: 22px; border-radius: 11px; background: var(--border); overflow: hidden; }
.pfill { position: absolute; inset: 0 auto 0 0; width: var(--p); background: var(--accent); transition: width 0.5s; }
.link.finished .pfill { background: var(--ok); }
.link:not(.running):not(.finished) .pfill { background: var(--muted); }
.pbar span { position: relative; display: block; text-align: center; line-height: 22px; font-size: 0.75rem; font-weight: 600; color: var(--text); mix-blend-mode: normal; }
@media (max-width: 720px) {
  .link { grid-template-columns: minmax(0, 1fr) 90px; }
  .link .size, .link .state { display: none; }
}
</style>
