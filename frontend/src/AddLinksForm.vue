<script setup lang="ts">
import { FileUp, FolderPen, List, Plus, X } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import DevicePicker from './DevicePicker.vue'
import { currentDevice, devices, multiple, withDevice } from './devices'

const emit = defineEmits<{ added: [device: string]; cancel: [] }>()

const links = ref('')
const file = ref<File | null>(null)
// The browser's own file input looks out of place: it stays hidden, our button opens it.
const picker = ref<HTMLInputElement>()
const clearFile = () => {
  file.value = null
  if (picker.value) picker.value.value = ''
}
const folders = ref<string[]>([])
const folder = ref('')
const customFolder = ref('')
const useCustomFolder = ref(false)
// Remembered in the browser, like the device.
const SUBFOLDER_KEY = 'addLinksSubfolder'
const storedSubfolder = () => {
  try {
    return localStorage.getItem(SUBFOLDER_KEY) === 'true'
  } catch {
    return false
  }
}
const subfolder = ref(storedSubfolder())
watch(subfolder, (on) => {
  try {
    localStorage.setItem(SUBFOLDER_KEY, String(on))
  } catch {
    /* only a convenience */
  }
})
const packageName = ref('')
const extractPassword = ref('')
const downloadPassword = ref('')
const autostart = ref(false)
const autoExtract = ref(false)
// The JDownloader's settings the form reacts to (see backend/src/jdconfig.ts). Without the extraction extension the
// options for archives are hidden, without the packagizer the override checkbox.
const extractionEnabled = ref(true)
const packagizerEnabled = ref(true)
const defaultFolder = ref<string | null>(null)
const deepDecrypt = ref(false)
const overwritePackagizerRules = ref(true)
const error = ref('')
const busy = ref(false)

// The device the links go to (each device has its own folders). The last choice is remembered in the browser
// as long as that device is still known and online.
const TARGET_KEY = 'addLinksDevice'
const storedTarget = () => {
  try {
    const id = localStorage.getItem(TARGET_KEY)
    return devices.value.find((d) => d.id === id && d.online !== false)?.id
  } catch {
    return undefined
  }
}
const target = ref(storedTarget() ?? currentDevice.value)
const loadFolders = async () => {
  const device = target.value
  try {
    const res = await fetch(withDevice('/api/linkgrabber/folders', device))
    if (!res.ok || device !== target.value) return
    folders.value = await res.json()
    // Preselect the JDownloader's default folder, else the shortest known one, i.e. the base download folder.
    folder.value = folders.value.find((f) => f === defaultFolder.value) ?? [...folders.value].sort((a, b) => a.length - b.length)[0] ?? ''
  } catch {
    folders.value = []
    folder.value = ''
    /* folder list is optional */
  }
}
const loadSettings = async () => {
  const device = target.value
  try {
    const res = await fetch(withDevice('/api/jd-settings', device))
    if (!res.ok || device !== target.value) return
    const jd = await res.json()
    extractionEnabled.value = jd.extractionEnabled !== false
    packagizerEnabled.value = jd.packagizerEnabled !== false
    defaultFolder.value = jd.defaultFolder ?? null
    autostart.value = jd.autostart === true
    autoExtract.value = jd.autoExtract === true
    overwritePackagizerRules.value = jd.overwritePackagizerRules !== false
  } catch {
    /* the defaults stay */
  }
}
// The settings first: they decide which folder is preselected.
const load = async () => {
  await loadSettings()
  await loadFolders()
}
onMounted(() => void load())
watch(target, (id) => {
  try {
    localStorage.setItem(TARGET_KEY, id)
  } catch {
    /* only a convenience */
  }
  folders.value = []
  void load()
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
  const res = await fetch(withDevice(url, target.value), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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
        autoExtract: extractionEnabled.value && autoExtract.value,
        deepDecrypt: deepDecrypt.value,
        overwritePackagizerRules: packagizerEnabled.value && overwritePackagizerRules.value
      })
    }
    if (file.value) {
      await post('/api/linkgrabber/add-container', { filename: file.value.name, dataUrl: await readAsDataUrl(file.value) })
    }
    links.value = ''
    file.value = null
    emit('added', target.value)
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
    <div class="file">
      <input ref="picker" type="file" accept=".dlc,.ccf,.rsdf,.jdc,.metalink,.meta4" hidden @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
      <button type="button" class="pick" :class="{ chosen: file }" @click="picker?.click()">
        <FileUp :size="16" /><span class="name">{{ file ? file.name : 'Add a container file' }}</span><span v-if="!file" class="kinds">.dlc, .ccf, .metalink …</span>
      </button>
      <button v-if="file" type="button" class="iconbtn" title="Remove the file" aria-label="Remove the file" @click="clearFile"><X :size="16" /></button>
    </div>

    <template v-if="multiple">
      <h3>Device</h3>
      <DevicePicker v-model="target" block disable-offline />
    </template>

    <h3>Save to</h3>
    <div class="row">
      <select v-if="!useCustomFolder" v-model="folder">
        <option v-for="f in folders" :key="f" :value="f">{{ f }}</option>
      </select>
      <input v-else v-model="customFolder" type="text" placeholder="/path/on/the/server" />
      <button type="button" class="iconbtn" :title="useCustomFolder ? 'Choose from the list' : 'Enter another folder'" :aria-label="useCustomFolder ? 'Choose from the list' : 'Enter another folder'" @click="useCustomFolder = !useCustomFolder">
        <List v-if="useCustomFolder" :size="16" /><FolderPen v-else :size="16" />
      </button>
    </div>
    <label class="check"><input v-model="subfolder" type="checkbox" /> Subfolder per package name</label>

    <h3>Optional</h3>
    <input v-model="packageName" type="text" placeholder="Package name" />
    <input v-if="extractionEnabled" v-model="extractPassword" type="text" placeholder="Archive password" autocomplete="off" />
    <input v-model="downloadPassword" type="text" placeholder="Link password" autocomplete="off" />
    <div class="checks">
      <label class="check"><input v-model="autostart" type="checkbox" /> Auto start</label>
      <label v-if="extractionEnabled" class="check"><input v-model="autoExtract" type="checkbox" /> Auto extract</label>
      <label class="check"><input v-model="deepDecrypt" type="checkbox" /> Deep decrypt</label>
      <label v-if="packagizerEnabled" class="check"><input v-model="overwritePackagizerRules" type="checkbox" /> Overwrite packagizer rules</label>
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
/* Our own file button, in the look of the fields. */
.file { display: flex; gap: 8px; }
.pick { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; padding: 9px 12px; border-style: dashed; color: var(--muted); text-align: left; cursor: pointer; }
.pick:hover { color: var(--text); border-color: var(--accent); }
.pick.chosen { border-style: solid; color: var(--text); }
.pick svg { flex: none; color: var(--accent); }
.pick .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick .kinds { flex: none; font-size: 0.78rem; opacity: 0.7; }
/* A square button with just an icon (remove the file, switch the folder entry). */
.iconbtn { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; padding: 0; color: var(--muted); cursor: pointer; }
.iconbtn:hover { color: var(--text); background: var(--hover); }
.row { display: flex; gap: 12px; align-items: center; }
.row select, .row input { flex: 1; min-width: 0; width: auto; text-overflow: ellipsis; }
.checks { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.check { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--muted); }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.error { color: #d14343; font-size: 0.85rem; }
.primary { display: inline-flex; align-items: center; gap: 4px; background: var(--accent); color: #fff; border: 0; padding: 7px 16px; cursor: pointer; }
.secondary { cursor: pointer; }
.primary:disabled { opacity: 0.5; cursor: default; }
</style>
