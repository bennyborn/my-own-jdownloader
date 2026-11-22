<script setup lang="ts">
import { vMarquee } from './marquee'
import { coarsePointer, longPress } from './longPress'
import { toneIcon } from './iconTone'
import { withDevice } from './devices'
import { ChevronRight, GripVertical, CircleCheck, CircleHelp, CircleX, Folder, Inbox, PowerOff, Loader, PackagePlus, Trash2, X } from '@lucide/vue'
import { computed, onUnmounted, ref, watch, watchEffect } from 'vue'
import { askConfirm } from './confirm'
import { inMergeZone, useDragReorder } from './dragReorder'
import { endCrossDrag, startCrossDrag } from './crossDeviceDrag'
import { addPending, reorderOp, withPending, type PendingOp } from './pendingOps'
import { expandedGrabber } from './expandedState'
import { formatBytes } from './format'
import PackageSlot from './PackageSlot.vue'
import { matchesActiveFilters } from './plugins'
import LoadingState from './LoadingState.vue'
import { showError } from './toast'
import PriorityMark from './PriorityMark.vue'
import { clearHovered, menuOn, movedTick, openMenu, setHovered, setMarked, type Target } from './itemActions'
import type { GrabberLink, GrabberPackage, GrabberState } from './types'

// device: the device this list belongs to (the overview shows several lists); compact: a short note instead of the big empty state.
const props = defineProps<{ state: GrabberState | null; analysing: boolean; device?: string; compact?: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const selected = ref<Set<number>>(new Set()) // selected link uuids
const hostFilter = ref<Set<string>>(new Set())
const extFilter = ref<Set<string>>(new Set())
const busy = ref(false)
let lastClicked: number | null = null // anchor for shift+click range selection

// What JD has not confirmed yet is shown anyway (pendingOps.ts).
const scope = computed(() => `gb:${props.device ?? ''}`)
const livePackages = computed(() => withPending(scope.value, props.state?.packages ?? []))
const allLinks = computed(() => livePackages.value.flatMap((p) => p.links))

const NO_EXT = '(none)'
const extOf = (l: GrabberLink) => {
  const dot = l.name.lastIndexOf('.')
  const ext = dot > 0 ? l.name.slice(dot + 1).toLowerCase() : ''
  return ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext) ? ext : NO_EXT
}
// Packages whose links are all selected count as "marked packages" (merge candidates).
const markedPackageIds = () => packages.value.filter((p) => p.links.length && selectionState(p.links) === 'all').map((p) => p.uuid)
const packageTarget = (p: { uuid: number; name: string; enabled: boolean; saveTo?: string; priority?: string }): Target => ({
  area: 'linkgrabber',
  device: props.device,
  kind: 'package',
  id: p.uuid,
  name: p.name,
  enabled: p.enabled,
  saveTo: p.saveTo,
  priority: p.priority,
  // unfiltered, so the host filter does not hide the other hosts
  hostCount: new Set(allLinks.value.filter((l) => l.packageUUID === p.uuid).map((l) => l.host)).size,
  mergeIds: markedPackageIds().includes(p.uuid) && markedPackageIds().length > 1 ? markedPackageIds() : undefined,
  selectedLinkIds: markedPackageIds().includes(p.uuid) && selected.value.size > 1 ? [...selected.value] : undefined
})
const linkTarget = (l: GrabberLink): Target => ({
  area: 'linkgrabber',
  device: props.device,
  kind: 'link',
  id: l.uuid,
  name: l.name,
  enabled: l.enabled,
  priority: l.priority,
  hasVariants: !!l.variant,
  variantId: l.variant?.id,
  selectedLinkIds: selected.value.has(l.uuid) && selected.value.size > 1 ? [...selected.value] : undefined
})
// The first ticked link is what F2 and Del act on while the mouse is elsewhere (with several ticked, linkTarget carries all of them).
const markKey = Symbol('linkgrabber')
watchEffect(() => {
  const link = allLinks.value.find((l) => selected.value.has(l.uuid))
  setMarked(markKey, link ? linkTarget(link) : null)
})
onUnmounted(() => setMarked(markKey, null))
const countBy = (links: GrabberLink[], availability: string) => links.filter((l) => l.availability === availability).length
const hasOffline = (p: { links: GrabberLink[] }) => p.links.some((l) => l.availability === 'OFFLINE')
const isPackageDisabled = (p: { enabled: boolean; links: GrabberLink[] }) => !p.enabled || (p.links.length > 0 && p.links.every((l) => !l.enabled))
const hostOf = (l: GrabberLink) => l.host || 'unknown'

