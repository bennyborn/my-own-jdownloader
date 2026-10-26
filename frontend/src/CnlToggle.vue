<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { androidBridge, inApp } from './appBridge'
import { askConfirm } from './confirm'

// Click'n'Load on the phone (Android app only): websites send their links to "a JDownloader on this device". The app answers
// them from a small background service and passes the links on to the backend. A browser extension does that on a computer.
const on = ref(androidBridge?.cnlState() === 'on')
const refresh = () => (on.value = androidBridge?.cnlState() === 'on')
onMounted(() => window.addEventListener('android-state', refresh))
onUnmounted(() => window.removeEventListener('android-state', refresh))

const click = async () => {
  if (!androidBridge) return
  if (on.value) {
    androidBridge.setCnl(false)
    return
  }
  const ok = await askConfirm({
    title: "Click'n'Load on this phone",
    message: `Websites with Click'n'Load send their links to a JDownloader on your own device. To receive them here, the app starts a small service in the background (port 9666, reachable from this phone only) and passes the links on to your backend.

Android shows a permanent notification while it runs, and it uses a little battery. You can stop it again with this button.`,
    confirmLabel: 'Start service'
  })
  if (ok) androidBridge.setCnl(true)
}
</script>

<template>
  <button v-if="inApp" type="button" class="cnl" :class="{ on }" :title="on ? 'Click\'n\'Load is on (click to switch off)' : 'Click\'n\'Load is off (click to switch on)'" :aria-label="on ? 'Switch Click\'n\'Load off' : 'Switch Click\'n\'Load on'" @click="click">
    <span class="icon" aria-hidden="true"><span class="logo" /><span v-if="!on" class="strike" /></span>
  </button>
</template>

<style scoped>
.cnl { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; padding: 0; background: var(--card); border: 1px solid var(--border); border-radius: 12px; color: var(--muted); cursor: pointer; }
.cnl:hover { color: var(--text); background: var(--hover); }
.cnl.on { color: var(--accent); }
.icon { position: relative; display: block; width: 15px; height: 15px; } /* like the other icons of the header (size 15) */
.logo { display: block; width: 100%; height: 100%; background: currentColor; mask: url(/logo-outline.svg) center / contain no-repeat; }
/* Off: struck through from top left to bottom right like the bell, with a gap of 1px around the line cut out of the logo. */
.cnl:not(.on) .logo {
  mask: url(/logo-outline.svg) center / contain no-repeat, linear-gradient(45deg, transparent calc(50% - 1.75px), #000 calc(50% - 1.75px), #000 calc(50% + 1.75px), transparent calc(50% + 1.75px));
  mask-composite: subtract;
}
.strike { position: absolute; left: 50%; top: 50%; width: 17.5px; height: 1.5px; border-radius: 1px; background: currentColor; transform: translate(-50%, -50%) rotate(45deg); }
</style>
