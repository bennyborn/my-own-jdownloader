<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import DevicePicker from './DevicePicker.vue'
import DeviceDialog from './DeviceDialog.vue'
import { ALL, currentDevice, devices, formatHash, multiple, parseHash, select, selected, showingAll, useDevices, withDevice, type Tab } from './devices'
import { ServerOff } from 'lucide-vue-next'
import { formatBytes, formatSpeed } from './format'
import CaptchaDialog from './CaptchaDialog.vue'
import SolverAlert from './SolverAlert.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import ContextMenu from './ContextMenu.vue'
import LinksDialog from './LinksDialog.vue'
import ItemDialogs from './ItemDialogs.vue'
import VariantDialog from './VariantDialog.vue'
import { actionError, changeTick, movedTick, choosingFolder, renaming } from './itemActions'
import { useDownloads } from './useDownloads'
import { Download, FileDown, Link2, Settings } from 'lucide-vue-next'
import { expandedDownloads, saveExpandedDownloads, selectedDownloadLinks, selectedDownloadPackages, selectedPackagesDevice } from './expandedState'
import { useFileDrop } from './useFileDrop'
import ToastHost from './ToastHost.vue'
import { progress, showError } from './toast'
import AddLinksModal from './AddLinksModal.vue'
import LinkgrabberView from './LinkgrabberView.vue'
import CnlToggle from './CnlToggle.vue'
import LoadingState from './LoadingState.vue'
import NotifyToggle from './NotifyToggle.vue'
import ThemeToggle from './ThemeToggle.vue'
import SettingsView from './SettingsView.vue'
import { loadPlugins } from './plugins'
import { phone, SECTIONS, settingsOpen, settingsSection } from './settings'
import { notifyNewCaptchas } from './useNotifications'
import { useCaptchas } from './useCaptchas'
import { useGrabber } from './useGrabber'
import type { GrabberState } from './types'
import StatusBar from './StatusBar.vue'
import PackageCard from './PackageCard.vue'
import { reorderLocally, useDragReorder } from './dragReorder'

useDevices()
void loadPlugins()
const { snapshot, snapshots, connected } = useDownloads()

const packages = computed(() => snapshot.value?.packages ?? [])

// The overview: one section per device, offline devices with a note instead of a list.
const sections = computed(() =>
  devices.value.map((d) => {
    const snap = snapshots.value[d.id]
    const list = snap?.packages ?? []
    return { device: d, loaded: Boolean(snap), packages: list, speed: d.online === false ? 0 : (snap?.totalSpeed ?? 0), bytesLoaded: list.reduce((sum, p) => sum + p.bytesLoaded, 0), bytesTotal: list.reduce((sum, p) => sum + p.bytesTotal, 0) }
  })
)
// What the status bar shows in the overview: the sum of all devices.
const statusSnapshot = computed(() => {
  if (!showingAll.value) return snapshot.value
  const online = devices.value.filter((d) => d.online !== false).map((d) => snapshots.value[d.id]).filter((s) => s !== undefined)
  if (!online.length) return null
  return {
    updatedAt: Math.max(...online.map((s) => s.updatedAt)),
    packages: online.flatMap((s) => s.packages),
    totalSpeed: online.reduce((sum, s) => sum + s.totalSpeed, 0),
    linkCount: online.reduce((sum, s) => sum + s.linkCount, 0),
    runningDownloads: online.reduce((sum, s) => sum + s.runningDownloads, 0)
  }
})
// Drop marks of packages that no longer exist (e.g. after a merge). Only packages this list knew before are
// dropped: the marks are shared with the lists of the other devices in the overview.
let knownPackages = new Set<number>()
watch(packages, (list) => {
  const ids = new Set(list.map((p) => p.uuid))
  const gone = [...knownPackages].filter((id) => !ids.has(id))
  knownPackages = ids
  if (gone.some((id) => expandedDownloads.has(id))) {
    for (const id of gone) expandedDownloads.delete(id)
    saveExpandedDownloads()
  }
  if (gone.some((id) => selectedDownloadPackages.value.has(id))) selectedDownloadPackages.value = new Set([...selectedDownloadPackages.value].filter((id) => !gone.includes(id)))
})
const tabFromHash = (): Tab => parseHash().tab
const tab = ref<Tab>(tabFromHash())
const devicesOpen = ref(false)
// Coming back to the settings tab shows where you were; tapping it while you are on it goes up to the list (phone).
const openSettings = () => {
  if (phone.value && tab.value === 'settings') settingsOpen.value = false
  tab.value = 'settings'
}
// The active tab and device live in the URL anchor so a reload (or a shared link) opens the same view.
watch([tab, selected, settingsSection, settingsOpen, phone], () => {
  // On a phone the settings list has no section in the anchor (see settings.ts).
  const hash = formatHash(tab.value, selected.value, phone.value && !settingsOpen.value ? undefined : settingsSection.value)
  if (location.hash !== hash) location.hash = hash
})
// A click anywhere else (not on a link, a package header or the context menu) clears the marks.
const onDocumentClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement | null)?.closest('.link, .package > .head, .menu')) return
  if (selectedDownloadLinks.value.size) selectedDownloadLinks.value = new Set()
  if (selectedDownloadPackages.value.size) selectedDownloadPackages.value = new Set()
}
// The browser's own context menu is replaced by ours; it stays in text fields (copy / paste).
const onContextMenu = (e: MouseEvent) => {
  if (!(e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable]')) e.preventDefault()
}
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('contextmenu', onContextMenu)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('contextmenu', onContextMenu)
})

