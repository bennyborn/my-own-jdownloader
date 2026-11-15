<script setup lang="ts">
import { toneIcon } from './iconTone'
import { multiple, withDevice } from './devices'
import { ChevronDown, Clock, RefreshCw, CpuAi } from '@lucide/vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { formatCountdown } from './format'
import { showError } from './toast'
import { captchaSolverActive } from './plugins'
import type { CaptchaJob } from './useCaptchas'

const props = defineProps<{ job: CaptchaJob | null; more: number }>()
const emit = defineEmits<{ handled: [id: number]; changed: [] }>()

const text = ref('')
const busy = ref(false)
const menu = ref(false)
const imageVersion = ref(0) // changes trigger loading the picture again
const input = ref<HTMLInputElement | null>(null)
const guessing = ref(false) // the AI is reading the picture
const guessed = ref(false) // the field holds its guess
const suggestion = ref('') // what the AI read, kept for the hint when the field has other text
const autoSubmitAt = ref<number | null>(null) // when the backend will send the AI's guess on its own, unless answered first

// Refreshing: JD issues a new captcha, which can take a moment. The dialog stays open (showing the old
// job's hoster) and signals that a new one is being requested.
const refreshing = ref(false)
const lastJob = ref<CaptchaJob | null>(null)
watch(() => props.job, (j) => j && (lastJob.value = j), { immediate: true })
const view = computed(() => props.job ?? (refreshing.value ? lastJob.value : null))
let refreshTimer: ReturnType<typeof setInterval> | undefined
const stopRefreshing = () => {
  clearInterval(refreshTimer)
  refreshing.value = false
}
onUnmounted(() => clearInterval(refreshTimer))

// Loaded as a data URI (not a plain <img src="/api/...">) so the mimetype we sniffed on the backend is
// the one the browser renders and saves with, and so right-clicking it can offer "save image as" on the
// actual picture instead of our API route.
const imageSrc = ref<string | null>(null)
watch(
  [() => view.value?.id, () => view.value?.device, imageVersion],
  async ([id, device]) => {
    imageSrc.value = null
    if (id === undefined) return
    try {
      const res = await fetch(withDevice(`/api/captcha/${id}/image`, device))
      if (!res.ok) return
      const { type, data } = await res.json()
      imageSrc.value = `data:${type};base64,${data}`
    } catch {
      /* picture stays blank, the user can still retry via "New picture" */
    }
  },
  { immediate: true }
)

// Time left, counted down every second between the polls.
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => (tick = setInterval(() => (now.value = Date.now()), 1000)))
onUnmounted(() => clearInterval(tick))
const remainingMs = computed(() => (props.job ? props.job.remaining - (now.value - props.job.fetchedAt) : 0))
const autoSubmitSeconds = computed(() => (autoSubmitAt.value ? Math.max(0, Math.ceil((autoSubmitAt.value - now.value) / 1000)) : null))

// A new captcha starts with an empty field and the cursor in it.
watch(
  () => props.job?.id,
  async (id) => {
    text.value = ''
    guessed.value = false
    suggestion.value = ''
    autoSubmitAt.value = null
    menu.value = false
    imageVersion.value++
    if (id !== undefined) stopRefreshing() // the new captcha has arrived
    if (id === undefined) return
    await nextTick()
    input.value?.focus()
    void guess(id)
  },
  { immediate: true }
)

// Optional: a vision model reads the picture and its guess goes into the field (selected, so typing replaces it). When the user has
// typed something already, that stays and the guess only shows below the field, to take over with a click. A failure leaves everything as it is.
async function guess(id: number) {
  const device = props.job?.device
  if (!captchaSolverActive.value || !device) return
  guessing.value = true
  try {
    const res = await fetch(withDevice(`/api/captcha/${id}/suggest`, device))
    if (!res.ok) return
    const { text: read, autoSubmitInMs } = (await res.json()) as { text: string | null; autoSubmitInMs?: number }
    if (read && props.job?.id === id) {
      suggestion.value = read
      if (autoSubmitInMs !== undefined) autoSubmitAt.value = Date.now() + autoSubmitInMs
      if (!text.value) {
        text.value = read
        guessed.value = true
        await nextTick()
        input.value?.select()
      }
    }
  } catch {
    /* no guess */
  } finally {
    if (props.job?.id === id) guessing.value = false
  }
}

