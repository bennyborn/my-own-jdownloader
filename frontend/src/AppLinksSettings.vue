<script setup lang="ts">
import { ref } from 'vue'
import { androidBridge } from './appBridge'
import { defaultDevice, devices, multiple } from './devices'

// Where links from outside this interface go: Click'n'Load on this phone and "share" from other apps. Kept on the phone.
const choice = ref(androidBridge?.getCnlDevice() ?? '')
const change = () => androidBridge?.setCnlDevice(choice.value)
</script>

<template>
  <div class="form">
    <label class="field">
      Send them to
      <select v-model="choice" @change="change">
        <option value="">Default device<template v-if="multiple && defaultDevice"> ({{ defaultDevice.name }})</template></option>
        <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }}<template v-if="d.online === false"> (offline)</template></option>
        <option v-if="multiple" value="ask">Ask every time</option>
      </select>
    </label>
    <p class="hint">
      This is where links go that reach the phone from outside: websites with Click'n'Load (switch it on with the logo button in the header) and links you share from other apps.
      <template v-if="multiple">"Ask every time" sends a notification with the devices to choose from.</template>
    </p>
  </div>
</template>

<style scoped src="./appSettings.css"></style>
