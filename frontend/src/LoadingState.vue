<script setup lang="ts">
import { Loader } from 'lucide-vue-next'

// The placeholder while a page or section loads: a turning icon with the text underneath, in the style of the "empty" pages.
// page: the whole main area, section: one section of the settings, inline: inside a block of its own.
withDefaults(defineProps<{ text?: string; variant?: 'page' | 'section' | 'inline' }>(), { text: 'Loading…', variant: 'section' })
</script>

<template>
  <div class="loading" :class="variant" role="status" aria-live="polite">
    <Loader :size="variant === 'page' ? 56 : variant === 'section' ? 44 : 24" :stroke-width="1.25" class="spin" />
    <p>{{ text }}</p>
  </div>
</template>

<style scoped>
.loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--muted); text-align: center; }
.loading.page { min-height: 55vh; }
.loading.section { min-height: 40vh; }
.loading.inline { padding: 18px 0; }
.loading p { margin: 8px 0 0; font-size: 1.05rem; color: var(--text); }
.loading.inline p { margin: 0; font-size: 0.9rem; color: var(--muted); }
.spin { animation: spin 1.2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
