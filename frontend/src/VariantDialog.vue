<script setup lang="ts">
import { withDevice } from './devices'
import { X } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { actionError, addVariants, choosingVariants, switchVariant } from './itemActions'

interface Variant {
  id: string
  name: string
}

const variants = ref<Variant[]>([])
const picked = ref<Set<string>>(new Set())
const filter = ref('')
const loading = ref(false)
const busy = ref(false)
const filterInput = ref<HTMLInputElement | null>(null)

watch(choosingVariants, async (t) => {
  variants.value = []
  picked.value = new Set()
  filter.value = ''
  actionError.value = ''
  if (!t) return
  loading.value = true
  try {
    const res = await fetch(withDevice(`/api/linkgrabber/variants?id=${t.id}`, t.device))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    variants.value = (await res.json()).variants
    await nextTick()
    filterInput.value?.focus()
  } catch (e) {
    actionError.value = `Could not load the variants: ${e instanceof Error ? e.message : e}`
  } finally {
    loading.value = false
  }
})

// The variant the link has now is marked in the list.
const currentId = computed(() => choosingVariants.value?.variantId ?? '')

const shown = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return q ? variants.value.filter((v) => v.name.toLowerCase().includes(q)) : variants.value
})
const toggle = (id: string) => {
  const next = new Set(picked.value)
  if (!next.delete(id)) next.add(id)
  picked.value = next
}

const close = () => (choosingVariants.value = null)
const submit = async () => {
  const t = choosingVariants.value
  if (!t || busy.value || !picked.value.size) return
  busy.value = true
  try {
    // keep the order of JD's list, not the order of clicking
    await addVariants(t, variants.value.filter((v) => picked.value.has(v.id)).map((v) => v.id))
    close()
  } catch {
    /* shown in the dialog */
  } finally {
    busy.value = false
  }
}
const useForLink = async (id: string) => {
  const t = choosingVariants.value
  if (!t || busy.value) return
  busy.value = true
  try {
    await switchVariant(t, id)
    close()
  } catch {
    /* shown in the dialog */
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="choosingVariants" class="overlay" role="dialog" aria-modal="true" aria-label="Choose variants" @keydown.esc="close">
    <form class="dialog" @submit.prevent="submit">
      <header>
        <div>
          <h3>Choose variants</h3>
          <p class="sub" :title="choosingVariants.name">{{ choosingVariants.name }}</p>
        </div>
        <button type="button" class="icon" title="Close" @click="close"><X :size="16" /></button>
      </header>
      <input ref="filterInput" v-model="filter" type="text" spellcheck="false" placeholder="Filter, e.g. 1080p or MP4" />
      <p v-if="loading" class="muted">Loading…</p>
      <ul v-else class="list">
        <li v-for="v in shown" :key="v.id" :class="{ now: v.id === currentId }">
          <label>
            <input type="checkbox" :checked="picked.has(v.id)" :disabled="v.id === currentId" @change="toggle(v.id)" />
            <span class="vname">{{ v.name }}</span>
            <span v-if="v.id === currentId" class="muted">current</span>
          </label>
          <button v-if="v.id !== currentId" type="button" class="link" :disabled="busy" title="Switch this link to the variant instead of adding a copy" @click="useForLink(v.id)">Use for this link</button>
        </li>
        <li v-if="!shown.length" class="muted">No variant matches.</li>
      </ul>
      <p v-if="actionError" class="error">{{ actionError }}</p>
      <div class="actions">
        <span class="muted">{{ picked.size }} selected, added as links in the same package</span>
        <button type="button" @click="close">Cancel</button>
        <button type="submit" class="primary" :disabled="busy || !picked.size">Add {{ picked.size || '' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(var(--overlay-blur)); -webkit-backdrop-filter: blur(var(--overlay-blur)); }
.dialog { display: grid; gap: 12px; width: min(620px, 100%); max-height: calc(100vh - 32px); padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
h3 { margin: 0; font-size: 1rem; }
.sub { margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 520px; color: var(--muted); font-size: 0.85rem; }
input[type='text'] { box-sizing: border-box; width: 100%; padding: 9px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; }
input[type='text']:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.list { margin: 0; padding: 0; list-style: none; max-height: min(320px, 45vh); overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; }
.list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 10px; }
.list li:hover { background: var(--bg); }
.list li.now { opacity: 0.7; }
.list label { display: flex; align-items: center; flex: 1; gap: 10px; padding: 7px 0; cursor: pointer; min-width: 0; }
.vname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: var(--muted); font-size: 0.85rem; }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.actions .muted { margin-right: auto; }
button { padding: 7px 16px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.icon { padding: 5px; border: none; }
button.link { padding: 2px 8px; font-size: 0.8rem; color: var(--muted); }
button:disabled { opacity: 0.5; cursor: default; }
.error { margin: 0; color: #d14343; font-size: 0.85rem; }
</style>
