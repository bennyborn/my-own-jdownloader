<script setup lang="ts">
import { toneIcon } from './iconTone'
import { withDevice } from './devices'
import { ChevronRight, Clock, Folder, Gauge, GripVertical, HardDrive, Link2, PowerOff, OctagonPause, Zap } from 'lucide-vue-next'
import { expandedDownloads, linkAnchor, saveExpandedDownloads, selectedDownloadLinks, selectedDownloadPackages, selectedPackagesDevice } from './expandedState'
import { showError } from './toast'
import { clearHovered, changeTick, menuOn, openMenu, setHovered, type Target } from './itemActions'
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import PackageSlot from './PackageSlot.vue'
import { formatBytes, formatLongEta, formatSpeed } from './format'
import { reorderLocally, useDragReorder } from './dragReorder'
import type { DownloadLink, DownloadPackage, Extraction } from './types'

const props = defineProps<{ pkg: DownloadPackage; device?: string }>()

const expanded = ref(expandedDownloads.has(props.pkg.uuid))
const packageDraggable = ref(false)
// Hosts whose icon could not be loaded are shown as text instead.
const brokenIcons = reactive(new Set<string>())
const deviceKey = computed(() => props.device ?? '')
const picked = computed(() => selectedDownloadPackages.value.has(props.pkg.uuid) && selectedPackagesDevice.value === deviceKey.value)
// Marking links: click selects one, ctrl/cmd+click toggles, shift+click selects the range from the last
// click (inside this package). Links and packages are never marked at the same time.
const onLinkClick = (e: MouseEvent, l: DownloadLink) => {
  const next = new Set(selectedDownloadLinks.value)
  const ids = (links.value ?? []).map((x) => x.uuid)
  const anchor = linkAnchor.value
  if (e.shiftKey && anchor && anchor.package === props.pkg.uuid && ids.includes(anchor.link)) {
    if (!(e.ctrlKey || e.metaKey)) next.clear()
    const [from, to] = [ids.indexOf(anchor.link), ids.indexOf(l.uuid)].sort((a, b) => a - b)
    for (const id of ids.slice(from, to + 1)) next.add(id)
  } else if (e.ctrlKey || e.metaKey) {
    if (!next.delete(l.uuid)) next.add(l.uuid)
    linkAnchor.value = { package: props.pkg.uuid, link: l.uuid }
  } else {
    next.clear()
    next.add(l.uuid)
    linkAnchor.value = { package: props.pkg.uuid, link: l.uuid }
  }
  selectedDownloadLinks.value = next
  if (selectedDownloadPackages.value.size) selectedDownloadPackages.value = new Set()
}
// Right-click on a link outside the selection selects just that link, like a file manager.
const onLinkContext = (e: MouseEvent, l: DownloadLink) => {
  if (!selectedDownloadLinks.value.has(l.uuid)) {
    selectedDownloadLinks.value = new Set([l.uuid])
    linkAnchor.value = { package: props.pkg.uuid, link: l.uuid }
  }
  openMenu(e, linkTarget(l))
}

// Ctrl/Cmd+click marks the package (for merging) instead of expanding it; a plain click clears the marks.
const onHeadClick = (e: MouseEvent) => {
  if (e.ctrlKey || e.metaKey) {
    // Marks of another device's list are dropped: an action only ever goes to one device.
    const next = new Set(selectedPackagesDevice.value === deviceKey.value ? selectedDownloadPackages.value : [])
    selectedPackagesDevice.value = deviceKey.value
    if (!next.delete(props.pkg.uuid)) next.add(props.pkg.uuid)
    selectedDownloadPackages.value = next
    if (selectedDownloadLinks.value.size) selectedDownloadLinks.value = new Set()
    return
  }
  if (selectedDownloadPackages.value.size) selectedDownloadPackages.value = new Set()
  if (selectedDownloadLinks.value.size) selectedDownloadLinks.value = new Set()
  expanded.value = !expanded.value
}
const links = ref<DownloadLink[] | null>(null)
const error = ref('')
const moveLink = async (ids: number[], afterId: number) => {
  if (links.value) links.value = reorderLocally(links.value, (l) => l.uuid, ids, afterId)
  try {
    const res = await fetch(withDevice(`/api/packages/${props.pkg.uuid}/links/move`, props.device), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkIds: ids, afterLinkId: afterId })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    error.value = ''
  } catch (e) {
    showError(`Moving failed: ${e instanceof Error ? e.message : e}`)
  }
}
// Dragging a marked link moves all marked links of this package.
const drag = useDragReorder(
  () => (links.value ?? []).map((l) => l.uuid),
  moveLink,
  (id) => (selectedDownloadLinks.value.has(id) ? (links.value ?? []).map((l) => l.uuid).filter((x) => selectedDownloadLinks.value.has(x)) : [id])
)

