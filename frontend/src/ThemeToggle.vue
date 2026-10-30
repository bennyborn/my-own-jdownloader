<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'

const dark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)

const apply = () => document.documentElement.setAttribute('data-theme', dark.value ? 'dark' : 'light')

onMounted(() => {
  try {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark' || stored === 'light') {
      dark.value = stored === 'dark'
      apply()
    }
  } catch {
    /* storage unavailable, follow the system theme */
  }
})

// Colours fade over a short moment. Only colour properties transition (the knob keeps its own slide),
// so nothing heavy is repainted; the rule is removed again afterwards.
const fade = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const style = document.createElement('style')
  style.textContent = '*:not(.knob),*::before,*::after{transition:background-color .35s ease,color .35s ease,border-color .35s ease,fill .35s ease,stroke .35s ease!important}'
  document.head.appendChild(style)
  setTimeout(() => style.remove(), 500)
}

const toggle = () => {
  dark.value = !dark.value
  fade()
  apply()
  try {
    localStorage.setItem('theme', dark.value ? 'dark' : 'light')
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <button type="button" class="toggle" role="switch" :aria-checked="dark" :title="dark ? 'Switch to light mode' : 'Switch to dark mode'" @click="toggle">
    <Sun :size="13" class="icon sun" />
    <Moon :size="13" class="icon moon" />
    <span class="knob" :class="{ dark }" />
  </button>
</template>

<style scoped>
.toggle {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  flex: none;
  width: 24px;
  height: 40px;
  padding: 5px 0;
  box-sizing: border-box;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--muted);
  cursor: pointer;
}
.icon { position: relative; z-index: 1; }
.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.25;
  transition: transform 0.2s;
}
.knob.dark { transform: translateY(17px); }
</style>