const useSuggestion = async () => {
  text.value = suggestion.value
  guessed.value = true
  await nextTick()
  input.value?.focus()
}

const post = async (path: string, body: unknown) => {
  const res = await fetch(withDevice(path, (props.job ?? lastJob.value)?.device), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      message = (await res.json()).error ?? message
    } catch {
      /* keep the status */
    }
    throw new Error(message)
  }
}

const run = async (action: () => Promise<void>, hide: boolean) => {
  const job = props.job
  if (!job || busy.value) return
  busy.value = true
  menu.value = false
  try {
    await action()
    if (hide) emit('handled', job.id)
    emit('changed')
  } catch (e) {
    showError(`Captcha failed: ${e instanceof Error ? e.message : e}`)
  } finally {
    busy.value = false
  }
}

const solve = () => {
  if (!text.value.trim() || !props.job) return
  const id = props.job.id
  return run(() => post(`/api/captcha/${id}/solve`, { text: text.value }), true)
}
const skip = (type: 'SINGLE' | 'BLOCK_HOSTER' | 'BLOCK_PACKAGE') => props.job && run(() => post(`/api/captcha/${props.job!.id}/skip`, { type }), true)
// JD then issues a new challenge for the same download (the list picks up the new id).
const refresh = async () => {
  const job = props.job
  if (!job || busy.value || refreshing.value) return
  busy.value = true
  menu.value = false
  try {
    await post(`/api/captcha/${job.id}/skip`, { type: 'REFRESH' })
    refreshing.value = true
    const started = Date.now()
    clearInterval(refreshTimer)
    refreshTimer = setInterval(() => {
      emit('changed') // poll faster than usual while waiting
      const waited = Date.now() - started
      if (props.job && props.job.id === job.id && waited > 4000) {
        imageVersion.value++ // same job, probably a new picture
        stopRefreshing()
      } else if (waited > 20000) {
        stopRefreshing()
        showError('No new captcha was received')
      }
    }, 1000)
  } catch (e) {
    showError(`Captcha failed: ${e instanceof Error ? e.message : e}`)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="view" class="overlay" role="dialog" aria-modal="true" aria-label="Enter captcha">
    <div class="dialog" @click="menu = false">
      <h3>
        <img :src="`/api/icons/${view.hoster}`" alt="" width="20" height="20" @load="toneIcon" @error="($event.target as HTMLElement).style.display = 'none'" />
        Enter captcha
        <span class="left" :class="{ low: remainingMs < 60000 }" title="Time left to answer"><Clock :size="15" />{{ formatCountdown(remainingMs) }}</span>
      </h3>
      <p class="ask">
        <span v-if="more" class="more" :title="`${more} more waiting`">{{ more + 1 }}</span>
        <span class="line"><strong>{{ view.hoster }}</strong> wants you to solve this captcha<template v-if="multiple && view.deviceName">{{ ' ' }}<span class="muted">(on {{ view.deviceName }})</span></template></span>
      </p>
      <div class="picture" :class="{ loading: refreshing }">
        <img v-if="imageSrc" class="allow-contextmenu" :src="imageSrc" alt="Captcha" />
        <div v-if="refreshing" class="wait" role="status"><RefreshCw :size="22" class="spin" /> Requesting a new captcha…</div>
      </div>
      <input ref="input" v-model="text" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Enter response…" :disabled="busy || refreshing" @input="guessed = false" @keydown.enter="solve" />
      <small v-if="guessing" class="hint"><CpuAi :size="13" class="pulse" /> The AI is reading the picture…</small>
      <small v-else-if="guessed" class="hint">
        <CpuAi :size="13" /> Guessed by the AI, please check<template v-if="autoSubmitSeconds !== null">{{ ' ' }}<span class="muted">(sent automatically in {{ autoSubmitSeconds }}s unless corrected)</span></template>
      </small>
      <small v-else-if="suggestion && suggestion !== text" class="hint">
        <CpuAi :size="13" /> The AI read
        <button type="button" class="take" title="Use this" :disabled="busy || refreshing" @click="useSuggestion">{{ suggestion }}</button>
        <template v-if="autoSubmitSeconds !== null">{{ ' ' }}<span class="muted">(sent automatically in {{ autoSubmitSeconds }}s unless you answer first)</span></template>
      </small>
      <div class="actions">
        <span class="spacer" />
        <button type="button" class="icon" title="New picture" :disabled="busy || refreshing" @click.stop="refresh"><RefreshCw :size="16" /></button>
        <div class="split" @click.stop>
          <button type="button" :disabled="busy || refreshing" @click="skip('SINGLE')">Skip</button>
          <button type="button" class="arrow" aria-label="More skip options" :disabled="busy || refreshing" @click="menu = !menu"><ChevronDown :size="14" /></button>
          <ul v-if="menu" class="menu" role="menu">
            <li><button type="button" role="menuitem" @click="skip('SINGLE')">Skip this captcha</button></li>
            <li><button type="button" role="menuitem" @click="skip('BLOCK_PACKAGE')">No more captchas for this package</button></li>
            <li><button type="button" role="menuitem" @click="skip('BLOCK_HOSTER')">No more captchas from {{ view.hoster }}</button></li>
          </ul>
        </div>
        <button type="button" class="primary" :disabled="busy || refreshing || !text.trim()" @click="solve">Solve</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 350; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(var(--overlay-blur)); -webkit-backdrop-filter: blur(var(--overlay-blur)); }
.dialog { display: grid; gap: 14px; width: min(460px, 100%); padding: 22px 24px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4); }
h3 { display: flex; align-items: center; gap: 10px; margin: 0; padding-bottom: 12px; border-bottom: 1px solid var(--border); font-size: 1rem; text-transform: uppercase; letter-spacing: 0.04em; }
.ask { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--muted); }
.ask .line { min-width: 0; }
.ask strong { color: var(--text); font-weight: 600; }
.more { min-width: 18px; padding: 1px 5px; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; text-align: center; }
.picture { position: relative; min-height: 96px; display: flex; align-items: center; justify-content: center; padding: 12px; background: #fff; border-radius: 8px; }
.picture.loading img { opacity: 0.2; }
.wait { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px; color: #333; font-weight: 600; }
.hint { display: flex; align-items: center; gap: 6px; margin-top: -8px; color: var(--muted); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.hint .take { padding: 1px 8px; font: inherit; font-weight: 600; color: var(--text); }
.pulse { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.picture img { max-width: 100%; height: auto; image-rendering: auto; }
input { padding: 9px 11px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; font-size: 1.05rem; }
input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }
.actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.spacer { flex: 1; }
button { padding: 7px 16px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button:hover:not(:disabled) { background: var(--hover); }
button:disabled { opacity: 0.45; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.primary:hover:not(:disabled) { background: var(--accent); filter: brightness(1.08); }
h3 img { border-radius: 3px; flex: none; }
.left { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; color: var(--muted); font-size: 0.85rem; font-weight: 400; letter-spacing: normal; font-variant-numeric: tabular-nums; }
.left.low { color: #d14343; }
button.icon { display: inline-flex; padding: 7px; }
.split { position: relative; display: inline-flex; }
.split > button:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.split .arrow { display: inline-flex; align-items: center; padding: 7px 8px; border-left: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; }
.menu { position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 1; margin: 0; padding: 6px; min-width: 260px; list-style: none; background: var(--card); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35); }
.menu button { width: 100%; padding: 8px 10px; background: none; border: 0; text-align: left; white-space: nowrap; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
