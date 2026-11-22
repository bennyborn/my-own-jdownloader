<script setup lang="ts">
import { moving } from './crossDeviceDrag'
</script>

<template>
  <div v-if="moving" class="overlay" role="alertdialog" aria-modal="true" aria-live="polite">
    <div class="dialog">
      <div class="spinner" aria-hidden="true" />
      <p>{{ moving }}</p>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 400; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(var(--overlay-blur)); -webkit-backdrop-filter: blur(var(--overlay-blur)); }
.dialog { display: flex; flex-direction: column; align-items: center; gap: 14px; width: min(360px, 100%); padding: 28px 32px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; text-align: center; }
.spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
p { margin: 0; color: var(--text); font-size: 0.9rem; overflow-wrap: anywhere; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 1.6s; } }
</style>