const onHashChange = () => {
  const { tab: next, device, section } = parseHash()
  tab.value = next
  if (next === 'settings') settingsOpen.value = Boolean(section)
  if (section && SECTIONS.some((s) => s.id === section)) settingsSection.value = section
  if (device !== undefined && device !== selected.value) select(device)
}
const toTop = () => window.scrollTo(0, 0)
onMounted(() => window.addEventListener('hashchange', onHashChange))
onUnmounted(() => window.removeEventListener('hashchange', onHashChange))
const addOpen = ref(false)
const grabberVisible = computed(() => tab.value === 'grabber')
const grabber = useGrabber(grabberVisible)
// Right after the page was opened with a device in the anchor: keep what the URL says.
if (location.hash && !location.hash.includes('device=') && selected.value) location.hash = formatHash(tab.value, selected.value)
const captchas = useCaptchas()
watch(captchas.jobs, (jobs) => notifyNewCaptchas(jobs))

watch(grabber.analysing, (on) => (progress.value = on ? 'Analysing links…' : null), { immediate: true })

// Action errors go to a toast, unless a rename / folder dialog is open (it shows the error itself).
watch(actionError, (message) => {
  if (message && !renaming.value && !choosingFolder.value) {
    showError(message)
    actionError.value = ''
  }
})

// After a rename / enable / folder change: refresh both lists right away.
watch(changeTick, async () => {
  void grabber.reload()
  try {
    const res = await fetch(withDevice('/api/downloads'))
    if (res.ok) snapshot.value = await res.json()
  } catch {
    /* the live stream will catch up */
  }
})

// Once everything has been moved to the downloads, the empty linkgrabber is no use: show the downloads.
// Only the linkgrabbers that are shown count: the selected device, or all of them in the "all devices" view.
const anyGrabberHasLinks = async (): Promise<boolean> => {
  const results = await Promise.all(
    devices.value
      .filter((d) => d.online !== false && (showingAll.value || d.id === currentDevice.value))
      .map(async (d) => {
        try {
          const res = await fetch(withDevice('/api/linkgrabber', d.id))
          if (!res.ok) return true // unknown: better stay than jump away
          const state = (await res.json()) as GrabberState
          return state.packages.some((p) => p.links.length > 0)
        } catch {
          return true
        }
      })
  )
  return results.some(Boolean)
}
// JD moves the links asynchronously, so right after the call the linkgrabber may still list them: check a few times.
watch(movedTick, async () => {
  for (let attempt = 0; attempt < 6 && tab.value === 'grabber'; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000))
    await grabber.reload()
    if (tab.value === 'grabber' && !(await anyGrabberHasLinks())) {
      tab.value = 'downloads'
      return
    }
  }
})

const onAdded = async (device?: string) => {
  addOpen.value = false
  // Show the linkgrabber of the device the links went to.
  if (device && !showingAll.value && device !== currentDevice.value) select(device)
  tab.value = 'grabber'
  grabber.boost()
}

const dropping = useFileDrop(onAdded, showError, () => grabber.cancelBoost())

const movePackage = async (device: string, ids: number[], afterId: number) => {
  const snap = snapshots.value[device]
  if (snap) snapshots.value = { ...snapshots.value, [device]: { ...snap, packages: reorderLocally(snap.packages, (p) => p.uuid, ids, afterId) } }
  try {
    const res = await fetch(withDevice('/api/packages/move', device), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageIds: ids, afterPackageId: afterId })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    showError(`Moving failed: ${e instanceof Error ? e.message : e}`)
  }
}

