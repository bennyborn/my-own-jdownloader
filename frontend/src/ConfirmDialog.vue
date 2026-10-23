<script setup lang="ts">
import { TriangleAlert } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import { answerConfirm, confirmState } from './confirm'

const confirmButton = ref<HTMLButtonElement | null>(null)

// Focus the confirm button so Enter confirms and Esc cancels.
watch(confirmState, async (state) => {
  if (!state) return
  await nextTick()
  confirmButton.value?.focus()
})
</script>

<template>
  <div v-if="confirmState" class="overlay" role="alertdialog" aria-modal="true" :aria-label="confirmState.title" @keydown.esc="answerConfirm(false)">
    <div class="dialog">
      <div class="head">
        <TriangleAlert v-if="confirmState.danger" :size="20" class="warn" />
        <h3>{{ confirmState.title }}</h3>
      </div>
      <p>{{ confirmState.message }}</p>
      <div class="actions">
        <button type="button" @click="answerConfirm(false)">Cancel</button>
        <button ref="confirmButton" type="button" class="primary" :class="{ danger: confirmState.danger }" @click="answerConfirm(true)">
          {{ confirmState.confirmLabel ?? 'OK' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 400; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.55); }
.dialog { display: grid; gap: 14px; width: min(440px, 100%); padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4); }
.head { display: flex; align-items: center; gap: 10px; }
.warn { color: #d14343; }
h3 { margin: 0; font-size: 1rem; }
p { margin: 0; color: var(--muted); overflow-wrap: anywhere; line-height: 1.5; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
button { padding: 7px 16px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.primary.danger { background: #d14343; border-color: #d14343; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.danger:focus-visible { outline-color: #d14343; }
</style>
