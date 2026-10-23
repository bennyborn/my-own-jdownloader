<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'

const emit = defineEmits<{ added: []; cancel: [] }>()

const links = ref('')
const file = ref<File | null>(null)
const folders = ref<string[]>([])
const folder = ref('')
const customFolder = ref('')
const useCustomFolder = ref(false)
const subfolder = ref(false)
const packageName = ref('')
const extractPassword = ref('')
const downloadPassword = ref('')
const autostart = ref(false)
const autoExtract = ref(false)
const deepDecrypt = ref(false)
const overwritePackagizerRules = ref(true)
const error = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    const res = await fetch('/api/linkgrabber/folders')
    if (!res.ok) return
    folders.value = await res.json()
    // Preselect the shortest known folder, i.e. the base download folder.
    folder.value = [...folders.value].sort((a, b) => a.length - b.length)[0] ?? ''
  } catch {
    /* folder list is optional */
  }
})

const baseFolder = computed(() => (useCustomFolder.value ? customFolder.value.trim() : folder.value))
const destination = computed(() => {
  if (!baseFolder.value) return ''
  return subfolder.value ? `${baseFolder.value.replace(/\/$/, '')}/<jd:packagename>` : baseFolder.value
})

const readAsDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(f)
  })

const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

const submit = async () => {
  if (!links.value.trim() && !file.value) {
    error.value = 'Please enter URLs, links or text'
    return
  }
  error.value = ''
  busy.value = true
  try {
    if (links.value.trim()) {
      await post('/api/linkgrabber/add', {
        links: links.value,
        packageName: packageName.value.trim(),
        destinationFolder: destination.value,
        extractPassword: extractPassword.value,
        downloadPassword: downloadPassword.value,
        autostart: autostart.value,
        autoExtract: autoExtract.value,
        deepDecrypt: deepDecrypt.value,
        overwritePackagizerRules: overwritePackagizerRules.value
      })
    }
    if (file.value) {
      await post('/api/linkgrabber/add-container', { filename: file.value.name, dataUrl: await readAsDataUrl(file.value) })
    }
    links.value = ''
    file.value = null
    emit('added')
  } catch (e) {
    error.value = `Adding failed: ${e instanceof Error ? e.message : e}`
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="add" @submit.prevent="submit">
    <textarea v-model="links" rows="4" placeholder="Paste links, URLs or other text here" />
    <label class="file">
      <input type="file" accept=".dlc,.ccf,.rsdf,.jdc,.metalink,.meta4" @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
    </label>

    <h3>Save to</h3>
    <div class="row">
      <select v-if="!useCustomFolder" v-model="folder">
        <option v-for="f in folders" :key="f" :value="f">{{ f }}</option>
      </select>
      <input v-else v-model="customFolder" type="text" placeholder="/path/on/the/server" />
      <button type="button" class="link" @click="useCustomFolder = !useCustomFolder">
        {{ useCustomFolder ? 'Choose from list' : 'Choose other folder' }}
      </button>
    </div>
    <label class="check"><input v-model="subfolder" type="checkbox" /> Subfolder per package name</label>

    <h3>Optional</h3>
    <input v-model="packageName" type="text" placeholder="Package name" />
    <input v-model="extractPassword" type="text" placeholder="Archive password" autocomplete="off" />
    <input v-model="downloadPassword" type="text" placeholder="Link password" autocomplete="off" />
    <div class="checks">
      <label class="check"><input v-model="autostart" type="checkbox" /> Auto start</label>
      <label class="check"><input v-model="autoExtract" type="checkbox" /> Auto extract</label>
      <label class="check"><input v-model="deepDecrypt" type="checkbox" /> Deep decrypt</label>
      <label class="check"><input v-model="overwritePackagizerRules" type="checkbox" /> Overwrite packagizer rules</label>
    </div>

    <div class="actions">
      <span v-if="error" class="error">{{ error }}</span>
      <button type="button" class="secondary" @click="emit('cancel')">Cancel</button>
      <button type="submit" class="primary" :disabled="busy"><Plus :size="15" /> Add</button>
    </div>
  </form>
</template>

<style scoped>
.add { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
h3 { margin: 14px 0 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--accent); }
textarea, input[type='text'], select, button {
  box-sizing: border-box;
  max-width: 100%;
  background: var(--card);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  padding: 8px 10px;
}
textarea, input[type='text'], select { width: 100%; }
textarea { resize: vertical; }
.file input { max-width: 100%; }
.row { display: flex; gap: 12px; align-items: center; }
.row select, .row input { flex: 1; min-width: 0; width: auto; text-overflow: ellipsis; }
.checks { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.check { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--muted); }
.file { font-size: 0.85rem; color: var(--muted); }
.link { background: none; border: 0; color: var(--accent); cursor: pointer; white-space: nowrap; padding: 0; }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.error { color: #d14343; font-size: 0.85rem; }
.primary { display: inline-flex; align-items: center; gap: 4px; background: var(--accent); color: #fff; border: 0; padding: 7px 16px; cursor: pointer; }
.secondary { cursor: pointer; }
.primary:disabled { opacity: 0.5; cursor: default; }
</style>
