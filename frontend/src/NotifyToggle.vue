<script setup lang="ts">
import { Bell, BellOff } from 'lucide-vue-next'
import { computed } from 'vue'
import { inApp } from './appBridge'
import { showInfo } from './confirm'
import { notifyState, notifyTest, toggleNotifications } from './useNotifications'

const hint = computed(
  () =>
    ({
      unsupported: 'This browser has no notifications',
      insecure: 'Not available on this page (click for details)',
      blocked: inApp ? 'Notifications are blocked for this app (click to open the Android settings)' : 'Notifications are blocked for this site (click for details)',
      ask: 'Click to allow notifications for new captchas',
      on: 'Notifications for new captchas are on (click to switch off)',
      off: 'Notifications for new captchas are off (click to switch on)'
    })[notifyState.value]
)
const usable = computed(() => notifyState.value === 'ask' || notifyState.value === 'on' || notifyState.value === 'off')

// Why the bell cannot be switched on here (shown in a dialog; a tooltip is too small for this).
const explanation = (): { title: string; message: string } | null => {
  if (inApp) return null // the app opens the Android settings itself
  if (notifyState.value === 'insecure') {
    return {
      title: 'Notifications are not available here',
      message: `Browsers only allow notifications on secure pages: https:// or localhost. This page is served from ${location.origin}, so the browser refuses them.

Two ways out:
• Open the web interface over https, for example behind a reverse proxy with a certificate.
• Use the notifications of the browser extension (extension settings → "Notify me about captchas"). They work with any address.`
    }
  }
  if (notifyState.value === 'blocked') {
    return {
      title: 'Notifications are blocked',
      message: 'You (or the browser) blocked notifications for this site.\n\nAllow them again in the browser: click the icon left of the address in the address bar, open the site settings, set "Notifications" to "Allow", and reload this page.'
    }
  }
  return null
}

const click = async () => {
  const info = explanation()
  if (info) {
    await showInfo(info.title, info.message)
    return
  }
  const before = notifyState.value
  await toggleNotifications()
  if (before === 'ask' && notifyState.value === 'on') notifyTest()
}
</script>

<template>
  <button v-if="notifyState !== 'unsupported'" type="button" class="bell" :class="{ on: notifyState === 'on', unavailable: !usable }" :title="hint" :aria-label="hint" @click="click">
    <Bell v-if="notifyState === 'on'" :size="15" />
    <BellOff v-else :size="15" />
  </button>
</template>

<style scoped>
.bell { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; padding: 0; background: var(--card); border: 1px solid var(--border); border-radius: 12px; color: var(--muted); cursor: pointer; }
.bell:hover { color: var(--text); background: var(--hover); }
.bell.on { color: var(--accent); }
.bell.unavailable { opacity: 0.55; } /* still clickable: it explains why */
</style>
