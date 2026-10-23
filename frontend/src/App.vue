<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import ContextMenu from './ContextMenu.vue'
import LinksDialog from './LinksDialog.vue'
import ItemDialogs from './ItemDialogs.vue'
import { actionError, changeTick, choosingFolder, renaming } from './itemActions'
import { useDownloads } from './useDownloads'
import { Download, Link2 } from 'lucide-vue-next'
import AddLinksModal from './AddLinksModal.vue'
import LinkgrabberView from './LinkgrabberView.vue'
import ThemeToggle from './ThemeToggle.vue'
import { useGrabber } from './useGrabber'
import StatusBar from './StatusBar.vue'
import PackageCard from './PackageCard.vue'
import { reorderLocally, useDragReorder } from './dragReorder'

const { snapshot, connected } = useDownloads()

const packages = computed(() => snapshot.value?.packages ?? [])
const moveError = ref('')
type Tab = 'downloads' | 'grabber'
const tabFromHash = (): Tab => (location.hash === '#linkgrabber' ? 'grabber' : 'downloads')
const tab = ref<Tab>(tabFromHash())
// The active tab lives in the URL anchor so a reload (or a shared link) opens the same tab.
watch(tab, (value) => {
  const hash = value === 'grabber' ? '#linkgrabber' : '#downloads'
  if (location.hash !== hash) location.hash = hash
})
const onHashChange = () => (tab.value = tabFromHash())
onMounted(() => window.addEventListener('hashchange', onHashChange))
onUnmounted(() => window.removeEventListener('hashchange', onHashChange))
const addOpen = ref(false)
const grabberVisible = computed(() => tab.value === 'grabber')
const grabber = useGrabber(grabberVisible)

// After a rename / enable / folder change: refresh both lists right away.
watch(changeTick, async () => {
  void grabber.reload()
  try {
    const res = await fetch('/api/downloads')
    if (res.ok) snapshot.value = await res.json()
  } catch {
    /* the live stream will catch up */
  }
})

const onAdded = async () => {
  addOpen.value = false
  tab.value = 'grabber'
  grabber.boost()
}

const movePackage = async (id: number, afterId: number) => {
  if (snapshot.value) {
    snapshot.value = { ...snapshot.value, packages: reorderLocally(snapshot.value.packages, (p) => p.uuid, id, afterId) }
  }
  try {
    const res = await fetch('/api/packages/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageIds: [id], afterPackageId: afterId })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    moveError.value = ''
  } catch (e) {
    moveError.value = `Moving failed: ${e instanceof Error ? e.message : e}`
  }
}

const drag = useDragReorder(() => packages.value.map((p) => p.uuid), movePackage)
</script>

<template>
  <header>
    <h1>My Own JDownloader</h1>
    <nav>
      <button type="button" :class="{ active: tab === 'downloads' }" @click="tab = 'downloads'"><Download :size="16" /> Downloads</button>
      <button type="button" :class="{ active: tab === 'grabber' }" @click="tab = 'grabber'">
        <Link2 :size="16" /> Linkgrabber<span v-if="grabber.linkCount.value" class="count">{{ grabber.linkCount.value }}</span>
      </button>
    </nav>
    <ThemeToggle />
  </header>

  <main>
    <p v-if="actionError && !renaming && !choosingFolder" class="error">{{ actionError }}</p>
    <template v-if="tab === 'downloads'">
      <p v-if="moveError" class="error">{{ moveError }}</p>
      <p v-if="!snapshot" class="empty">Loading…</p>
      <p v-else-if="packages.length === 0" class="empty">No packages in the download list.</p>

      <PackageCard
        v-for="p in packages"
        :key="p.uuid"
        :pkg="p"
        :class="[drag.dropClass(p.uuid), { dragging: drag.dragId.value === p.uuid }]"
        @dragstart="drag.onDragStart(p.uuid, $event)"
        @dragover="drag.onDragOver(p.uuid, $event)"
        @drop="drag.onDrop($event)"
        @dragend="drag.onDragEnd()"
      />
    </template>
    <LinkgrabberView v-else :state="grabber.state.value" :analysing="grabber.analysing.value" @changed="grabber.reload()" />
  </main>

  <StatusBar :snapshot="snapshot" :connected="connected" @add-links="addOpen = true" />
  <ContextMenu />
  <ConfirmDialog />
  <ItemDialogs />
  <LinksDialog />
  <AddLinksModal v-if="addOpen" @close="addOpen = false" @added="onAdded" />
</template>

<style>
:root {
  color-scheme: light dark;
  --bg: #f6f8fa;
  --card: #fff;
  --text: #1f2328;
  --muted: #59636e;
  --border: #d0d7de;
  --accent: #10ac84;
  --ok: #22a55b;
  --fill-soft: var(--border);
  --hover: rgba(127, 127, 127, 0.1);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #0d1117;
    --card: #161b22;
    --text: #e6edf3;
    --muted: #8b949e;
    --border: #30363d;
  }
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #0d1117;
  --card: #161b22;
  --text: #e6edf3;
  --muted: #8b949e;
  --border: #30363d;
}
:root[data-theme='light'] { color-scheme: light; }
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
  padding: 8px 16px;
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
.count { background: var(--accent); color: #fff; border-radius: 9px; padding: 0 7px; font-size: 0.72rem; line-height: 1.5; }
h2 { margin: 0; font-size: 1rem; overflow-wrap: anywhere; }
.summary { display: flex; align-items: center; gap: 12px; color: var(--muted); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: #d14343; }
.dot.on { background: var(--ok); }
main { max-width: 900px; margin: 0 auto; padding: 28px 16px 190px; display: grid; gap: 12px; }
.error { color: #d14343; text-align: center; }
.dragging { opacity: 0.4; }
.drop-before { box-shadow: 0 -3px 0 var(--accent); }
.drop-after { box-shadow: 0 3px 0 var(--accent); }
.empty { color: var(--muted); text-align: center; }
.package { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.package.disabled { opacity: 0.55; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.badge { font-size: 0.75rem; text-transform: uppercase; color: var(--muted); }
.running .badge { color: var(--accent); }
.finished .badge { color: var(--ok); }
.bar { height: 8px; margin: 10px 0 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
.fill { height: 100%; background: var(--accent); transition: width 0.5s; }
.finished .fill { background: var(--ok); }
.meta { gap: 4px 16px; color: var(--muted); font-size: 0.85rem; }
.status { margin-top: 4px; }
</style>
