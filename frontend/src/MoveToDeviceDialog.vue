<script setup lang="ts">
import { computed } from 'vue'
import { Server, X } from '@lucide/vue'
import { currentDevice, devices } from './devices'
import { changeTick, choosingDevice } from './itemActions'
import { moveToDevice } from './crossDeviceDrag'

const sourceDevice = computed(() => choosingDevice.value?.device ?? currentDevice.value)
const targets = computed(() => devices.value.filter((d) => d.id !== sourceDevice.value && d.online !== false))

const close = () => (choosingDevice.value = null)
// moveToDevice shows its own confirmation next, then (once confirmed) the blocking "moving" dialog with a
// spinner (MovingDialog.vue) while it waits for the backend, so this picker is done as soon as one is chosen.
const pick = (deviceId: string) => {
  const t = choosingDevice.value
  close()
  if (!t) return
  void moveToDevice({ area: t.area, device: sourceDevice.value, packageId: t.id, name: t.name, hasProgress: t.running === true || t.started === true }, deviceId, () => changeTick.value++)
}
</script>

<template>
  <div v-if="choosingDevice" class="overlay" role="dialog" aria-modal="true" aria-label="Move to device" @keydown.esc="close">
    <div class="dialog">
      <header>
        <div>
          <h3>Move to device</h3>
          <p class="sub" :title="choosingDevice.name">{{ choosingDevice.name }}</p>
        </div>
        <button type="button" class="icon" title="Close" @click="close"><X :size="16" /></button>
      </header>
      <ul class="list">
        <li v-for="d in targets" :key="d.id">
          <button type="button" @click="pick(d.id)">
            <Server :size="15" /> {{ d.name }}
          </button>
        </li>
        <li v-if="!targets.length" class="muted">No other device is online.</li>
      </ul>
      <div class="actions">
        <button type="button" @click="close">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(var(--overlay-blur)); -webkit-backdrop-filter: blur(var(--overlay-blur)); }
.dialog { display: grid; gap: 12px; width: min(380px, 100%); max-height: calc(100vh - 32px); padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
h3 { margin: 0; font-size: 1rem; }
.sub { margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; color: var(--muted); font-size: 0.85rem; }
.list { margin: 0; padding: 0; list-style: none; max-height: min(320px, 45vh); overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; }
.list li + li { border-top: 1px solid var(--border); }
.list button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; background: none; border: 0; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.list button:hover:not(:disabled) { background: var(--hover); }
.list button:disabled { opacity: 0.5; cursor: default; }
.muted { display: block; padding: 10px 12px; color: var(--muted); font-size: 0.85rem; }
.actions { display: flex; align-items: center; justify-content: flex-end; }
.actions button { padding: 7px 16px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.icon { padding: 5px; border: none; background: none; }
</style>
