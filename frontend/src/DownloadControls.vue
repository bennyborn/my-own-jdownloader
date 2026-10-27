<script setup lang="ts">
import { ArrowUpCircle, Pause, Play, Square } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { askConfirm } from './confirm'
import { devices, updates, withDevice } from './devices'
import { showError } from './toast'
import type { DownloadsSnapshot } from './types'

// Start, pause and stop for the whole JDownloader; in the overview for every online device.
const props = defineProps<{ snapshots: Record<string, DownloadsSnapshot>; targets: string[] }>()

const busy = ref(false)
const states = computed(() => props.targets.map((id) => ({ id, state: props.snapshots[id]?.state ?? '' })))
const withState = (...wanted: string[]) => states.value.filter((s) => wanted.includes(s.state)).map((s) => s.id)

// The big button does what makes sense next: pause what runs, else resume what is paused, else start what is not running.
const action = computed<'pause' | 'resume' | 'start' | null>(() => {
  if (withState('running').length) return 'pause'
  if (withState('pause').length) return 'resume'
  if (withState('idle', 'stopped').length) return 'start'
  return null
})
const canStop = computed(() => withState('running', 'pause').length > 0)

const LABELS = { pause: 'Pause all downloads', resume: 'Resume downloads', start: 'Start downloads' }
const label = computed(() => (action.value ? LABELS[action.value] : 'Download state unknown'))
const state = computed(() => (action.value === 'pause' ? 'running' : action.value === 'resume' ? 'paused' : 'stopped'))

// An update JD found: a third button appears (the devices module looks for updates now and then).
const updateAvailable = computed(() => updates.value[props.targets[0]] === true)

const update = async () => {
  const device = props.targets[0]
  const ok = await askConfirm({
    title: 'Update JDownloader',
    message: `JDownloader${deviceNames([device])} will stop all downloads, restart and install the update. It is offline for a few minutes.`,
    confirmLabel: 'Update and restart',
    danger: true
  })
  if (!ok) return
  busy.value = true
  try {
    const res = await fetch(withDevice('/api/update/install', device), { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    updates.value = { ...updates.value, [device]: false }
  } catch (e) {
    showError(`Update failed: ${e instanceof Error ? e.message : e}`)
  } finally {
    busy.value = false
  }
}

const send = async (ids: string[], what: 'start' | 'pause' | 'resume' | 'stop') => {
  busy.value = true
  try {
    await Promise.all(
      ids.map(async (id) => {
        const res = await fetch(withDevice('/api/downloads/control', id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: what })
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      })
    )
  } catch (e) {
    showError(`${what === 'stop' ? 'Stopping' : 'Changing the download state'} failed: ${e instanceof Error ? e.message : e}`)
  } finally {
    busy.value = false
  }
}

const deviceNames = (ids: string[]) => (devices.value.length > 1 ? ` on ${ids.map((id) => devices.value.find((d) => d.id === id)?.name ?? id).join(', ')}` : '')

const primary = async () => {
  const what = action.value
  if (!what) return
  if (what !== 'start') return void send(what === 'pause' ? withState('running') : withState('pause'), what)
  const ids = withState('idle', 'stopped')
  const ok = await askConfirm({ title: 'Start downloads', message: `The download queue${deviceNames(ids)} will be started.`, confirmLabel: 'Start' })
  if (ok) void send(ids, 'start')
}

const stop = async () => {
  const ids = withState('running', 'pause')
  const ok = await askConfirm({
    title: 'Stop downloads',
    message: `All running downloads${deviceNames(ids)} will be stopped.`,
    confirmLabel: 'Stop',
    danger: true
  })
  if (ok) void send(ids, 'stop')
}
</script>

<template>
  <div class="controls" role="group" aria-label="Downloads">
    <button type="button" class="play" :class="state" :title="label" :aria-label="label" :disabled="busy || !action" @click="primary">
      <Pause v-if="action === 'pause'" :size="18" />
      <Play v-else :size="18" />
    </button>
    <button type="button" class="stop" title="Stop all downloads" aria-label="Stop all downloads" :disabled="busy || !canStop" @click="stop"><Square :size="16" /></button>
    <button v-if="updateAvailable" type="button" class="update" title="Update available (click to install)" aria-label="Update JDownloader" :disabled="busy" @click="update"><ArrowUpCircle :size="18" /></button>
  </div>
</template>

<style scoped>
.controls { display: inline-flex; flex: none; gap: 4px; }
button { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 0; background: var(--card); color: var(--muted); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; }
button:hover:not(:disabled) { color: var(--text); background: var(--hover); }
button:disabled { opacity: 0.45; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.play.running { color: var(--accent); }
.update { color: var(--extract); border-color: var(--extract); }
.update:hover:not(:disabled), .update:active:not(:disabled) { color: #1b1b1b; background: var(--extract); border-color: var(--extract); }
.stop:hover:not(:disabled) { color: #d14343; }
</style>