let timer: ReturnType<typeof setInterval> | undefined

const percentOf = (loaded: number, total: number) => (total > 0 ? Math.min(100, (loaded / total) * 100) : 0)
const percent = computed(() => percentOf(props.pkg.bytesLoaded, props.pkg.bytesTotal))
// Unpacking comes after the download: a finished item is "extracting" / "extracted" / "extract-failed" then.
// JD reports download errors only as status text ("File not found", "An Error occurred!", ...).
const isErrorStatus = (status?: string) => /error|not found|offline|failed|unavailable/i.test(status ?? '')
const stateOf = (x: { finished: boolean; running: boolean; enabled: boolean; extraction?: Extraction; status?: string }) => {
  if (x.finished && x.extraction) return x.extraction === 'done' ? 'extracted' : x.extraction === 'error' ? 'extract-failed' : 'extracting'
  if (!x.running && x.enabled && isErrorStatus(x.status)) return 'download-error'
  return x.finished ? 'finished' : x.running ? 'running' : x.enabled ? 'idle' : 'disabled'
}
const state = computed(() => stateOf(props.pkg))

// Tooltip with JD's full status text; nothing for the plain "Download" of a running download.
const statusTip = (l: DownloadLink): string | undefined => {
  const text = l.status || linkBadge(l).detail
  return !text || (l.running && /^download$/i.test(text.trim())) ? undefined : text
}

// The state shown at the right of a link: what JD reports (captcha, wait time, skipped) replaces the
// raw status text that used to sit next to the host.
const linkBadge = (l: DownloadLink): { kind: string; text: string; detail: string } => {
  const status = l.status ?? ''
  if (l.extraction === 'running' || l.extraction === 'queued') return { kind: 'extracting', text: 'extracting', detail: l.extraction === 'queued' ? 'queued' : '' }
  if (l.extraction === 'error') return { kind: 'extract-failed', text: 'extract failed', detail: status }
  if (l.extraction === 'done') return { kind: 'extracted', text: 'extracted', detail: '' }
  if (l.finished) return { kind: 'finished', text: 'finished', detail: '' }
  if (!l.running && !l.skipped && l.enabled && isErrorStatus(status)) return { kind: 'idle-error', text: 'idle', detail: status }
  if (l.skipped) return { kind: 'skipped', text: 'skipped', detail: status.replace(/^skipped\s*-\s*/i, '') }
  if (l.running) {
    if (/captcha/i.test(status)) return { kind: 'captcha', text: 'captcha', detail: 'waiting for an answer' }
    const wait = /^wait\s+(.+)$/i.exec(status)
    if (wait) return { kind: 'waiting', text: 'waiting', detail: wait[1] }
    return { kind: 'running', text: 'running', detail: `${formatSpeed(l.speed)} · ${formatLongEta(l.eta ?? null)}` }
  }
  const kind = l.enabled ? 'idle' : 'disabled'
  return { kind, text: kind, detail: status }
}

// Force-started links get a bolt before the status, except once they are finished or failed.
const showForced = (l: DownloadLink) => !!l.forced && !l.finished && !['finished', 'extracted', 'extract-failed', 'idle-error'].includes(linkBadge(l).kind) && !isErrorStatus(l.status)

const pkgTarget = computed<Target>(() => ({
  area: 'downloads',
  device: props.device,
  kind: 'package',
  id: props.pkg.uuid,
  name: props.pkg.name,
  enabled: props.pkg.enabled,
  running: props.pkg.running,
  finished: props.pkg.finished,
  stopMarked: props.pkg.stopMarked,
  saveTo: props.pkg.saveTo,
  hostCount: props.pkg.hosts.length,
  mergeIds: picked.value && selectedDownloadPackages.value.size > 1 ? [...selectedDownloadPackages.value] : undefined
}))
const linkTarget = (l: DownloadLink): Target => ({
  area: 'downloads',
  device: props.device,
  kind: 'link',
  id: l.uuid,
  name: l.name,
  enabled: l.enabled,
  running: l.running,
  finished: l.finished,
  stopMarked: l.stopMarked,
  selectedLinkIds: selectedDownloadLinks.value.has(l.uuid) && selectedDownloadLinks.value.size > 1 ? [...selectedDownloadLinks.value] : undefined
})

