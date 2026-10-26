<script setup lang="ts">
import { Check, Layers, Server, ServerOff, X } from 'lucide-vue-next'
import { ALL, devices, select, showingAll, currentDevice } from './devices'

// Phone variant of the device switcher: opened from the "Devices" tab of the bottom bar.
const open = defineModel<boolean>({ required: true })
const choose = (id: string) => {
  select(id)
  open.value = false
}
</script>

<template>
  <div v-if="open" class="overlay" role="dialog" aria-modal="true" aria-label="Switch device" @click.self="open = false" @keydown.esc="open = false">
    <div class="dialog">
      <div class="head">
        <h3>Devices</h3>
        <button type="button" class="close" title="Close" @click="open = false"><X :size="18" /></button>
      </div>
      <ul role="listbox">
        <li v-for="d in devices" :key="d.id" role="option" :aria-selected="!showingAll && d.id === currentDevice" :class="{ offline: d.online === false, active: !showingAll && d.id === currentDevice }" @click="choose(d.id)">
          <ServerOff v-if="d.online === false" :size="18" class="off" />
          <Server v-else :size="18" :class="{ on: d.online }" />
          <span class="label">{{ d.name }}</span>
          <span v-if="d.online === false" class="state">offline</span>
          <Check v-else-if="!showingAll && d.id === currentDevice" :size="16" />
        </li>
        <li class="all" role="option" :aria-selected="showingAll" :class="{ active: showingAll }" @click="choose(ALL)">
          <Layers :size="18" />
          <span class="label">All devices</span>
          <Check v-if="showingAll" :size="16" />
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 400; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.55); }
.dialog { display: grid; gap: 8px; width: min(380px, 100%); padding: 16px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4); }
.head { display: flex; align-items: center; justify-content: space-between; }
h3 { margin: 0; font-size: 1rem; }
.close { display: inline-flex; padding: 6px; background: none; border: 0; color: var(--muted); cursor: pointer; }
ul { margin: 0; padding: 0; list-style: none; }
li { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 8px; cursor: pointer; }
li:hover { background: var(--hover); }
li.active { font-weight: 600; }
li.offline { color: var(--muted); }
li.all { margin-top: 4px; border-top: 1px solid var(--border); border-radius: 0 0 8px 8px; }
.on { color: var(--ok); }
.off { color: var(--muted); }
.label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.state { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
</style>
