<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import DownloadControls from './DownloadControls.vue'
import DevicePicker from './DevicePicker.vue'
import DeviceDialog from './DeviceDialog.vue'
import { ALL, currentDevice, devices, formatHash, multiple, parseHash, select, selected, showingAll, useDevices, withDevice, type Tab } from './devices'
import { ServerOff } from '@lucide/vue'
import { formatBytes, formatSpeed } from './format'
import CaptchaDialog from './CaptchaDialog.vue'
import JdDialogs from './JdDialogs.vue'
import SolverAlert from './SolverAlert.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import PromptDialog from './PromptDialog.vue'
import ContextMenu from './ContextMenu.vue'
import LinksDialog from './LinksDialog.vue'
import ItemDialogs from './ItemDialogs.vue'
import VariantDialog from './VariantDialog.vue'
import MoveToDeviceDialog from './MoveToDeviceDialog.vue'
import MovingDialog from './MovingDialog.vue'
import { actionError, changeTick, movedTick, choosingFolder, renaming } from './itemActions'
import { useDownloads } from './useDownloads'
import { Download, FileDown, Link2, Settings } from '@lucide/vue'
import { expandedDownloads, saveExpandedDownloads, selectedDownloadLinks, selectedDownloadPackages, selectedPackagesDevice } from './expandedState'
import { useFileDrop } from './useFileDrop'
import ToastHost from './ToastHost.vue'
import { progress, showError } from './toast'
import { askConfirm } from './confirm'
import AddLinksModal from './AddLinksModal.vue'
import LinkgrabberView from './LinkgrabberView.vue'
import CnlToggle from './CnlToggle.vue'
import LoadingState from './LoadingState.vue'
import NotifyToggle from './NotifyToggle.vue'
import ThemeToggle from './ThemeToggle.vue'
import SettingsView from './SettingsView.vue'
import { loadPlugins, matchesActiveFilters } from './plugins'
import ToolbarSlot from './ToolbarSlot.vue'
import { phone, SECTIONS, settingsOpen, settingsSection } from './settings'
import { backendUpdateAvailable, useBackendUpdate } from './backendUpdate'
import { notifyNewCaptchas } from './useNotifications'
import { useCaptchas } from './useCaptchas'
import { useGrabber } from './useGrabber'
import type { DownloadPackage, GrabberState } from './types'
import StatusBar from './StatusBar.vue'
import PackageCard from './PackageCard.vue'
import { useDragReorder } from './dragReorder'
import { addPending, reorderOp, withPending } from './pendingOps'
import { crossDrag, dropCrossDrag, endCrossDrag, startCrossDrag } from './crossDeviceDrag'

useDevices()
useBackendUpdate()
void loadPlugins()
const { snapshot, snapshots, connected } = useDownloads()

const packages = computed(() => snapshot.value?.packages ?? [])
// What the list actually renders: the filter only hides cards, it never changes the totals above.
const visiblePackages = computed(() => packages.value.filter((p) => matchesActiveFilters('downloads', p.name)))

