<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDownloads } from './useDownloads'
import StatusBar from './StatusBar.vue'
import PackageCard from './PackageCard.vue'
import { reorderLocally, useDragReorder } from './dragReorder'

const { snapshot, connected } = useDownloads()

const packages = computed(() => snapshot.value?.packages ?? [])
const moveError = ref('')

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
  </header>

  <main>
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
  </main>

  <StatusBar :snapshot="snapshot" :connected="connected" />
</template>

<style>
:root {
  color-scheme: light dark;
  --bg: #f6f7f9;
  --card: #fff;
  --text: #1c1f23;
  --muted: #6b7280;
  --border: #e3e6ea;
  --accent: #2f7de1;
  --ok: #22a55b;
  --fill-soft: var(--border);
  --hover: rgba(127, 127, 127, 0.1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161a;
    --card: #1d2026;
    --text: #e6e8eb;
    --muted: #9099a6;
    --border: #2b2f37;
  }
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
h2 { margin: 0; font-size: 1rem; overflow-wrap: anywhere; }
.summary { display: flex; align-items: center; gap: 12px; color: var(--muted); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: #d14343; }
.dot.on { background: var(--ok); }
main { max-width: 900px; margin: 0 auto; padding: 16px 16px 90px; display: grid; gap: 12px; }
.error { color: #d14343; text-align: center; }
.dragging { opacity: 0.4; }
.drop-before { box-shadow: 0 -3px 0 var(--accent); }
.drop-after { box-shadow: 0 3px 0 var(--accent); }
.empty { color: var(--muted); text-align: center; }
.package { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.package.disabled { opacity: 0.6; }
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
