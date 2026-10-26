<script setup lang="ts">
import { ref } from 'vue'
import { androidBridge } from './appBridge'

// What the solver screen does once a captcha is done. Kept on the phone.
const options = (() => {
  try {
    return { next: true, after: 'back', ...JSON.parse(androidBridge?.getSolverOptions() ?? '{}') }
  } catch {
    return { next: true, after: 'back' }
  }
})()
const next = ref<boolean>(options.next)
const after = ref<string>(options.after)
const change = () => androidBridge?.setSolverOptions(next.value, after.value)
</script>

<template>
  <div class="form">
    <label class="check">
      <input v-model="next" type="checkbox" @change="change" />
      <span>Continue with the next captcha<small>If more captchas are waiting, the solver opens the next one by itself (the one with the least time left)</small></span>
    </label>
    <label class="field">
      When nothing is left
      <select v-model="after" @change="change">
        <option value="back">Go back to where I was</option>
        <option value="downloads">Show the downloads</option>
      </select>
    </label>
  </div>
</template>

<style scoped src="./appSettings.css"></style>
