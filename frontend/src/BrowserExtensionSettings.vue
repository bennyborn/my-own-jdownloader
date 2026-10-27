<script setup lang="ts">
import { CheckCircle2, Download, Loader } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { inApp } from './appBridge'

// First installation of the browser extension: the backend ships one package per kind of browser (backend/src/extension.ts). Later
// updates run from the extension's own settings. A new browser needs its entry in `guides` here.
interface Target {
  id: string
  label: string
  ext: string
  // Firefox is signed by Mozilla first (backend/src/firefox.ts); the others are ready at once.
  state: 'ready' | 'signing' | 'error'
  error?: string
}
const guides: Record<string, { steps: string[] }> = {
  chromium: {
    steps: [
      'Unpack the ZIP into a folder of its own that stays (e.g. C:\\Users\\<you>\\my-own-jdownloader-extension, not Downloads or Desktop itself).',
      'Open chrome://extensions (edge://extensions in Edge), switch on Developer mode and choose Load unpacked with that folder.',
      `Open the extension's settings and enter this address (${location.origin}) and the password.`
    ]
  },
  firefox: {
    steps: [
      'Open the file with Firefox (or save it and drag it onto a Firefox window) and confirm the installation.',
      `Open the extension's settings (about:addons) and enter this address (${location.origin}) and the password.`
    ]
  }
}
// Which package fits the browser this page is open in (null: none of the offered).
const own = /firefox/i.test(navigator.userAgent) ? 'firefox' : 'chromium'

const version = ref('')
const targets = ref<Target[]>([])
const unavailable = ref(false)
const apk = ref<{ available: boolean; size: number; built: string | null }>({ available: false, size: 0, built: null })
// The extension marks every page it runs on with its version (older ones with an empty value).
const installed = document.documentElement.getAttribute('data-myjd-extension')
// The package of this browser first, the others below.
const ordered = computed(() => [...targets.value].sort((a, b) => Number(b.id === own) - Number(a.id === own)))
const missing = computed(() => !unavailable.value && targets.value.length > 0 && !targets.value.some((t) => t.id === own))

const load = async () => {
  try {
    const res = await fetch('/api/extension')
    if (!res.ok) throw new Error()
    const data = await res.json()
    version.value = data.version ?? ''
    targets.value = data.targets
    unavailable.value = !targets.value.length
  } catch {
    unavailable.value = true
  }
}
// While Mozilla signs the Firefox package the page looks again every few seconds.
let timer: ReturnType<typeof setInterval> | undefined
onUnmounted(() => clearInterval(timer))

onMounted(async () => {
  await load()
  timer = setInterval(() => (targets.value.some((t) => t.state === 'signing') ? void load() : clearInterval(timer)), 5000)
  try {
    const res = await fetch('/api/app')
    if (res.ok) apk.value = await res.json()
  } catch {
    // no app to offer
  }
})
</script>

<template>
  <div class="install">
    <section class="card">
      <h3>Browser extension</h3>
      <p class="hint">Solves captchas on the hoster's own page, takes over Click'n'Load and shows the JDownloader in the toolbar.</p>
      <p v-if="installed !== null" class="state ok">
        <CheckCircle2 :size="15" />
        <span>
          Installed in this browser<template v-if="installed"> (version {{ installed }})</template><template v-if="installed && version && installed !== version">, this backend ships {{ version }}: update it in the extension's settings</template>.
        </span>
      </p>
      <p v-if="unavailable" class="state">This backend has no extension to offer.</p>
      <p v-else-if="missing" class="state">There is no package for your browser yet. The ones below are for other browsers.</p>
    </section>
    <section v-for="t in ordered" :key="t.id" class="card">
      <h3>{{ t.label }}</h3>
      <p v-if="t.state === 'signing'" class="state"><Loader :size="15" class="spin" /><span>Mozilla is signing the package, this takes a few minutes after the start. The download appears here when it is done.</span></p>
      <p v-else-if="t.state === 'error'" class="state">The package could not be signed: {{ t.error }}</p>
      <a v-else class="button" :href="`/api/extension/${t.id}/extension.${t.ext}`" :download="t.ext === 'zip' ? '' : undefined"><Download :size="16" /> Download<template v-if="version"> ({{ version }})</template></a>
      <ol v-if="guides[t.id] && t.state === 'ready'">
        <li v-for="step in guides[t.id].steps" :key="step">{{ step }}</li>
      </ol>
      <p v-if="t.ext === 'xpi'" class="hint">Updates need no file: Firefox asks this backend for a newer version by itself.</p>
      <p v-else class="hint">Updates need no ZIP: the extension looks for a newer version here by itself, and <b>Update</b> in its settings writes it into that folder (the folder is asked once).</p>
    </section>
    <section v-if="!inApp" class="card">
      <h3>Android app</h3>
      <p class="hint">A phone browser has no extensions, so the app solves the captchas itself.</p>
      <template v-if="apk.available">
        <a class="button" href="/api/app/my-own-jdownloader.apk" download><Download :size="16" /> Download ({{ (apk.size / 1048576).toFixed(1) }} MB)</a>
        <p class="hint">Built {{ new Date(apk.built!).toLocaleString() }}. Open the file on the phone and allow the installation from this source; an update goes over the installed app.</p>
      </template>
      <p v-else class="state"><span>There is no app yet: it has to be built first. Run <code>android/build.sh</code> in the project folder; the download appears here when it is done (reload this page).</span></p>
    </section>
  </div>
</template>

<style scoped>
.spin { animation: spin 1.2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.install { display: grid; gap: 16px; max-width: 560px; }
.card { display: grid; gap: 12px; padding: 16px 18px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; }
h3 { margin: 0; font-size: 1rem; }
.hint { margin: 0; color: var(--muted); font-size: 0.85rem; line-height: 1.5; }
.state { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 0.9rem; }
.state svg { flex: none; margin-top: 2px; }
.state.ok { color: var(--ok, #22a55b); }
.button { justify-self: start; display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background: var(--accent); color: #fff; border-radius: 6px; text-decoration: none; }
ol { margin: 0; padding-left: 20px; display: grid; gap: 6px; line-height: 1.5; overflow-wrap: anywhere; }
code { padding: 1px 5px; background: var(--hover, rgba(127, 127, 127, 0.15)); border-radius: 4px; font-size: 0.85em; overflow-wrap: anywhere; }
</style>
