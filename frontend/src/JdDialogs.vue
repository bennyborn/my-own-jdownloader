<script setup lang="ts">
import { Server } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useDialogs } from './useDialogs'

// The questions a JDownloader would ask on its own screen (links that are already there, an unknown archive password, ...).
const { current, more, multiple, answer } = useDialogs()

const index = ref(0)
const picked = ref<number[]>([])
const text = ref('')
const username = ref('')
const password = ref('')
const verification = ref('')
const remember = ref(false)
watch(
  current,
  (d) => {
    index.value = d?.preselected ?? 0
    picked.value = []
    text.value = d?.defaultText ?? ''
    username.value = d?.defaultUsername ?? ''
    password.value = ''
    verification.value = ''
    remember.value = d?.remember ?? false
  },
  { immediate: true }
)

// Two different passwords cannot be sent.
const ready = computed(() => current.value?.kind !== 'newpassword' || (password.value !== '' && password.value === verification.value))

const ok = () => {
  const d = current.value
  if (!d || !ready.value) return
  const body = {
    choice: { index: index.value },
    multi: { indices: [...picked.value].sort((a, b) => a - b) },
    input: { text: text.value },
    login: { username: username.value, password: password.value, ...(d.rememberOption ? { remember: remember.value } : {}) },
    newpassword: { password: password.value, verification: verification.value }
  }[d.kind as 'choice' | 'multi' | 'input' | 'login' | 'newpassword']
  void answer(d, { cancel: false, ...body })
}
const cancel = () => current.value && void answer(current.value, { cancel: true })
</script>

<template>
  <div v-if="current" class="overlay" role="dialog" aria-modal="true" :aria-label="current.title" @keydown.esc="cancel">
    <form class="dialog" @submit.prevent="ok">
      <p v-if="multiple || more" class="from">
        <template v-if="multiple"><Server :size="14" class="icon" /> {{ current.deviceName }}</template>
        <template v-if="multiple && more"> · </template>
        <template v-if="more">{{ more }} more waiting</template>
      </p>
      <h3>{{ current.title || 'JDownloader asks' }}</h3>
      <p v-if="current.message">{{ current.message }}</p>
      <dl v-if="current.details.length" class="details">
        <div v-for="d in current.details" :key="d.label"><dt>{{ d.label }}</dt><dd>{{ d.value }}</dd></div>
      </dl>
      <div v-if="current.kind === 'choice'" class="choices" role="radiogroup">
        <label v-for="(label, i) in current.choices" :key="i" class="choice"><input v-model="index" type="radio" :value="i" /> {{ label }}</label>
      </div>
      <div v-else-if="current.kind === 'multi'" class="choices">
        <label v-for="(label, i) in current.choices" :key="i" class="choice"><input v-model="picked" type="checkbox" :value="i" /> {{ label }}</label>
      </div>
      <input v-else-if="current.kind === 'input'" v-model="text" type="text" spellcheck="false" autocomplete="off" aria-label="Answer" />
      <template v-else-if="current.kind === 'login'">
        <input v-model="username" type="text" spellcheck="false" autocomplete="off" aria-label="User name" placeholder="User name" />
        <input v-model="password" type="password" autocomplete="new-password" aria-label="Password" placeholder="Password" />
        <label v-if="current.rememberOption" class="choice"><input v-model="remember" type="checkbox" /> Remember</label>
      </template>
      <template v-else-if="current.kind === 'newpassword'">
        <input v-model="password" type="password" autocomplete="new-password" aria-label="Password" placeholder="Password" />
        <input v-model="verification" type="password" autocomplete="new-password" aria-label="Repeat the password" placeholder="Repeat the password" />
      </template>
      <p v-else-if="current.kind === 'other'" class="from">This kind of question can only be cancelled here. Answer it in the JDownloader if it needs more.</p>
      <div class="actions">
        <button v-if="current.kind !== 'message'" type="button" @click="cancel">{{ current.cancelText || 'Cancel' }}</button>
        <button v-if="current.kind !== 'other'" type="submit" class="primary" :disabled="!ready">{{ current.okText || 'OK' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 450; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(var(--overlay-blur)); -webkit-backdrop-filter: blur(var(--overlay-blur)); }
.dialog { display: grid; gap: 14px; width: min(480px, 100%); padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4); }
h3 { margin: 0; font-size: 1rem; }
p { margin: 0; color: var(--muted); overflow-wrap: anywhere; line-height: 1.5; white-space: pre-line; }
.from { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 0.8rem; }
.icon { flex: none; }
.details { display: grid; gap: 4px; margin: 0; font-size: 0.85rem; }
.details div { display: flex; gap: 10px; }
.details dt { flex: none; width: 70px; color: var(--muted); }
.details dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
input[type='text'], input[type='password'] { box-sizing: border-box; width: 100%; padding: 9px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; }
.choices { display: grid; gap: 4px; }
.choice { display: flex; align-items: center; gap: 8px; padding: 6px 4px; cursor: pointer; }
.actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
button { padding: 7px 16px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
