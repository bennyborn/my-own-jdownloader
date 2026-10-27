<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { answerPrompt, promptState } from './prompt'

const field = ref<HTMLInputElement | null>(null)

watch(promptState, async (state) => {
  if (!state) return
  await nextTick()
  field.value?.focus()
})
</script>

<template>
  <div v-if="promptState" class="overlay" role="dialog" aria-modal="true" :aria-label="promptState.title" @keydown.esc="answerPrompt(false)">
    <form class="dialog" @submit.prevent="answerPrompt(true)">
      <h3>{{ promptState.title }}</h3>
      <p v-if="promptState.message">{{ promptState.message }}</p>
      <div v-if="promptState.choices" class="choices" role="radiogroup">
        <label v-for="c in promptState.choices" :key="c.value" class="choice">
          <input v-model="promptState.value" type="radio" :value="c.value" /> {{ c.label }}
        </label>
      </div>
      <input v-else ref="field" v-model="promptState.value" type="text" spellcheck="false" autocomplete="off" :placeholder="promptState.placeholder" />
      <div class="actions">
        <button type="button" @click="answerPrompt(false)">Cancel</button>
        <button type="submit" class="primary" :disabled="!promptState.allowEmpty && !promptState.value.trim()">{{ promptState.confirmLabel ?? 'OK' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 400; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(var(--overlay-blur)); -webkit-backdrop-filter: blur(var(--overlay-blur)); }
.dialog { display: grid; gap: 14px; width: min(440px, 100%); padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4); }
h3 { margin: 0; font-size: 1rem; }
p { margin: 0; color: var(--muted); line-height: 1.5; white-space: pre-line; }
input[type='text'] { box-sizing: border-box; width: 100%; padding: 9px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; }
input[type='text']:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.choices { display: grid; gap: 4px; }
.choice { display: flex; align-items: center; gap: 8px; padding: 6px 4px; cursor: pointer; }
.actions { display: flex; justify-content: flex-end; gap: 10px; }
button { padding: 7px 16px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button:disabled { opacity: 0.5; cursor: default; }
</style>
