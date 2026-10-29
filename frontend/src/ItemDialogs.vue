<script setup lang="ts">
import { withDevice } from './devices'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { confirmState } from './confirm'
import { actionError, choosingFolder, hovered, isMulti, markedTarget, removeItem, renaming, rename, setFolder, startRename } from './itemActions'

const nameInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const name = ref('')
const folder = ref('')
const folders = ref<string[]>([])
const busy = ref(false)

watch(renaming, async (t) => {
  if (!t) return
  actionError.value = ''
  name.value = t.name
  await nextTick()
  const input = nameInput.value
  if (!input) return
  input.focus()
  // For links select the name without its extension.
  const dot = t.name.lastIndexOf('.')
  input.setSelectionRange(0, t.kind === 'link' && dot > 0 ? dot : t.name.length)
})

watch(choosingFolder, async (t) => {
  if (!t) return
  actionError.value = ''
  folder.value = t.saveTo ?? ''
  await nextTick()
  folderInput.value?.focus()
  try {
    const res = await fetch(withDevice('/api/linkgrabber/folders', t.device))
    if (res.ok) folders.value = await res.json()
  } catch {
    /* suggestions are optional */
  }
})

const submitRename = async () => {
  const t = renaming.value
  if (!t || !name.value.trim() || busy.value) return
  if (name.value.trim() === t.name) return void (renaming.value = null)
  busy.value = true
  try {
    await rename(t, name.value.trim())
    renaming.value = null
  } catch {
    /* shown in the dialog */
  } finally {
    busy.value = false
  }
}

const submitFolder = async () => {
  const t = choosingFolder.value
  if (!t || !folder.value.trim() || busy.value) return
  busy.value = true
  try {
    await setFolder(t, folder.value.trim())
    choosingFolder.value = null
  } catch {
    /* shown in the dialog */
  } finally {
    busy.value = false
  }
}

// F2 renames and Del acts on the marked package or link, or else on the one the mouse is over (Del asks first, like the menu entry).
// Several marked items cannot be renamed at once.
const onKey = (e: KeyboardEvent) => {
  if ((e.key !== 'F2' && e.key !== 'Delete') || renaming.value || choosingFolder.value || confirmState.value) return
  const target = markedTarget() ?? hovered.value
  if (!target) return
  const el = document.activeElement
  // A ticked checkbox keeps the focus, but is no reason to leave the key alone.
  if ((el instanceof HTMLInputElement && el.type !== 'checkbox') || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
  if (e.key === 'F2') {
    if (isMulti(target)) return
    e.preventDefault()
    startRename(target)
  } else {
    e.preventDefault()
    void removeItem(target)
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="renaming" class="overlay" role="dialog" aria-modal="true" aria-label="Rename" @keydown.esc="renaming = null">
    <form class="dialog" @submit.prevent="submitRename">
      <h3>Rename {{ renaming.kind }}</h3>
      <input ref="nameInput" v-model="name" type="text" spellcheck="false" />
      <p v-if="actionError" class="error">{{ actionError }}</p>
      <div class="actions">
        <button type="button" @click="renaming = null">Cancel</button>
        <button type="submit" class="primary" :disabled="busy || !name.trim()">Rename</button>
      </div>
    </form>
  </div>

  <div v-if="choosingFolder" class="overlay" role="dialog" aria-modal="true" aria-label="Change download folder" @keydown.esc="choosingFolder = null">
    <form class="dialog" @submit.prevent="submitFolder">
      <h3>Download folder</h3>
      <input ref="folderInput" v-model="folder" type="text" list="folder-suggestions" spellcheck="false" placeholder="/path/on/the/server" />
      <datalist id="folder-suggestions"><option v-for="f in folders" :key="f" :value="f" /></datalist>
      <p v-if="actionError" class="error">{{ actionError }}</p>
      <div class="actions">
        <button type="button" @click="choosingFolder = null">Cancel</button>
        <button type="submit" class="primary" :disabled="busy || !folder.trim()">Save</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(var(--overlay-blur)); -webkit-backdrop-filter: blur(var(--overlay-blur)); }
.dialog { display: grid; gap: 14px; width: min(520px, 100%); padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; }
h3 { margin: 0; font-size: 1rem; }
input { box-sizing: border-box; width: 100%; padding: 9px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; }
input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; }
button { padding: 7px 16px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button:disabled { opacity: 0.5; cursor: default; }
.error { margin: 0; color: #d14343; font-size: 0.85rem; }
</style>
