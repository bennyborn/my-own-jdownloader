<script setup lang="ts">
import { ref } from 'vue'
import { androidBridge } from './appBridge'

// What the app notifies about (the bell in the header switches all of it on and off). Kept on the phone.
const downloads = ref(androidBridge?.getNotifyDownloads() ?? true)
const change = () => androidBridge?.setNotifyDownloads(downloads.value)
</script>

<template>
  <div class="form">
    <label class="check">
      <input v-model="downloads" type="checkbox" @change="change" />
      <span>Finished downloads<small>A notification when a package is done, while the app is not in front. Checked every 30 seconds.</small></span>
    </label>
    <p class="hint">New captchas always notify. Use the bell in the header to switch all notifications off.</p>
  </div>
</template>

<style scoped src="./appSettings.css"></style>
