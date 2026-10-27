<script setup lang="ts">
import { ref, watch } from 'vue'
import { deviceName, settingsDevice, withDevice } from './devices'
import { MENU_ENTRIES, menuEntryOn, resetMenuEntries, setMenuEntry } from './menuConfig'

// The archive extractor is a switch of each JD: the entries that need it are greyed out for a device that has it off.
const extractionEnabled = ref(true)
watch(
  settingsDevice,
  async (device) => {
    extractionEnabled.value = true
    try {
      const res = await fetch(withDevice('/api/jd-settings', device))
      if (res.ok && settingsDevice.value === device) extractionEnabled.value = (await res.json()).extractionEnabled !== false
    } catch {
      /* assume it is on */
    }
  },
  { immediate: true }
)
const blocked = (e: { needsExtraction?: boolean }) => !!e.needsExtraction && !extractionEnabled.value
</script>

<template>
  <section>
    <p class="intro">Which entries the context menu of packages and links shows. Start / stop, enable / disable, add to downloads, variants, merge and remove are always there.</p>
    <ul>
      <li v-for="e in MENU_ENTRIES" :key="e.id" :class="{ blocked: blocked(e) }">
        <label>
          <input type="checkbox" :checked="menuEntryOn(e.id)" :disabled="blocked(e)" @change="setMenuEntry(e.id, ($event.target as HTMLInputElement).checked)" />
          <span class="text">
            <span class="label">{{ e.label }}</span>
            <span class="hint">{{ blocked(e) ? `Not available: the archive extractor is disabled on ${deviceName(settingsDevice) || 'this device'} (Settings > Extensions)` : e.hint }}</span>
          </span>
        </label>
      </li>
    </ul>
    <button type="button" @click="resetMenuEntries">Reset to defaults</button>
  </section>
</template>

<style scoped>
.intro { margin: 0 0 12px; color: var(--muted); line-height: 1.5; }
ul { margin: 0 0 14px; padding: 0; list-style: none; border: 1px solid var(--border); border-radius: 8px; }
li + li { border-top: 1px solid var(--border); }
label { display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; cursor: pointer; }
.blocked label { cursor: default; opacity: 0.55; }
input { margin-top: 3px; }
.text { display: grid; gap: 2px; }
.hint { color: var(--muted); font-size: 0.85rem; }
button { padding: 7px 16px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
</style>