// One drag state per device: the overview shows several lists, each is reordered on its own device.
const drags = new Map<string, ReturnType<typeof useDragReorder>>()
const dragFor = (device: string) => {
  let drag = drags.get(device)
  if (!drag) {
    drag = useDragReorder(() => (snapshots.value[device]?.packages ?? []).map((p) => p.uuid), (ids, afterId) => movePackage(device, ids, afterId),
      (id) => (selectedPackagesDevice.value === device && selectedDownloadPackages.value.has(id) ? [...selectedDownloadPackages.value] : [id]))
    drags.set(device, drag)
  }
  return drag
}
</script>

<template>
  <header>
    <h1>My Own JDownloader</h1>
    <nav>
      <button type="button" :class="{ active: tab === 'downloads' }" @click="tab = 'downloads'"><Download :size="16" /><span class="label">Downloads</span></button>
      <button type="button" :class="{ active: tab === 'grabber' }" @click="tab = 'grabber'">
        <Link2 :size="16" /><span class="label">Linkgrabber</span><span v-if="grabber.linkCount.value" class="count">{{ grabber.linkCount.value }}</span>
      </button>
      <button v-if="multiple" type="button" class="device-tab" :class="{ active: devicesOpen }" @click="devicesOpen = true">
        <span class="logo" aria-hidden="true" /><span class="label">Devices</span>
      </button>
      <button type="button" :class="{ active: tab === 'settings' }" @click="openSettings"><Settings :size="16" /><span class="label">Settings</span></button>
    </nav>
    <CnlToggle />
    <NotifyToggle />
    <DevicePicker v-if="multiple" class="header-picker" :model-value="showingAll ? ALL : currentDevice" with-all @update:model-value="select" />
    <ThemeToggle />
  </header>
  <DeviceDialog v-model="devicesOpen" />

  <main>
    <Transition name="tab" mode="out-in" @after-leave="toTop">
    <div :key="tab" class="view">
    <SettingsView v-if="tab === 'settings'" />
    <template v-else-if="tab === 'downloads' && showingAll">
      <section v-for="s in sections" :key="s.device.id" class="device-section">
        <h2 class="device-head" :class="{ offline: s.device.online === false }">
          <ServerOff v-if="s.device.online === false" :size="16" />
          <span class="name">{{ s.device.name }}</span>
          <span v-if="s.device.online === false" class="state">offline</span>
          <span v-else-if="s.packages.length" class="totals">{{ s.packages.length }} package{{ s.packages.length === 1 ? '' : 's' }} · {{ formatBytes(s.bytesLoaded) }} / {{ formatBytes(s.bytesTotal) }}<template v-if="s.speed > 0"> · {{ formatSpeed(s.speed) }}</template></span>
        </h2>
        <p v-if="s.device.online === false" class="empty">This device is offline.</p>
        <LoadingState v-else-if="!s.loaded" variant="inline" text="Loading…" />
        <p v-else-if="!s.packages.length" class="empty">The download list is empty.</p>
        <PackageCard
          v-for="p in s.packages"
          :key="p.uuid"
          :pkg="p"
          :device="s.device.id"
          :class="[dragFor(s.device.id).dropClass(p.uuid), { dragging: dragFor(s.device.id).dragId.value === p.uuid }]"
          @dragstart="dragFor(s.device.id).onDragStart(p.uuid, $event)"
          @dragover="dragFor(s.device.id).onDragOver(p.uuid, $event)"
          @drop="dragFor(s.device.id).onDrop($event)"
          @dragend="dragFor(s.device.id).onDragEnd()"
        />
      </section>
    </template>
    <template v-else-if="tab === 'downloads'">
      <LoadingState v-if="!snapshot" variant="page" text="Loading downloads…" />
      <div v-else-if="packages.length === 0" class="empty-big">
        <Download :size="72" :stroke-width="1.25" />
        <p>The download list is empty</p>
        <span>Move links from the linkgrabber to see them here.</span>
      </div>

      <PackageCard
        v-for="p in packages"
        :key="p.uuid"
        :pkg="p"
        :class="[dragFor(currentDevice).dropClass(p.uuid), { dragging: dragFor(currentDevice).dragId.value === p.uuid }]"
        @dragstart="dragFor(currentDevice).onDragStart(p.uuid, $event)"
        @dragover="dragFor(currentDevice).onDragOver(p.uuid, $event)"
        @drop="dragFor(currentDevice).onDrop($event)"
        @dragend="dragFor(currentDevice).onDragEnd()"
      />
    </template>
    <template v-else-if="showingAll">
      <section v-for="d in devices" :key="d.id" class="device-section">
        <h2 class="device-head" :class="{ offline: d.online === false }">
          <ServerOff v-if="d.online === false" :size="16" />
          <span class="name">{{ d.name }}</span>
          <span v-if="d.online === false" class="state">offline</span>
        </h2>
        <p v-if="d.online === false" class="empty">This device is offline.</p>
        <LinkgrabberView v-else :state="grabber.states.value[d.id] ?? null" :analysing="grabber.analysing.value" :device="d.id" compact @changed="grabber.reload()" />
      </section>
    </template>
    <LinkgrabberView v-else :state="grabber.state.value" :analysing="grabber.analysing.value" @changed="grabber.reload()" />
    </div>
    </Transition>
  </main>

  <div class="status-wrap" :class="{ hidden: tab === 'settings' }">
    <StatusBar :snapshot="statusSnapshot" :device="showingAll ? '' : currentDevice" :connected="connected" :solver-jobs="captchas.widgetJobs.value" @add-links="addOpen = true" />
  </div>
  <ContextMenu />
  <CaptchaDialog :job="captchas.imageJobs.value[0] ?? null" :more="Math.max(0, captchas.imageJobs.value.length - 1)" @handled="captchas.markHandled" @changed="captchas.reload()" />
  <SolverAlert v-if="!captchas.imageJobs.value.length" :job="captchas.alertJobs.value[0] ?? null" @dismiss="captchas.dismiss" />
  <ConfirmDialog />
  <ToastHost />
  <ItemDialogs />
  <LinksDialog />
  <VariantDialog />
  <div v-if="dropping.active.value" class="dropzone"><FileDown :size="40" /> Drop container files or links to add them to the linkgrabber</div>
  <AddLinksModal v-if="addOpen" @close="addOpen = false" @added="onAdded" />
