<script setup lang="ts">
import { ArrowUpCircle, Check, ChevronDown, Layers, Server, ServerOff } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ALL, anyUpdate, devices, updates } from './devices'

// Graphical device dropdown (header: with the "All devices" overview; add dialog: full width, offline devices disabled).
const props = defineProps<{ modelValue: string; withAll?: boolean; block?: boolean; disableOffline?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const showingAll = computed(() => props.withAll && props.modelValue === ALL)
const current = computed(() => devices.value.find((d) => d.id === props.modelValue))
const label = computed(() => (showingAll.value ? 'All devices' : (current.value?.name ?? '')))

const choose = (id: string, offline: boolean) => {
  if (offline && props.disableOffline) return
  emit('update:modelValue', id)
  open.value = false
}
const onDocumentClick = (e: MouseEvent) => {
  if (open.value && !root.value?.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <div ref="root" class="switch" :class="{ block }">
    <button type="button" class="trigger" aria-haspopup="listbox" :aria-expanded="open" title="Switch device" @click="open = !open" @keydown.esc="open = false">
      <Layers v-if="showingAll" :size="16" />
      <ServerOff v-else-if="current?.online === false" :size="16" class="off" />
      <Server v-else :size="16" :class="{ on: current?.online }" />
      <span class="name">{{ label }}</span>
      <span v-if="anyUpdate" class="update-dot" title="A JDownloader update is available" />
      <ChevronDown :size="14" class="chevron" />
    </button>
    <ul v-if="open" class="menu" role="listbox">
      <li
        v-for="d in devices"
        :key="d.id"
        role="option"
        :aria-selected="!showingAll && d.id === modelValue"
        :aria-disabled="disableOffline && d.online === false"
        :class="{ offline: d.online === false, disabled: disableOffline && d.online === false, active: !showingAll && d.id === modelValue }"
        @click="choose(d.id, d.online === false)"
      >
        <ServerOff v-if="d.online === false" :size="16" class="off" />
        <Server v-else :size="16" :class="{ on: d.online }" />
        <span v-if="anyUpdate" class="slot"><ArrowUpCircle v-if="updates[d.id]" :size="14" class="update" title="A JDownloader update is available" /></span>
        <span class="label">{{ d.name }}</span>
        <span v-if="d.online === false" class="state">offline</span>
        <Check v-else-if="!showingAll && d.id === modelValue" :size="14" />
      </li>
      <li v-if="withAll" class="all" role="option" :aria-selected="showingAll" :class="{ active: showingAll }" @click="choose(ALL, false)">
        <Layers :size="16" />
        <span v-if="anyUpdate" class="slot" />
        <span class="label">All devices</span>
        <Check v-if="showingAll" :size="14" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.switch { position: relative; }
.switch.block { width: 100%; }
.trigger { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 8px; font: inherit; cursor: pointer; }
.block .trigger { width: 100%; height: auto; padding: 8px 10px; border-radius: 6px; }
.block .trigger .name { flex: 1; max-width: none; text-align: left; }
.block .chevron { margin-left: auto; }
.trigger:hover { background: var(--hover); }
.trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.trigger .name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.update { flex: none; color: var(--extract); }
.slot { display: inline-flex; flex: none; width: 14px; } /* keeps the names in one column, whether a device has an update or not */
.update-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--extract); }
.on { color: var(--ok); }
.off { color: var(--muted); }
.menu { position: absolute; z-index: 50; top: calc(100% + 6px); right: 0; min-width: 220px; margin: 0; padding: 4px; list-style: none; background: var(--card); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); }
.block .menu { left: 0; right: 0; min-width: 0; }
li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; cursor: pointer; }
li:hover { background: var(--hover); }
li.active { font-weight: 600; }
li.offline { color: var(--muted); }
li.disabled { cursor: not-allowed; opacity: 0.6; }
li.disabled:hover { background: none; }
li.all { margin-top: 4px; border-top: 1px solid var(--border); border-radius: 0 0 6px 6px; padding-top: 10px; }
.label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.state { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
</style>
