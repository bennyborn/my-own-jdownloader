<script setup lang="ts">
import { ChevronRight, CircleCheck, CircleHelp, CircleX, Folder, Inbox, PowerOff, Loader, PackagePlus, Trash2, X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { askConfirm } from './confirm'
import { expandedGrabber } from './expandedState'
import { formatBytes } from './format'
import { clearHovered, openMenu, setHovered, type Target } from './itemActions'
import type { GrabberLink, GrabberState } from './types'

const props = defineProps<{ state: GrabberState | null; analysing: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const selected = ref<Set<number>>(new Set()) // selected link uuids
const hostFilter = ref<Set<string>>(new Set())
const extFilter = ref<Set<string>>(new Set())
const busy = ref(false)
const message = ref('')
let lastClicked: number | null = null // anchor for shift+click range selection

const NO_EXT = '(none)'
const extOf = (l: GrabberLink) => {
  const dot = l.name.lastIndexOf('.')
  const ext = dot > 0 ? l.name.slice(dot + 1).toLowerCase() : ''
  return ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext) ? ext : NO_EXT
}
// Packages whose links are all selected count as "marked packages" (merge candidates).
const markedPackageIds = () => packages.value.filter((p) => p.links.length && selectionState(p.links) === 'all').map((p) => p.uuid)
const packageTarget = (p: { uuid: number; name: string; enabled: boolean; saveTo?: string }): Target => ({
  area: 'linkgrabber',
  kind: 'package',
  id: p.uuid,
  name: p.name,
  enabled: p.enabled,
  running: false,
  saveTo: p.saveTo,
  mergeIds: markedPackageIds().includes(p.uuid) && markedPackageIds().length > 1 ? markedPackageIds() : undefined
})
const linkTarget = (l: GrabberLink): Target => ({ area: 'linkgrabber', kind: 'link', id: l.uuid, name: l.name, enabled: l.enabled, running: false })
const isPackageDisabled = (p: { enabled: boolean; links: GrabberLink[] }) => !p.enabled || (p.links.length > 0 && p.links.every((l) => !l.enabled))
const hostOf = (l: GrabberLink) => l.host || 'unknown'

const allLinks = computed(() => (props.state?.packages ?? []).flatMap((p) => p.links))
const matchesHost = (l: GrabberLink) => !hostFilter.value.size || hostFilter.value.has(hostOf(l))
const matchesExt = (l: GrabberLink) => !extFilter.value.size || extFilter.value.has(extOf(l))

// Packages reduced to the links that pass the filters (empty packages are hidden).
const packages = computed(() =>
  (props.state?.packages ?? [])
    .map((p) => ({ ...p, links: p.links.filter((l) => matchesHost(l) && matchesExt(l)) }))
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

const allState = computed(() => selectionState(visibleLinks.value))
const selectOnline = () => (selected.value = new Set(visibleLinks.value.filter((l) => l.availability === 'ONLINE').map((l) => l.uuid)))
const checkboxState = (el: HTMLInputElement | null, state: string) => {
  if (el) el.indeterminate = state === 'some'
}

const act = async (route: 'move-to-downloads' | 'remove') => {
  busy.value = true
  message.value = ''
  try {
    const res = await fetch(`/api/linkgrabber/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkIds: [...selected.value] })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    selected.value = new Set()
    emit('changed')
  } catch (e) {
    message.value = `Failed: ${e instanceof Error ? e.message : e}`
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
      <span v-if="analysing" class="muted analysing"><Loader :size="14" class="spin" /> Analysing links…</span>
      <span class="spacer" />
      <button type="button" class="danger" :disabled="busy || !selected.size" @click="removeSelected"><Trash2 :size="14" /> Remove</button>
      <button type="button" class="primary" :disabled="busy || !selected.size" @click="moveSelected"><PackagePlus :size="14" /> To downloads ({{ selected.size }})</button>
    </div>

    <div v-if="allLinks.length" class="filters">
      <div v-if="hostChips.length > 1 || hostFilter.size" class="chips">
        <span class="label">Host</span>
        <button v-for="[host, count] in hostChips" :key="host" type="button" class="chip" :class="{ on: hostFilter.has(host) }" @click="toggleFilter('host', host)">
          <img class="hosticon" :src="`/api/icons/${host}`" alt="" width="14" height="14" @error="($event.target as HTMLElement).style.display = 'none'" />
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
    <p v-if="message" class="muted">{{ message }}</p>

    <p v-if="!state" class="muted">Loading…</p>
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
      :class="{ disabled: isPackageDisabled(p) }"
      @pointerenter="setHovered(packageTarget(p))"
      @pointerleave="clearHovered(packageTarget(p))"
      @contextmenu="openMenu($event, packageTarget(p))"
    >
      <div class="head">
        <input type="checkbox" :checked="selectionState(p.links) === 'all'" :ref="(el) => checkboxState(el as HTMLInputElement, selectionState(p.links))" @change="togglePackage(p.links)" />
        <button type="button" class="name" @click="toggleExpanded(p.uuid)">
          <ChevronRight :size="16" class="chevron" :class="{ open: expandedGrabber.has(p.uuid) }" />{{ p.name }}
        </button>
        <span v-if="isPackageDisabled(p)" class="off"><PowerOff :size="13" /> disabled</span>
        <span class="muted">{{ p.links.length }} links · {{ formatBytes(p.links.reduce((sum, l) => sum + l.bytesTotal, 0)) }}</span>
      </div>
      <div v-if="p.saveTo" class="path" :title="p.saveTo"><Folder :size="13" /><span>{{ p.saveTo }}</span></div>
      <div v-if="expandedGrabber.has(p.uuid)" class="glinks">
        <div
          v-for="l in p.links"
          :key="l.uuid"
          class="glink"
          @pointerenter="setHovered(linkTarget(l))"
          @pointerleave="setHovered(packageTarget(p))"
          @contextmenu.stop="openMenu($event, linkTarget(l))"
          :class="{ disabled: !l.enabled, checking: analysing && l.availability === 'UNKNOWN', picked: selected.has(l.uuid) }"
          :title="l.url"
          @click="onLinkClick($event, l)"
        >
          <input type="checkbox" :checked="selected.has(l.uuid)" @click.stop="onLinkClick($event, l)" />
          <span class="lname">{{ l.name }}</span>
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
.analysing { display: inline-flex; align-items: center; gap: 6px; }
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
.head .name { flex: 1; min-width: 0; border: 0; padding: 0; background: none; font-weight: 600; text-align: left; overflow-wrap: anywhere; }
.path { display: flex; align-items: center; gap: 6px; margin: 8px 0 0 28px; color: var(--muted); font-size: 0.78rem; min-width: 0; }
.path svg { flex: none; }
.path span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chevron { flex: none; color: var(--muted); transition: transform 0.15s; }
.chevron.open { transform: rotate(90deg); }
.glinks { margin-top: 14px; display: grid; }
.glink { display: grid; grid-template-columns: 18px minmax(0, 1fr) 110px 80px 20px; gap: 14px; align-items: center; padding: 10px 8px; font-size: 0.85rem; cursor: pointer; user-select: none; }
.glink:hover { background: var(--hover); }
.glink.picked { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.glink + .glink { border-top: 1px solid var(--border); }
.glink.disabled { opacity: 0.55; }
.glink.checking { opacity: 0.5; }
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
