<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { androidBridge } from './appBridge'

// Updates the app from the APK of the backend (android/Updater.kt does the work). Checked at every start; here by hand.
const read = (json?: string) => {
  try {
    return JSON.parse(json || '{}')
  } catch {
    return {}
  }
}
const installed = ref<{ name?: string; code?: number }>({})
const state = ref<{ kind?: string; name?: string; message?: string }>({})
const refresh = () => (state.value = read(androidBridge?.updateState()))

onMounted(() => {
  installed.value = read(androidBridge?.appVersion())
  refresh()
  window.addEventListener('android-state', refresh)
})
onUnmounted(() => window.removeEventListener('android-state', refresh))

const busy = computed(() => ['checking', 'downloading', 'installing'].includes(state.value.kind ?? ''))
const text = computed(() => {
  const s = state.value
  switch (s.kind) {
    case 'checking': return 'Looking for a newer version ...'
    case 'current': return 'This is the newest version.'
    case 'unavailable': return s.message
    case 'available': return `Version ${s.name} is available.`
    case 'downloading': return `Downloading version ${s.name} ...`
    case 'installing': return 'Waiting for the confirmation of Android ...'
    case 'error': return s.message
    default: return ''
  }
})
</script>

<template>
  <div class="form">
    <p class="hint">Installed: version {{ installed.name }} (build {{ installed.code }}).</p>
    <p v-if="text" :class="['state', { bad: state.kind === 'error' }]" role="status">{{ text }}</p>
    <div class="buttons">
      <button v-if="state.kind === 'available'" type="button" class="save" @click="androidBridge?.installUpdate()">Download and install</button>
      <button v-else type="button" class="save" :disabled="busy" @click="androidBridge?.checkUpdate()">Check for updates</button>
    </div>
    <p class="hint">
      The app looks for a newer version on your backend every time it starts. Android always asks before it installs one, and the first time it asks you to allow this app to install apps.
    </p>
  </div>
</template>

<style scoped src="./appSettings.css"></style>
<style scoped>
.state { margin: 0; }
.state.bad { color: var(--danger, #d64545); }
.save { padding: 8px 18px; background: var(--accent); color: #fff; border: 0; border-radius: 6px; font: inherit; cursor: pointer; }
.save:disabled { opacity: 0.5; cursor: default; }
</style>
