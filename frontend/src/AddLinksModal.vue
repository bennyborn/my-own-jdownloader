<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { onMounted, onUnmounted } from 'vue'
import AddLinksForm from './AddLinksForm.vue'

defineEmits<{ close: []; added: [device: string] }>()

// The dialog can only be closed with its buttons (no backdrop click, no Escape),
// so entered data is never lost by accident. The page behind it does not scroll.
onMounted(() => (document.body.style.overflow = 'hidden'))
onUnmounted(() => (document.body.style.overflow = ''))
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Add links">
    <div class="dialog">
      <header>
        <h2>Add links</h2>
        <button type="button" class="close" title="Cancel" @click="$emit('close')"><X :size="16" /></button>
      </header>
      <div class="body"><AddLinksForm @added="$emit('added', $event)" @cancel="$emit('close')" /></div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(var(--overlay-blur)); -webkit-backdrop-filter: blur(var(--overlay-blur)); display: flex; align-items: center; justify-content: center; padding: 16px; }
.dialog { display: flex; flex-direction: column; width: min(720px, 100%); max-height: 70vh; max-height: 70dvh; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--card); }
h2 { margin: 0; font-size: 1.05rem; }
.close { display: inline-flex; background: none; color: var(--muted); border: 0; border-radius: 6px; padding: 4px; cursor: pointer; }
.close:hover { color: var(--text); background: var(--hover); }
.body { overflow-x: hidden; overflow-y: auto; padding: 16px; }
</style>
