<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { androidBridge } from './appBridge'
import { showError } from './toast'

// The app lock (Android app only): the phone's fingerprint / PIN opens the app. It keeps eyes out, it does not encrypt.
// Everything is kept on the phone, switching it on or off asks for the phone's credentials first.
const state = ref({ enabled: false, after: 1, hide: false, available: true })

const load = () => {
  try {
    state.value = { ...state.value, ...JSON.parse(androidBridge?.getLock() ?? '{}') }
  } catch {
    /* defaults */
  }
}
onMounted(() => {
  load()
  window.addEventListener('android-state', load)
})
onUnmounted(() => window.removeEventListener('android-state', load))

const apply = (patch: Partial<typeof state.value>) => {
  const next = { ...state.value, ...patch }
  try {
    const error = androidBridge?.setLock(next.enabled, next.after, next.hide)
    if (error) showError(error)
  } catch (e) {
    showError(`The lock could not be changed: ${e instanceof Error ? e.message : e}`)
  }
  load()
}

// The checkbox follows the real state: switching asks the phone first, the app answers with an event.
const toggle = (e: Event) => {
  const box = e.target as HTMLInputElement
  box.checked = state.value.enabled
  apply({ enabled: !state.value.enabled })
}
</script>

<template>
  <div class="form">
    <label class="check">
      <input type="checkbox" :checked="state.enabled" @change="toggle" />
      <span>Lock the app<small>Unlock with your fingerprint, face or the PIN of the phone when the app starts</small></span>
    </label>
    <label class="field" :class="{ off: !state.enabled }">
      Lock again after
      <select :value="state.after" :disabled="!state.enabled" @change="apply({ after: Number(($event.target as HTMLSelectElement).value) })">
        <option :value="0">Every time</option>
        <option :value="1">1 minute in the background</option>
        <option :value="5">5 minutes in the background</option>
        <option :value="15">15 minutes in the background</option>
      </select>
    </label>
    <label class="check">
      <input type="checkbox" :checked="state.hide" @change="apply({ hide: ($event.target as HTMLInputElement).checked })" />
      <span>Hide the content in the app switcher<small>Also blocks screenshots</small></span>
    </label>
    <p class="hint">This keeps casual eyes away from your downloads. It does not encrypt anything.</p>
  </div>
</template>

<style scoped src="./appSettings.css"></style>