</template>

<style>
/* Touch devices: a long press opens the context menu, so no text selection / callout (inputs stay selectable). */
@media (pointer: coarse) {
  body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
  input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
}
:root {
  color-scheme: light dark;
  --bg: #f6f8fa;
  --card: #fff;
  --text: #1f2328;
  --muted: #59636e;
  --border: #d0d7de;
  --accent: #10ac84;
  --ok: #22a55b;
  --extract: #fecf02; /* the yellow of the logo (bars) */
  --extract-text: #8a6500; /* readable on a light background */
  --fill-soft: var(--border);
  --hover: rgba(127, 127, 127, 0.1);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --extract-text: var(--extract);
    --bg: #0d1117;
    --card: #161b22;
    --text: #e6edf3;
    --muted: #8b949e;
    --border: #30363d;
  }
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --extract-text: var(--extract);
  --bg: #0d1117;
  --card: #161b22;
  --text: #e6edf3;
  --muted: #8b949e;
  --border: #30363d;
}
:root[data-theme='light'] { color-scheme: light; }
/* Single-colour icons that would vanish on the current theme (see iconTone.ts). */
:root[data-theme='dark'] img[data-tone='dark'], :root[data-theme='light'] img[data-tone='light'] { filter: invert(1); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) img[data-tone='dark'] { filter: invert(1); }
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) img[data-tone='light'] { filter: invert(1); }
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.4 system-ui, sans-serif;
}
header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px 16px;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}
h1 { margin: 0; font-size: 1.2rem; }
header { padding: 14px 16px; align-items: center; }
nav { display: flex; gap: 4px; margin-right: auto; margin-left: 16px; }
nav button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  color: var(--muted);
  border: 1px solid transparent;
  border-radius: 8px;
  height: 40px; /* same height as the bell and the theme switch next to them */
  padding: 0 16px;
  font: inherit;
  cursor: pointer;
}
nav button:hover { color: var(--text); background: var(--hover); }
nav button.active {
  color: var(--text);
  font-weight: 600;
  background: var(--card);
  border-color: var(--border);
  box-shadow: inset 0 -2px 0 var(--accent);
}
nav .device-tab { display: none; }
main { max-width: 900px; margin: 0 auto; padding: 28px 16px 190px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
/* Phones: the tabs become a bottom bar within thumb reach; the status bar floats above it. */
:root { --tabbar-h: 0px; }
@media (max-width: 640px) {
  /* Phone: a checkbox with a text becomes a row with a switch on the right (also in JdSettings, which has its own rows). */
  label.check { flex-direction: row-reverse; justify-content: space-between; align-items: center !important; gap: 16px; }
  label.check input[type='checkbox'] { appearance: none; -webkit-appearance: none; flex: none; position: relative; width: 46px; height: 28px; margin: 0 !important; border-radius: 14px; background: var(--border); cursor: pointer; transition: background 0.15s; }
  label.check input[type='checkbox']::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
  label.check input[type='checkbox']:checked { background: var(--accent); }
  label.check input[type='checkbox']:checked::after { transform: translateX(18px); }
  :root { --tabbar-h: calc(60px + env(safe-area-inset-bottom)); }
  nav {
    position: fixed; inset: auto 0 0 0; z-index: 2; margin: 0; gap: 0; box-sizing: border-box;
    height: var(--tabbar-h); padding-bottom: env(safe-area-inset-bottom);
    background: var(--card); border-top: 1px solid var(--border);
  }
  nav button {
    position: relative; flex: 1; flex-direction: column; justify-content: center; gap: 2px; height: auto;
    padding: 0; border: 0; border-radius: 0; font-size: 0.72rem;
  }
  nav button.active { background: none; box-shadow: inset 0 2px 0 var(--accent); color: var(--accent); }
  nav .count { position: absolute; top: 6px; left: calc(50% + 6px); }
  .header-picker { display: none; }
  nav .device-tab { display: flex; }
  .logo { width: 16px; height: 16px; background: currentColor; mask: url(/logo-outline.svg) center / contain no-repeat; }
  h1 { margin-right: auto; }
  header { flex-wrap: nowrap; gap: 8px; }
  /* Room for the floating status bar (24px above the tab bar), and below the last package the same gap as above the first one (28px). */
  main { padding-bottom: calc(var(--tabbar-h) + 24px + var(--statusbar-h, 100px) + 28px + var(--sheet-h, 0px)); }
  .status-wrap.hidden { display: none; }
  main:has(.settings) { padding-bottom: calc(24px + var(--tabbar-h)); }
}
.count { background: var(--accent); color: #fff; border-radius: 9px; padding: 0 7px; font-size: 0.72rem; line-height: 1.5; }
h2 { margin: 0; font-size: 1rem; overflow-wrap: anywhere; }
.summary { display: flex; align-items: center; gap: 12px; color: var(--muted); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: #d14343; }
.dot.on { background: var(--ok); }
.status-wrap { display: contents; }
.view { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.tab-enter-active, .tab-leave-active { transition: opacity 0.12s ease, transform 0.12s ease; }
.tab-enter-from { opacity: 0; transform: translateY(8px); }
.tab-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .tab-enter-active, .tab-leave-active { transition: none; } }
.error { color: #d14343; text-align: center; }
.dragging { opacity: 0.4; }
.drop-before { box-shadow: 0 -3px 0 var(--accent); }
.drop-after { box-shadow: 0 3px 0 var(--accent); }
.empty { color: var(--muted); text-align: center; }
.empty-big { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 55vh; color: var(--muted); text-align: center; }
.empty-big p { margin: 8px 0 0; font-size: 1.1rem; color: var(--text); }
.device-section { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; margin-bottom: 20px; }
.device-head { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; padding-bottom: 8px; border-bottom: 1px solid var(--border); font-size: 1rem; }
.device-head .totals, .device-head .state { margin-left: auto; font-size: 0.85rem; font-weight: 400; color: var(--muted); }
.device-head .state { text-transform: uppercase; letter-spacing: 0.03em; }
.device-head.offline { color: var(--muted); }
.package { min-width: 0; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.package.disabled { opacity: 0.55; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.badge { font-size: 0.75rem; text-transform: uppercase; color: var(--muted); }
.running .badge { color: var(--accent); }
.finished .badge { color: var(--ok); }
.extracting .badge, .extracted .badge { color: var(--extract-text); }
.extract-failed .badge, .download-error .badge { color: #d14343; }
.bar { height: 8px; margin: 10px 0 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
.fill { height: 100%; background: var(--accent); transition: width 0.5s; }
.finished .fill { background: var(--ok); }
/* Extracted stays yellow like extracting, just without the moving stripes. */
.extracted .fill, .link.extracted .pfill { background: var(--extract); }
.extract-failed .fill, .download-error .fill { background: #d14343; }
/* No percentage is available while JD unpacks: a moving yellow stripe pattern shows that work is going on. */
.extracting .fill, .link.extracting .pfill {
  background: repeating-linear-gradient(-45deg, var(--extract) 0 10px, color-mix(in srgb, var(--extract) 70%, #000) 10px 20px);
  background-size: 28px 28px;
  animation: extract-stripes 0.8s linear infinite;
}
@keyframes extract-stripes { to { background-position: 28px 0; } }
.meta { gap: 4px 16px; color: var(--muted); font-size: 0.85rem; }
.status { margin-top: 4px; }
.dropzone { position: fixed; inset: 12px; z-index: 500; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: rgba(0, 0, 0, 0.6); border: 2px dashed var(--accent); border-radius: 16px; color: #fff; font-size: 1.05rem; pointer-events: none; }
</style>
