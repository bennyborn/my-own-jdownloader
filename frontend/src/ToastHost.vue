<script setup lang="ts">
import { CircleAlert, CircleCheck, Loader } from 'lucide-vue-next'
import { dismissToast, progress, toasts } from './toast'
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-if="progress" key="progress" class="toast info"><Loader :size="18" class="spin" /> <span>{{ progress }}</span></div>
      <button v-for="t in toasts" :key="t.id" type="button" class="toast" :class="{ success: t.kind === 'success' }" title="Click to dismiss" @click="dismissToast(t.id)">
        <component :is="t.kind === 'success' ? CircleCheck : CircleAlert" :size="18" /> <span>{{ t.message }}</span>
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts { position: fixed; right: 16px; bottom: 56px; z-index: 600; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; max-width: min(420px, calc(100vw - 32px)); pointer-events: none; }
.toast { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; background: var(--card); color: var(--text); border: 1px solid #d14343; border-left-width: 4px; border-radius: 8px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35); font: inherit; text-align: left; overflow-wrap: anywhere; cursor: pointer; pointer-events: auto; }
.toast-enter-active, .toast-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.toast-enter-from { opacity: 0; transform: translateX(24px); }
.toast-leave-to { opacity: 0; transform: translateY(8px); }
.toast-move { transition: transform 0.25s ease; }
.toast.info { border-color: var(--border); border-left-color: var(--accent); cursor: default; }
.toast.info svg { color: var(--accent); }
.toast.success { border-color: var(--border); border-left-color: var(--ok); }
.toast.success svg { color: var(--ok); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.toast svg { flex: none; margin-top: 2px; color: #d14343; }
</style>
