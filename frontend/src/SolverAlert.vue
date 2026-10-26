<script setup lang="ts">
import { Clock, ShieldCheck } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { inApp, solveInApp } from './appBridge'
import { formatCountdown } from './format'
import type { CaptchaJob } from './useCaptchas'

const props = defineProps<{ job: CaptchaJob | null }>()
const emit = defineEmits<{ dismiss: [id: number] }>()

const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => (tick = setInterval(() => (now.value = Date.now()), 1000)))
onUnmounted(() => clearInterval(tick))
// In the app the solver is a native screen, in a browser the extension reacts to the link.
const open = (e: Event) => {
  if (inApp && props.job) {
    e.preventDefault()
    solveInApp(props.job)
  }
  if (props.job) emit('dismiss', props.job.id)
}
const remainingMs = computed(() => (props.job ? props.job.remaining - (now.value - props.job.fetchedAt) : 0))
</script>

<template>
  <div v-if="job?.openUrl" class="overlay" role="alertdialog" aria-modal="true" aria-label="Captcha needs the solver page" @keydown.esc="emit('dismiss', job.id)">
    <div class="dialog">
      <h3>
        <ShieldCheck :size="20" /> Captcha waiting
        <span class="left" :class="{ low: remainingMs < 60000 }" title="Time left to answer"><Clock :size="15" />{{ formatCountdown(remainingMs) }}</span>
      </h3>
      <p><strong>{{ job.hoster }}</strong> needs a captcha that is solved on the hoster's page with {{ inApp ? 'this app' : 'the browser extension' }}. You can open it later with the red button in the status bar.</p>
      <div class="actions">
        <button type="button" @click="emit('dismiss', job.id)">Later</button>
        <a class="primary" :href="job.openUrl" target="_blank" rel="noopener" @click="open">Open solver page</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 340; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.55); }
.dialog { display: grid; gap: 14px; width: min(440px, 100%); padding: 20px 24px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4); }
h3 { display: flex; align-items: center; gap: 10px; margin: 0; padding-bottom: 12px; border-bottom: 1px solid var(--border); font-size: 1rem; text-transform: uppercase; letter-spacing: 0.04em; }
h3 svg { color: #d14343; }
p { margin: 0; color: var(--muted); line-height: 1.5; }
p strong { color: var(--text); font-weight: 600; }
.left { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; color: var(--muted); font-size: 0.85rem; font-weight: 400; letter-spacing: normal; font-variant-numeric: tabular-nums; }
.left.low { color: #d14343; }
.actions { display: flex; justify-content: flex-end; gap: 10px; }
button, a.primary { padding: 7px 16px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; text-decoration: none; }
a.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