// The overview: one section per device, offline devices with a note instead of a list.
const sections = computed(() =>
  devices.value.map((d) => {
    const snap = snapshots.value[d.id]
    const list = snap?.packages ?? []
    return {
      device: d,
      loaded: Boolean(snap),
      packages: list,
      visible: list.filter((p) => matchesActiveFilters('downloads', p.name)),
      speed: d.online === false ? 0 : (snap?.totalSpeed ?? 0),
      bytesLoaded: list.reduce((sum, p) => sum + p.bytesLoaded, 0),
      bytesTotal: list.reduce((sum, p) => sum + p.bytesTotal, 0)
    }
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
    runningDownloads: online.reduce((sum, s) => sum + s.runningDownloads, 0),
    state: ''
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
// The browser's own context menu is replaced by ours; it stays in text fields (copy / paste), on the settings
// pages (save a link as) and on elements marked .allow-contextmenu (e.g. the captcha picture, save image as).
const onContextMenu = (e: MouseEvent) => {
  if (tab.value !== 'settings' && !(e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable], .allow-contextmenu')) e.preventDefault()
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
const addPrefill = ref('')
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

// A text file dropped anywhere on the window opens the add-links dialog prefilled instead of being added right away.
const onDroppedText = (text: string) => {
  addPrefill.value = text
  addOpen.value = true
}

const dropping = useFileDrop(onAdded, showError, () => grabber.cancelBoost(), onDroppedText)

const movePackage = async (device: string, ids: number[], afterId: number) => {
  const snap = snapshots.value[device]
  const cancel = addPending<DownloadPackage>(`dl:${device}`, reorderOp((p) => p.uuid, ids, afterId))
  if (snap) snapshots.value = { ...snapshots.value, [device]: { ...snap, packages: withPending(`dl:${device}`, snap.packages) } }
  try {
    const res = await fetch(withDevice('/api/packages/move', device), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageIds: ids, afterPackageId: afterId })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    cancel()
    showError(`Moving failed: ${e instanceof Error ? e.message : e}`)
  }
}

// A package dropped on the middle of another: merge after a confirmation.
const mergeDropped = async (device: string, ids: number[], targetId: number) => {
  const target = snapshots.value[device]?.packages.find((p) => p.uuid === targetId)
  const others = ids.filter((id) => id !== targetId)
  if (!target || !others.length) return
  const ok = await askConfirm({
    title: 'Merge packages',
    message: `${others.length + 1} packages will be merged into "${target.name}". The links of the other packages are moved there.`,
    confirmLabel: 'Merge'
  })
  if (!ok) return
  const sources = new Set(others)
  const cancel = addPending<DownloadPackage>(`dl:${device}`, (items) => {
    const gone = items.filter((p) => sources.has(p.uuid))
    if (!gone.length) return null
    return items
      .filter((p) => !sources.has(p.uuid))
      .map((p) => p.uuid === targetId ? { ...p, childCount: p.childCount + gone.reduce((n, g) => n + g.childCount, 0), bytesTotal: p.bytesTotal + gone.reduce((n, g) => n + g.bytesTotal, 0), bytesLoaded: p.bytesLoaded + gone.reduce((n, g) => n + g.bytesLoaded, 0) } : p)
  })
  const snap = snapshots.value[device]
  if (snap) snapshots.value = { ...snapshots.value, [device]: { ...snap, packages: withPending(`dl:${device}`, snap.packages) } }
  try {
    const res = await fetch(withDevice('/api/downloads/merge', device), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destPackageId: targetId, packageIds: others })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    cancel()
    showError(`Merging failed: ${e instanceof Error ? e.message : e}`)
  }
}

// One drag state per device: the overview shows several lists, each is reordered on its own device.
const drags = new Map<string, ReturnType<typeof useDragReorder>>()
const dragFor = (device: string) => {
  let drag = drags.get(device)
  if (!drag) {
    drag = useDragReorder(() => (snapshots.value[device]?.packages ?? []).map((p) => p.uuid), (ids, afterId) => movePackage(device, ids, afterId),
      (id) => (selectedPackagesDevice.value === device && selectedDownloadPackages.value.has(id) ? [...selectedDownloadPackages.value] : [id]),
      (ids, targetId) => void mergeDropped(device, ids, targetId))
    drags.set(device, drag)
  }
  return drag
}

// Section of the "all devices" overview a package is dragged over to move it there outright (a plain drop onto
// a card of the same device still reorders/merges as usual, see dragFor above).
const onSectionDragOver = (device: string, event: DragEvent) => {
  if (crossDrag.value && crossDrag.value.device !== device) event.preventDefault()
}
const onSectionDrop = (device: string, event: DragEvent) => {
  if (!crossDrag.value || crossDrag.value.device === device) return
  event.preventDefault()
  void dropCrossDrag(device, () => changeTick.value++)
}
</script>

<template>
  <header>
    <nav>
      <button type="button" :class="{ active: tab === 'downloads' }" @click="tab = 'downloads'"><Download :size="16" /><span class="label">Downloads</span></button>
      <button type="button" :class="{ active: tab === 'grabber' }" @click="tab = 'grabber'">
        <Link2 :size="16" /><span class="label">Linkgrabber</span><span v-if="grabber.linkCount.value" class="count">{{ grabber.linkCount.value }}</span>
      </button>
      <button v-if="multiple" type="button" class="device-tab" :class="{ active: devicesOpen }" @click="devicesOpen = true">
        <span class="logo" aria-hidden="true" /><span class="label">Devices</span>
      </button>
      <button type="button" :class="{ active: tab === 'settings' }" @click="openSettings"><Settings :size="16" /><span class="label">Settings</span><span v-if="backendUpdateAvailable" class="update-dot" title="An update is available" /></button>
    </nav>
    <DownloadControls v-if="!showingAll" :snapshots="snapshots" :targets="[currentDevice]" />
    <div class="header-tools">
    <CnlToggle />
    <NotifyToggle />
    <DevicePicker v-if="multiple" class="header-picker" :model-value="showingAll ? ALL : currentDevice" with-all @update:model-value="select" />
    <ThemeToggle />
    </div>
  </header>
  <DeviceDialog v-model="devicesOpen" />

  <div class="toolbar-band">
    <ToolbarSlot v-if="tab === 'downloads'" name="downloads-toolbar" scope="downloads" />
    <ToolbarSlot v-if="tab === 'grabber'" name="linkgrabber-toolbar" scope="linkgrabber" />
  </div>

  <main>
    <Transition name="tab" mode="out-in" @after-leave="toTop">
    <div :key="tab" class="view">
    <SettingsView v-if="tab === 'settings'" />
    <template v-else-if="tab === 'downloads' && showingAll">
      <section
        v-for="s in sections"
        :key="s.device.id"
        class="device-section"
        :class="{ 'cross-drop-target': crossDrag && crossDrag.device !== s.device.id }"
        @dragover="onSectionDragOver(s.device.id, $event)"
        @drop="onSectionDrop(s.device.id, $event)"
      >
        <h2 class="device-head" :class="{ offline: s.device.online === false }">
          <ServerOff v-if="s.device.online === false" :size="16" />
          <span class="name">{{ s.device.name }}</span>
          <span v-if="s.device.online === false" class="state">offline</span>
          <span v-else-if="s.packages.length" class="totals">{{ s.packages.length }} package{{ s.packages.length === 1 ? '' : 's' }} · {{ formatBytes(s.bytesLoaded) }} / {{ formatBytes(s.bytesTotal) }}<template v-if="s.speed > 0"> · {{ formatSpeed(s.speed) }}</template></span>
        </h2>
        <p v-if="s.device.online === false" class="empty">This device is offline.</p>
        <LoadingState v-else-if="!s.loaded" variant="inline" text="Loading…" />
        <p v-else-if="!s.packages.length" class="empty">The download list is empty.</p>
        <p v-else-if="!s.visible.length" class="empty">No matches.</p>
        <PackageCard
          v-for="p in s.visible"
          :key="p.uuid"
          :pkg="p"
          :device="s.device.id"
          :class="[dragFor(s.device.id).dropClass(p.uuid), { dragging: dragFor(s.device.id).dragId.value === p.uuid, 'drop-into': dragFor(s.device.id).mergeId.value === p.uuid }]"
          @dragstart="dragFor(s.device.id).onDragStart(p.uuid, $event); startCrossDrag({ area: 'downloads', device: s.device.id, packageId: p.uuid, name: p.name, hasProgress: p.running || p.bytesLoaded > 0 })"
          @dragover="dragFor(s.device.id).onDragOver(p.uuid, $event)"
          @drop="dragFor(s.device.id).onDrop($event)"
          @dragend="dragFor(s.device.id).onDragEnd(); endCrossDrag()"
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
      <p v-else-if="visiblePackages.length === 0" class="empty-big">No matches.</p>

      <PackageCard
        v-for="p in visiblePackages"
        :key="p.uuid"
        :pkg="p"
        :class="[dragFor(currentDevice).dropClass(p.uuid), { dragging: dragFor(currentDevice).dragId.value === p.uuid, 'drop-into': dragFor(currentDevice).mergeId.value === p.uuid }]"
        @dragstart="dragFor(currentDevice).onDragStart(p.uuid, $event)"
        @dragover="dragFor(currentDevice).onDragOver(p.uuid, $event)"
        @drop="dragFor(currentDevice).onDrop($event)"
        @dragend="dragFor(currentDevice).onDragEnd()"
      />
    </template>
    <template v-else-if="showingAll">
      <section
        v-for="d in devices"
        :key="d.id"
        class="device-section"
        :class="{ 'cross-drop-target': crossDrag && crossDrag.device !== d.id }"
        @dragover="onSectionDragOver(d.id, $event)"
        @drop="onSectionDrop(d.id, $event)"
      >
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
    <StatusBar :snapshot="statusSnapshot" :device="showingAll ? '' : currentDevice" :connected="connected" :solver-jobs="captchas.widgetJobs.value" @add-links="addPrefill = ''; addOpen = true" />
  </div>
  <ContextMenu />
  <JdDialogs />
  <CaptchaDialog :job="captchas.imageJobs.value[0] ?? null" :more="Math.max(0, captchas.imageJobs.value.length - 1)" @handled="captchas.markHandled" @changed="captchas.reload()" />
  <SolverAlert v-if="!captchas.imageJobs.value.length" :job="captchas.alertJobs.value[0] ?? null" @dismiss="captchas.dismiss" />
  <ConfirmDialog />
  <PromptDialog />
  <ToastHost />
  <ItemDialogs />
  <LinksDialog />
  <VariantDialog />
  <MoveToDeviceDialog />
  <MovingDialog />
  <div v-if="dropping.active.value" class="dropzone"><FileDown :size="40" /> Drop container files or links to add them, or a text file to open it in the add-links dialog</div>
  <AddLinksModal v-if="addOpen" :initial-links="addPrefill" @close="addOpen = false" @added="onAdded" />
</template>