const loadLinks = async () => {
  try {
    const res = await fetch(withDevice(`/api/packages/${props.pkg.uuid}/links`, props.device))
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
      saveExpandedDownloads()
      void loadLinks()
      timer = setInterval(loadLinks, 3000)
    } else {
      expandedDownloads.delete(props.pkg.uuid)
      saveExpandedDownloads()
    }
  },
  { immediate: true }
)
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <article
    class="package"
    :class="[state, { picked, 'menu-open': menuOn('downloads', 'package', pkg.uuid) }]"
    :draggable="packageDraggable"
    @mouseup="packageDraggable = false"
    @pointerenter="setHovered(pkgTarget)"
    @pointerleave="clearHovered(pkgTarget)"
    @contextmenu="openMenu($event, pkgTarget)"
  >
    <button class="head" :aria-expanded="expanded" @click="onHeadClick">
      <GripVertical :size="16" class="grip" title="Drag to reorder" @mousedown.stop="packageDraggable = true" @touchstart.passive="packageDraggable = true" />
      <ChevronRight :size="16" class="chevron" :class="{ open: expanded }" />
      <h2 :title="pkg.name">{{ pkg.name }}</h2>
      <OctagonPause v-if="pkg.stopMarked" :size="15" class="stopmark" title="Stop mark: JD stops before this package" />
      <span v-if="!pkg.enabled" class="off"><PowerOff :size="13" /> disabled</span>
      <span v-else class="badge">{{ state === 'extract-failed' ? 'extract failed' : state === 'download-error' ? 'error' : state }}</span>
    </button>
    <div v-if="pkg.saveTo" class="path" :title="pkg.saveTo"><Folder :size="13" /><span>{{ pkg.saveTo }}</span></div>
    <div class="bar"><div class="fill" :style="{ width: (state === 'extracting' ? 100 : percent) + '%' }" /></div>
    <div class="row meta">
      <PackageSlot name="package-meta" :pkg="pkg" :device="device">
        <span class="item" title="Loaded / total size">
          <HardDrive :size="14" />{{ formatBytes(pkg.bytesLoaded) }} <span class="dim">/ {{ formatBytes(pkg.bytesTotal) }} ({{ percent.toFixed(1) }}%)</span>
        </span>
        <span v-if="pkg.running" class="item">
          <span class="item" title="Download speed"><Gauge :size="14" />{{ formatSpeed(pkg.speed) }}</span>
          <span class="item" title="Finished in"><Clock :size="14" />{{ formatLongEta(pkg.eta ?? null) }}</span>
        </span>
        <span class="item" title="Links"><Link2 :size="14" />{{ pkg.childCount }}</span>
        <span v-if="pkg.hosts.length" class="hosts">
          <template v-for="h in pkg.hosts" :key="h">
            <img v-if="!brokenIcons.has(h)" class="hosticon" :class="{ idle: pkg.hosts.length > 1 && pkg.activeHosts.length > 0 && !pkg.activeHosts.includes(h) }" :src="`/api/icons/${h}`" :title="h" :alt="h" width="16" height="16" loading="lazy" @load="toneIcon" @error="brokenIcons.add(h)" />
            <span v-else>{{ h }}</span>
          </template>
        </span>
      </PackageSlot>
    </div>

    <!-- Block for plugins: a column at the right edge of the card (empty unless a plugin fills it). -->
    <div class="pkg-aside"><PackageSlot name="package-aside" :pkg="pkg" :device="device" /></div>

    <div v-if="expanded" class="links">
            <p v-if="error" class="meta">Could not load links: {{ error }}</p>
      <p v-else-if="!links" class="meta">Loading…</p>
      <div
        v-for="l in links ?? []"
        :key="l.uuid"
        class="link"
        :class="[stateOf(l), drag.dropClass(l.uuid), { dragging: drag.dragId.value === l.uuid, picked: selectedDownloadLinks.has(l.uuid), 'menu-open': menuOn('downloads', 'link', l.uuid) }]"
        :style="{ '--p': percentOf(l.bytesLoaded, l.bytesTotal) + '%' }"
        :title="l.name"
        @pointerenter="setHovered(linkTarget(l))"
        @pointerleave="setHovered(pkgTarget)"
        @contextmenu.stop="onLinkContext($event, l)"
        @click="onLinkClick($event, l)"
        draggable="true"
        @dragstart.stop="drag.onDragStart(l.uuid, $event)"
        @dragover.stop="drag.onDragOver(l.uuid, $event)"
        @drop.stop="drag.onDrop($event)"
        @dragend.stop="drag.onDragEnd()"
      >
        <div class="main">
          <span class="name" :title="l.name">{{ l.name }}</span>
          <span class="sub">
            <img v-if="l.host" class="hosticon" :src="`/api/icons/${l.host}`" alt="" width="14" height="14" loading="lazy" @load="toneIcon" @error="($event.target as HTMLElement).style.display = 'none'" />
            {{ l.host }}
          </span>
        </div>
        <div class="cell size">
          <span>{{ formatBytes(l.bytesTotal) }}</span>
          <span class="sub">{{ l.running ? formatBytes(l.bytesLoaded) + ' loaded' : '' }}</span>
        </div>
        <div class="cell state" :title="statusTip(l)">
          <span class="badge" :class="linkBadge(l).kind"><OctagonPause v-if="l.stopMarked" :size="12" class="stopmark" aria-label="Stop mark" /><Zap v-if="showForced(l)" :size="12" class="forced" aria-label="Force-started" />{{ linkBadge(l).text }}</span>
          <span class="sub">{{ linkBadge(l).detail }}</span>
        </div>
        <div class="pbar"><div class="pfill" /><span>{{ stateOf(l) === 'extracting' ? 'unpacking' : percentOf(l.bytesLoaded, l.bytesTotal).toFixed(0) + '%' }}</span></div>
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
.download-error .head h2 { color: #d14343; }
.head h2 { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chevron { flex: none; transition: transform 0.15s; color: var(--muted); }
.chevron.open { transform: rotate(90deg); }
.toolbar { display: flex; justify-content: flex-end; }
.path { display: flex; align-items: center; gap: 5px; margin: 2px 0 0 24px; color: var(--muted); font-size: 0.78rem; min-width: 0; }
.path svg { flex: none; }
.path span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.off { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 0.75rem; }
.link .badge.captcha, .link .badge.skipped { color: #e0a030; }
.link .badge.waiting { color: var(--muted); }
.head .stopmark { flex: none; color: #e0a030; }
.link .badge .stopmark { margin-right: 4px; vertical-align: -1px; color: #e0a030; }
.link .badge .forced { margin-right: 4px; vertical-align: -1px; color: #e0a030; }
.link .badge.extracting { color: var(--extract-text); }
.link .badge.extracted { color: var(--ok); }
.link .badge.extract-failed, .link .badge.idle-error { color: #d14343; }
.meta.row { align-items: center; }
.item { display: inline-flex; align-items: center; gap: 5px; }
.item .item { gap: 5px; margin-right: 12px; }
.item .item:last-child { margin-right: 0; }
.dim { color: var(--muted); }
.hosts { display: inline-flex; align-items: center; gap: 8px; }
.hosticon { border-radius: 3px; transition: opacity 0.3s; }
.hosticon.idle { opacity: 0.3; }
.package.picked { outline: 2px solid var(--accent); outline-offset: -1px; }
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
.link { user-select: none; }
.link:hover, .link.menu-open { background-color: var(--hover); }
.link.picked { background-color: color-mix(in srgb, var(--accent) 14%, transparent); }
.package.menu-open { border-color: var(--accent); }
.link.disabled { opacity: 0.55; }
.link .main, .link .cell { display: flex; flex-direction: column; min-width: 0; }
.link .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 0.75rem; min-height: 1em; }
.hosticon { vertical-align: -2px; margin-right: 4px; border-radius: 2px; }
.link .size { text-align: right; font-variant-numeric: tabular-nums; }
.link .state { font-variant-numeric: tabular-nums; }
.pbar { position: relative; height: 22px; border-radius: 11px; background: var(--border); overflow: hidden; }
.pfill { position: absolute; inset: 0 auto 0 0; width: var(--p); background: var(--accent); transition: width 0.5s; }
.link.finished .pfill, .link.extracted .pfill { background: var(--ok); }
.link.extracting .pfill { width: 100%; background: var(--extract); }
.link.extracting .pbar span { color: #1a1a1a; }
.link.extract-failed .pfill { background: #d14343; }
.link:not(.running):not(.finished):not(.extracting):not(.extracted):not(.extract-failed) .pfill { background: var(--muted); }
.pbar span { position: relative; display: block; text-align: center; line-height: 22px; font-size: 0.75rem; font-weight: 600; color: var(--text); mix-blend-mode: normal; }
@media (max-width: 720px) {
  .link { grid-template-columns: minmax(0, 1fr) 90px; }
  .link .size, .link .state { display: none; }
}
</style>

<!-- Not scoped: the contents of the aside block come from plugins. -->
<style>
.package:has(> .pkg-aside > *), .gpackage:has(> .pkg-aside > *) { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 14px; }
.package:has(> .pkg-aside > *) > *, .gpackage:has(> .pkg-aside > *) > * { grid-column: 1; }
.package:has(> .pkg-aside > *) > .pkg-aside, .gpackage:has(> .pkg-aside > *) > .pkg-aside { grid-column: 2; grid-row: 1 / span 4; align-self: start; }
.package:has(> .pkg-aside > *) > .links, .gpackage:has(> .pkg-aside > *) > .glinks { grid-column: 1 / -1; }
.pkg-aside:not(:has(> *)) { display: none; }
</style>
