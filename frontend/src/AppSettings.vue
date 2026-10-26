<script setup lang="ts">
import { Eye, EyeOff } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { androidBridge } from './appBridge'
import { showError, showSuccess } from './toast'

// The connection data of the Android app. They are read from and saved to the phone through the app's bridge, the
// backend never sees them as settings.
const url = ref('')
const password = ref('')
const show = ref(false)
const saving = ref(false)

onMounted(() => {
  try {
    const config = JSON.parse(androidBridge?.getConfig() ?? '{}')
    url.value = config.url ?? ''
    password.value = config.password ?? ''
  } catch {
    /* empty form */
  }
})

const save = () => {
  saving.value = true
  const error = androidBridge?.setConfig(url.value.trim(), password.value)
  saving.value = false
  if (error) showError(error)
  else showSuccess('Saved, reloading ...')
}
</script>

<template>
  <form class="app" @submit.prevent="save">
    <label>
      Backend address
      <small>Where this interface is served, e.g. http://192.168.1.10:3000</small>
      <input v-model="url" type="url" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="http://192.168.1.10:3000" />
    </label>
    <label>
      Password
      <small>The UI password, empty if the backend has none</small>
      <span class="pw">
        <input v-model="password" :type="show ? 'text' : 'password'" autocapitalize="off" autocomplete="off" spellcheck="false" />
        <button type="button" class="eye" :title="show ? 'Hide' : 'Show'" @click="show = !show">
          <EyeOff v-if="show" :size="16" /><Eye v-else :size="16" />
        </button>
      </span>
    </label>
    <p class="hint">These values are stored on this phone only. Saving reloads the interface from the address above.</p>
    <div><button type="submit" class="save" :disabled="saving || !url.trim()">Save</button></div>
  </form>
</template>

<style scoped>
.app { display: grid; gap: 14px; max-width: 480px; }
label { display: grid; gap: 4px; font-weight: 600; }
small { color: var(--muted); font-weight: 400; }
input { width: 100%; box-sizing: border-box; padding: 8px 10px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; font-weight: 400; }
input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.pw { position: relative; display: block; }
.pw input { padding-right: 38px; }
.eye { position: absolute; right: 2px; top: 50%; transform: translateY(-50%); display: inline-flex; padding: 8px; background: none; border: 0; color: var(--muted); cursor: pointer; }
.hint { margin: 0; color: var(--muted); font-size: 0.85rem; }
.save { padding: 8px 18px; background: var(--accent); color: #fff; border: 0; border-radius: 6px; font: inherit; cursor: pointer; }
.save:disabled { opacity: 0.5; cursor: default; }
</style>