const matchesHost = (l: GrabberLink) => !hostFilter.value.size || hostFilter.value.has(hostOf(l))
const matchesExt = (l: GrabberLink) => !extFilter.value.size || extFilter.value.has(extOf(l))

// Packages reduced to the links that pass the filters (empty packages are hidden).
const packages = computed(() =>
  livePackages.value
    .map((p) => ({ ...p, links: p.links.filter((l) => matchesHost(l) && matchesExt(l) && matchesActiveFilters('linkgrabber', l.name)) }))
    .filter((p) => p.links.length)
)
const visibleLinks = computed(() => packages.value.flatMap((p) => p.links))
const filtersActive = computed(() => hostFilter.value.size > 0 || extFilter.value.size > 0)

// Faceted chips: host counts respect the extension filter and vice versa; active chips always stay visible.
const facet = (links: GrabberLink[], key: (l: GrabberLink) => string, active: Set<string>) => {
  const counts = new Map<string, number>()
  for (const l of links) counts.set(key(l), (counts.get(key(l)) ?? 0) + 1)
  for (const a of active) if (!counts.has(a)) counts.set(a, 0)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
const hostChips = computed(() => facet(allLinks.value.filter(matchesExt), hostOf, hostFilter.value))
const extChips = computed(() => facet(allLinks.value.filter(matchesHost), extOf, extFilter.value))

const toggleFilter = (kind: 'host' | 'ext', value: string) => {
  const target = kind === 'host' ? hostFilter : extFilter
  const next = new Set(target.value)
  if (!next.delete(value)) next.add(value)
  target.value = next
}
const clearFilters = () => {
  hostFilter.value = new Set()
  extFilter.value = new Set()
}

// Forget open packages that are gone from this list. The open state is shared by all lists (the overview shows
// one per device), so only packages this list knew before are dropped, never those of other devices.
let knownPackages = new Set<number>()
watch(
  () => props.state?.packages,
  (list) => {
    if (!list) return
    const ids = new Set(list.map((p) => p.uuid))
    const gone = [...knownPackages].filter((id) => !ids.has(id))
    knownPackages = ids
    if (gone.some((id) => expandedGrabber.value.has(id))) expandedGrabber.value = new Set([...expandedGrabber.value].filter((id) => !gone.includes(id)))
  },
  { immediate: true }
)

// Selection only ever covers visible links, so hidden links are never moved or removed by accident.
watch(visibleLinks, (links) => {
  const visible = new Set(links.map((l) => l.uuid))
  if ([...selected.value].some((id) => !visible.has(id))) selected.value = new Set([...selected.value].filter((id) => visible.has(id)))
})

const setSelected = (ids: number[], on: boolean) => {
  const next = new Set(selected.value)
  for (const id of ids) on ? next.add(id) : next.delete(id)
  selected.value = next
}
// Click on a link row: shift+click selects the range from the last clicked link.
const onLinkClick = (event: MouseEvent, l: GrabberLink) => {
  const on = !selected.value.has(l.uuid)
  const list = visibleLinks.value
  const from = lastClicked === null ? -1 : list.findIndex((x) => x.uuid === lastClicked)
  const to = list.findIndex((x) => x.uuid === l.uuid)
  if (event.shiftKey && from !== -1 && to !== -1) {
    setSelected(list.slice(Math.min(from, to), Math.max(from, to) + 1).map((x) => x.uuid), on)
  } else {
    setSelected([l.uuid], on)
  }
  lastClicked = l.uuid
}
const selectionState = (links: GrabberLink[]) => {
  const count = links.filter((l) => selected.value.has(l.uuid)).length
  return count === 0 ? 'none' : count === links.length ? 'all' : 'some'
}
const togglePackage = (links: GrabberLink[]) => setSelected(links.map((l) => l.uuid), selectionState(links) !== 'all')
const toggleExpanded = (id: number) => {
  const next = new Set(expandedGrabber.value)
  if (!next.delete(id)) next.add(id)
  expandedGrabber.value = next
}

// Manual reordering: packages by their grip, links within their own package.
const post = async (url: string, body: unknown, op?: PendingOp<GrabberPackage>) => {
  const cancel = op ? addPending(scope.value, op) : undefined
  try {
    const res = await fetch(withDevice(url, props.device), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    emit('changed')
  } catch (e) {
    cancel?.()
    showError(`Moving failed: ${e instanceof Error ? e.message : e}`)
  }
}
const draggablePackage = ref<number | null>(null)
const packageDrag = useDragReorder(
  () => packages.value.map((p) => p.uuid),
  (ids, afterId) => void post('/api/linkgrabber/packages/move', { packageIds: ids, afterPackageId: afterId }, reorderOp<GrabberPackage>((p) => p.uuid, ids, afterId)),
  (id) => (markedPackageIds().includes(id) ? markedPackageIds() : [id])
)
let linkDragPackage: number | null = null
const linkDrag = useDragReorder(
  () => packages.value.find((p) => p.uuid === linkDragPackage)?.links.map((l) => l.uuid) ?? [],
  (ids, afterId) => {
    const packageId = linkDragPackage
    const inPackage = reorderOp<GrabberLink>((l) => l.uuid, ids, afterId)
    void post(`/api/linkgrabber/packages/${packageId}/links/move`, { linkIds: ids, afterLinkId: afterId }, (list) => {
      let changed = false
      const out = list.map((p) => {
        if (p.uuid !== packageId) return p
        const links = inPackage(p.links)
        if (!links) return p
        changed = true
        return { ...p, links }
      })
      return changed ? out : null
    })
  },
  (id) => (selected.value.has(id) ? (packages.value.find((p) => p.uuid === linkDragPackage)?.links ?? []).map((l) => l.uuid).filter((x) => selected.value.has(x)) : [id])
)
const onLinkDragStart = (packageId: number, linkId: number, event: DragEvent) => {
  linkDragPackage = packageId
  linkDrag.onDragStart(linkId, event)
}
// Package that currently receives the dragged links / packages (move into it / merge), as opposed to reordering.
const intoId = ref<number | null>(null)
const onLinkDragOver = (packageId: number, linkId: number, event: DragEvent) => {
  if (linkDrag.dragId.value === null) return
  if (packageId === linkDragPackage) {
    intoId.value = null
    linkDrag.onDragOver(linkId, event)
  } else {
    event.preventDefault()
    intoId.value = packageId
  }
}
const endDrag = () => {
  intoId.value = null
  linkDrag.onDragEnd()
  packageDrag.onDragEnd()
  endCrossDrag()
}
// Only in the "all devices" overview (props.device set) is there another device's list to drop onto.
const onPackageDragStart = (p: { uuid: number; name: string }, event: DragEvent) => {
  packageDrag.onDragStart(p.uuid, event)
  if (props.device) startCrossDrag({ area: 'linkgrabber', device: props.device, packageId: p.uuid, name: p.name, hasProgress: false })
}
// Dragged links: the selection when the dragged link is part of it, else just that link.
const draggedLinkIds = () => {
  const id = linkDrag.dragId.value
  if (id === null) return []
  return selected.value.has(id) ? allLinks.value.filter((l) => selected.value.has(l.uuid)).map((l) => l.uuid) : [id]
}
const dropInto = async (packageId: number) => {
  const linkIds = linkDrag.dragId.value !== null ? draggedLinkIds() : []
  const merging = linkDrag.dragId.value === null ? mergeSources().filter((id) => id !== packageId) : []
  endDrag()
  if (linkIds.length) {
    const moving = new Set(linkIds)
    await post('/api/linkgrabber/links/move-to-package', { destPackageId: packageId, linkIds }, (list) => {
      const moved = list.flatMap((p) => p.uuid === packageId ? [] : p.links.filter((l) => moving.has(l.uuid)))
      if (!moved.length) return null
      return list
        .map((p) => p.uuid === packageId ? { ...p, links: [...p.links, ...moved], childCount: p.childCount + moved.length } : { ...p, links: p.links.filter((l) => !moving.has(l.uuid)) })
        .filter((p) => p.uuid === packageId || p.links.length)
    })
  } else if (merging.length) {
    const sources = new Set(merging)
    await post('/api/linkgrabber/merge', { destPackageId: packageId, packageIds: merging }, (list) => {
      const gone = list.filter((p) => sources.has(p.uuid))
      if (!gone.length) return null
      const links = gone.flatMap((p) => p.links)
      return list
        .filter((p) => !sources.has(p.uuid))
        .map((p) => p.uuid === packageId ? { ...p, links: [...p.links, ...links], childCount: p.childCount + links.length, bytesTotal: p.bytesTotal + gone.reduce((n, g) => n + g.bytesTotal, 0) } : p)
    })
  }
}
const mergeSources = () => {
  const id = packageDrag.dragId.value
  return id === null ? [] : markedPackageIds().includes(id) ? markedPackageIds() : [id]
}
const onLinkDrop = (packageId: number, event: DragEvent) => {
  if (intoId.value !== null && packageId !== linkDragPackage) {
    event.preventDefault()
    void dropInto(packageId)
  } else linkDrag.onDrop(event)
}
// Package card: dragged links go into it; a dragged package is merged into it when dropped anywhere except the
// top and bottom edge zone of the card, which reorder.
const onPackageDragOver = (p: { uuid: number }, event: DragEvent) => {
  if (linkDrag.dragId.value !== null) {
    if (p.uuid === linkDragPackage) return
    event.preventDefault()
    intoId.value = p.uuid
    return
  }
  if (packageDrag.dragId.value === null) return
  if (inMergeZone(event) && !mergeSources().includes(p.uuid)) {
    event.preventDefault()
    intoId.value = p.uuid
    packageDrag.overId.value = null
  } else {
    intoId.value = null
    packageDrag.onDragOver(p.uuid, event)
  }
}
const onPackageDrop = (p: { uuid: number }, event: DragEvent) => {
  if (intoId.value === p.uuid) {
    event.preventDefault()
    void dropInto(p.uuid)
  } else packageDrag.onDrop(event)
}

const allState = computed(() => selectionState(visibleLinks.value))
const selectOnline = () => (selected.value = new Set(visibleLinks.value.filter((l) => l.availability === 'ONLINE').map((l) => l.uuid)))
const checkboxState = (el: HTMLInputElement | null, state: string) => {
  if (el) el.indeterminate = state === 'some'
}

const act = async (route: 'move-to-downloads' | 'remove') => {
  busy.value = true
  try {
    const res = await fetch(withDevice(`/api/linkgrabber/${route}`, props.device), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkIds: [...selected.value] })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    selected.value = new Set()
    if (route === 'move-to-downloads') movedTick.value++
    emit('changed')
  } catch (e) {
    showError(`Failed: ${e instanceof Error ? e.message : e}`)
  } finally {
    busy.value = false
  }
}
const moveSelected = async () => {
  const n = selected.value.size
  if (!n) return
  const ok = await askConfirm({ title: 'Add to downloads', message: `${n} link${n === 1 ? '' : 's'} will be moved to the download list.`, confirmLabel: 'Add to downloads' })
  if (ok) void act('move-to-downloads')
}
const removeSelected = async () => {
  const n = selected.value.size
  if (!n) return
  const ok = await askConfirm({ title: 'Remove links', message: `${n} link${n === 1 ? '' : 's'} will be removed from the linkgrabber.`, confirmLabel: 'Remove', danger: true })
  if (ok) void act('remove')
}
</script>

<template>
  <section class="grabber">
    <div v-if="allLinks.length || analysing" class="toolbar">
      <label class="check">
        <input type="checkbox" :checked="allState === 'all'" :ref="(el) => checkboxState(el as HTMLInputElement, allState)" :disabled="!visibleLinks.length" @change="togglePackage(visibleLinks)" />
        {{ filtersActive ? 'All shown' : 'All' }}
      </label>
      <button type="button" :disabled="!visibleLinks.length" @click="selectOnline"><CircleCheck :size="14" /> Select online</button>
      <span class="spacer" />
      <button type="button" class="danger" :disabled="busy || !selected.size" @click="removeSelected"><Trash2 :size="14" /> Remove</button>
      <button type="button" class="primary" :disabled="busy || !selected.size" @click="moveSelected"><PackagePlus :size="14" /> To downloads ({{ selected.size }})</button>
    </div>

    <div v-if="allLinks.length" class="filters">
      <div v-if="hostChips.length > 1 || hostFilter.size" class="chips">
        <span class="label">Host</span>
        <button v-for="[host, count] in hostChips" :key="host" type="button" class="chip" :class="{ on: hostFilter.has(host) }" @click="toggleFilter('host', host)">
          <img class="hosticon" :src="`/api/icons/${host}`" alt="" width="14" height="14" @load="toneIcon" @error="($event.target as HTMLElement).style.display = 'none'" />
          {{ host }} <span class="n">{{ count }}</span>
        </button>
      </div>
      <div v-if="extChips.length > 1 || extFilter.size" class="chips">
        <span class="label">Type</span>
        <button v-for="[ext, count] in extChips" :key="ext" type="button" class="chip" :class="{ on: extFilter.has(ext) }" @click="toggleFilter('ext', ext)">
          {{ ext === NO_EXT ? ext : '.' + ext }} <span class="n">{{ count }}</span>
        </button>
      </div>
      <button v-if="filtersActive" type="button" class="clear" @click="clearFilters"><X :size="13" /> Clear filters</button>
    </div>

    <LoadingState v-if="!state" variant="page" text="Loading the linkgrabber…" />
    <p v-else-if="!allLinks.length && !analysing && compact" class="muted">The linkgrabber is empty.</p>
    <div v-else-if="!allLinks.length && !analysing" class="empty">
      <Inbox :size="72" :stroke-width="1.25" />
      <p>The linkgrabber is empty</p>
      <span class="muted">Add links to see them here.</span>
    </div>
    <p v-else-if="!packages.length && allLinks.length" class="muted">No links match the filters.</p>

    <article
      v-for="p in packages"
      :key="p.uuid"
      class="gpackage"
      :data-item="`linkgrabber:package:${p.uuid}`"
      :class="[{ 'menu-open': menuOn('linkgrabber', 'package', p.uuid), disabled: isPackageDisabled(p), 'has-offline': hasOffline(p), dragging: packageDrag.dragId.value === p.uuid, 'drop-into': intoId === p.uuid }, packageDrag.dropClass(p.uuid)]"
      :draggable="draggablePackage === p.uuid"
      @mouseup="draggablePackage = null"
      @dragstart="onPackageDragStart(p, $event)"
      @dragover="onPackageDragOver(p, $event)"
      @dragleave="intoId === p.uuid && !($event.currentTarget as HTMLElement).contains($event.relatedTarget as Node) && (intoId = null)"
      @drop="onPackageDrop(p, $event)"
      @dragend="endDrag(); draggablePackage = null"
      @pointerenter="setHovered(packageTarget(p))"
      @pointerleave="clearHovered(packageTarget(p))"
      @contextmenu="openMenu($event, packageTarget(p))"
      @pointerdown="longPress($event, () => openMenu($event, packageTarget(p)))"
      @touchend="draggablePackage = null"
      @touchcancel="draggablePackage = null"
    >
      <div class="head">
        <GripVertical :size="16" class="grip" title="Drag to reorder, drop on another package to merge (top and bottom edge: place before / after)" @mousedown.stop="draggablePackage = p.uuid" @touchstart.passive="draggablePackage = p.uuid" />
        <input type="checkbox" :checked="selectionState(p.links) === 'all'" :ref="(el) => checkboxState(el as HTMLInputElement, selectionState(p.links))" @change="togglePackage(p.links)" />
        <button type="button" class="name" :title="p.name" @click="toggleExpanded(p.uuid)">
          <ChevronRight :size="16" class="chevron" :class="{ open: expandedGrabber.has(p.uuid) }" /><span class="pname">{{ p.name }}</span>
        </button>
        <PriorityMark :priority="p.priority" />
        <span v-if="isPackageDisabled(p)" class="off"><PowerOff :size="13" /> disabled</span>
        <span class="muted summary">{{ countBy(p.links, 'ONLINE') }} online · {{ countBy(p.links, 'OFFLINE') }} offline<template v-if="countBy(p.links, 'UNKNOWN')"> · {{ countBy(p.links, 'UNKNOWN') }} unchecked</template> · {{ formatBytes(p.links.reduce((sum, l) => sum + l.bytesTotal, 0)) }}</span>
      </div>
      <div v-if="p.saveTo" class="path" :title="p.saveTo"><Folder :size="13" /><span>{{ p.saveTo }}</span></div>
      <div class="pkg-aside"><PackageSlot name="package-aside" :pkg="p" area="linkgrabber" :device="device" /></div>
      <div v-if="expandedGrabber.has(p.uuid)" class="glinks">
        <div
          v-for="l in p.links"
          :key="l.uuid"
          class="glink"
          :data-item="`linkgrabber:link:${l.uuid}`"
          @pointerenter="setHovered(linkTarget(l))"
          @pointerleave="setHovered(packageTarget(p))"
          @contextmenu.stop="openMenu($event, linkTarget(l))"
          :class="[{ disabled: !l.enabled, checking: analysing && l.availability === 'UNKNOWN', picked: selected.has(l.uuid), 'menu-open': menuOn('linkgrabber', 'link', l.uuid), dragging: linkDrag.dragId.value === l.uuid }, linkDrag.dropClass(l.uuid)]"
          :draggable="!coarsePointer"
          @pointerdown.stop="longPress($event, () => openMenu($event, linkTarget(l)))"
          @dragstart.stop="onLinkDragStart(p.uuid, l.uuid, $event)"
          @dragover="linkDrag.dragId.value !== null && ($event.stopPropagation(), onLinkDragOver(p.uuid, l.uuid, $event))"
          @drop="linkDrag.dragId.value !== null && ($event.stopPropagation(), onLinkDrop(p.uuid, $event))"
          @dragend.stop="endDrag()"
          :title="l.url"
          @click="onLinkClick($event, l)"
        >
          <input type="checkbox" :checked="selected.has(l.uuid)" @click.stop="onLinkClick($event, l)" />
          <span class="lcell">
            <span v-marquee="selected.has(l.uuid)" class="lname" :title="l.name">{{ l.name }}</span>
            <PriorityMark :priority="l.priority" :size="13" />
            <span v-if="l.variant" class="variant" :title="`Variant: ${l.variant.name}`">{{ l.variant.name }}</span>
          </span>
          <span class="muted host">{{ l.host }}</span>
          <span class="muted num">{{ formatBytes(l.bytesTotal) }}</span>
          <span class="avail" :class="l.availability.toLowerCase()" :title="l.availability.toLowerCase()">
            <CircleCheck v-if="l.availability === 'ONLINE'" :size="16" />
            <CircleX v-else-if="l.availability === 'OFFLINE'" :size="16" />
            <Loader v-else-if="analysing && l.availability === 'UNKNOWN'" :size="16" class="spin" />
            <CircleHelp v-else :size="16" />
          </span>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.grabber { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }
.toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.spacer { flex: 1; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 55vh; color: var(--muted); text-align: center; }
.empty p { margin: 8px 0 0; font-size: 1.1rem; color: var(--text); }
.muted { color: var(--muted); font-size: 0.85rem; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--card);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 14px;
  font: inherit;
  cursor: pointer;
}
button:disabled { opacity: 0.45; cursor: default; }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
button.danger { color: #d14343; }
.check { display: inline-flex; align-items: center; gap: 6px; }

.filters { display: grid; gap: 12px; }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.label { width: 44px; color: var(--muted); font-size: 0.75rem; text-transform: uppercase; }
.chip { border-radius: 999px; padding: 4px 12px; font-size: 0.8rem; }
.chip .n { color: var(--muted); font-variant-numeric: tabular-nums; }
.chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.chip.on .n { color: rgba(255, 255, 255, 0.8); }
.hosticon { border-radius: 2px; }
.clear { justify-self: start; background: none; border: 0; color: var(--accent); padding: 0; font-size: 0.8rem; }

.gpackage.disabled { opacity: 0.55; border-style: dashed; }
.off { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 0.75rem; }
.gpackage { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px 18px; }
.head { display: flex; align-items: center; gap: 12px; }
.head .name { display: flex; align-items: center; flex: 1; min-width: 0; border: 0; padding: 0; background: none; font-weight: 600; text-align: left; }
.has-offline .pname, .has-offline .summary { color: #d14343; }
.pname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.path { display: flex; align-items: center; gap: 6px; margin: 8px 0 0 28px; color: var(--muted); font-size: 0.78rem; min-width: 0; }
.path svg { flex: none; }
.path span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grip { flex: none; cursor: grab; color: var(--muted); user-select: none; }
.chevron { flex: none; color: var(--muted); transition: transform 0.15s; }
.chevron.open { transform: rotate(90deg); }
.glinks { margin-top: 14px; display: grid; }
.glink { display: grid; grid-template-columns: 18px minmax(0, 1fr) 110px 80px 20px; gap: 14px; align-items: center; padding: 10px 8px; font-size: 0.85rem; cursor: pointer; user-select: none; }
.glink:hover, .glink.menu-open { background: var(--hover); }
.gpackage.menu-open, .gpackage.drop-into { border-color: var(--accent); }
.gpackage.drop-into { box-shadow: 0 0 0 2px var(--accent); }
.glink.picked { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.glink + .glink { border-top: 1px solid var(--border); }
.glink.disabled { opacity: 0.55; }
.glink.checking { opacity: 0.5; }
.lcell { display: grid; gap: 2px; min-width: 0; }
.variant { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 0.78rem; }
@media (max-width: 640px) { .marquee { text-overflow: clip !important; } }
@media (max-width: 640px) { .grip { display: none; } } /* no dragging on a phone: "Move" is in the context menu */
.lname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.host { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.avail { display: inline-flex; color: var(--muted); }
.avail.online { color: var(--ok); }
.avail.offline { color: #d14343; }
@media (max-width: 720px) {
  .glink { grid-template-columns: 18px minmax(0, 1fr) 20px; }
  .glink .host, .glink .num { display: none; }
}
</style>
