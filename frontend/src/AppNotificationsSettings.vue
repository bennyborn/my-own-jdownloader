<script setup lang="ts">
import { ref } from 'vue'
import { androidBridge } from './appBridge'

// What the app notifies about (the bell in the header switches all of it on and off). Kept on the phone.
const downloads = ref(androidBridge?.getNotifyDownloads() ?? true)
const change = () => androidBridge?.setNotifyDownloads(downloads.value)
</script>

<template>
  <div class="notify">
    <label class="check">
      <input v-model="downloads" type="checkbox" @change="change" />
      <span>Finished downloads<small>A notification when a package is done, while the app is not in front. Checked every 30 seconds.</small></span>
    </label>
    <p class="hint">New captchas always notify. Use the bell in the header to switch all notifications off.</p>
  </div>
</template>

<style scoped>
.notify { display: grid; gap: 16px; max-width: 480px; }
.check { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
.check input { margin-top: 3px; accent-color: var(--accent); }
.check span { display: grid; gap: 2px; font-weight: 600; }
small { color: var(--muted); font-weight: 400; }
.hint { margin: 0; color: var(--muted); font-size: 0.85rem; }
</style>
