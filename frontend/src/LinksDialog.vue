<script setup lang="ts">
import { Check, Copy, X } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import { showingLinks } from './itemActions'

const urls = ref<string[]>([])
const loading = ref(false)
const error = ref('')
const copied = ref(false)
const area = ref<HTMLTextAreaElement | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

watch(showingLinks, async (t) => {
  urls.value = []
  error.value = ''
  copied.value = false
  if (!t) return
  loading.value = true
  try {
    const res = await fetch(`/api/${t.area}/urls?kind=${t.kind}&id=${t.id}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    urls.value = (await res.json()).urls
    await nextTick()
    area.value?.focus()
    area.value?.select()
  } catch (e) {
    error.value = `Could not load the links: ${e instanceof Error ? e.message : e}`
  } finally {
    loading.value = false
  }
})

const copy = async () => {
  const text = urls.value.join('\n')
  try {
    // navigator.clipboard only exists in secure contexts (https / localhost), so fall back for plain http.
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text)
    else {
      area.value?.select()
      if (!document.execCommand('copy')) throw new Error('copy not permitted')
    }
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 2000)
  } catch (e) {
    error.value = `Copy failed, select the text and copy it manually (${e instanceof Error ? e.message : e})`
  }
}
</script>

<template>
  <div v-if="showingLinks" class="overlay" role="dialog" aria-modal="true" aria-label="Download links" @keydown.esc="showingLinks = null">
    <div class="dialog">
      <header>
        <div>
          <h3>{{ showingLinks.kind === 'package' ? 'Download links' : 'Download link' }}</h3>
          <p class="sub">{{ showingLinks.name }}</p>
        </div>
        <button type="button" class="icon" title="Close" @click="showingLinks = null"><X :size="16" /></button>
      </header>
      <textarea ref="area" :value="urls.join('\n')" readonly wrap="off" spellcheck="false" :placeholder="loading ? 'Loading…' : 'No links found'" />
      <p v-if="error" class="error">{{ error }}</p>
      <footer>
        <span class="muted">{{ urls.length }} link{{ urls.length === 1 ? '' : 's' }}</span>
        <div class="actions">
          <button type="button" @click="showingLinks = null">Close</button>
          <button type="button" class="primary" :disabled="!urls.length" @click="copy">
            <component :is="copied ? Check : Copy" :size="15" /> {{ copied ? 'Copied' : 'Copy all' }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.55); }
.dialog { display: grid; gap: 14px; width: min(760px, 100%); max-height: 100%; padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-sizing: border-box; }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
h3 { margin: 0; font-size: 1rem; }
.sub { margin: 4px 0 0; color: var(--muted); font-size: 0.85rem; overflow-wrap: anywhere; }
textarea { box-sizing: border-box; width: 100%; height: min(340px, 50vh); padding: 10px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: 0.8rem/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical; }
textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.muted { color: var(--muted); font-size: 0.85rem; }
.actions { display: flex; gap: 10px; }
button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.icon { padding: 4px; border: 0; background: none; color: var(--muted); }
button.icon:hover { color: var(--text); background: var(--hover); }
button:disabled { opacity: 0.5; cursor: default; }
.error { margin: 0; color: #d14343; font-size: 0.85rem; }
</style>
