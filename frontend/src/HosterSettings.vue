<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, Search } from 'lucide-vue-next'
import { toneIcon } from './iconTone'
import { settingsDevice } from './devices'
import { fetchPluginGroup, loadPluginConfigs, pluginConfigs, pluginConfigsError, pluginConfigsState, type ConfigGroup, type PluginConfig } from './jdconfig'
import JdSettings from './JdSettings.vue'
import LoadingState from './LoadingState.vue'
import { showError } from './toast'

watch(settingsDevice, () => {
  open.value = null
  void loadPluginConfigs()
})
void loadPluginConfigs()

const KINDS: Record<string, string> = { HOSTER: 'Hoster', CRAWLER: 'Crawler', CAPTCHA: 'Captcha', OTHER: 'Other' }
const kindLabel = (k: string) => KINDS[k] ?? k.charAt(0) + k.slice(1).toLowerCase()

const query = ref('')
const kind = ref('')
const kinds = computed(() => [...new Set(pluginConfigs.value.map((p) => p.kind))].sort())
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return pluginConfigs.value.filter((p) => (!kind.value || p.kind === kind.value) && (!q || p.host.toLowerCase().includes(q)))
})

const idOf = (p: PluginConfig) => `${p.interfaceName}\0${p.storage}`
const open = ref<string | null>(null)
const group = ref<ConfigGroup | null>(null)
const loading = ref(false)
const toggle = async (p: PluginConfig) => {
  const id = idOf(p)
  if (open.value === id) {
    open.value = null
    return
  }
  open.value = id
  group.value = null
  loading.value = true
  try {
    const loaded = await fetchPluginGroup(p)
    if (open.value === id) group.value = loaded
  } catch (e) {
    showError(`${p.host}: ${e instanceof Error ? e.message : e}`)
    if (open.value === id) open.value = null
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <p v-if="pluginConfigsState === 'error'" class="error">The hoster settings could not be loaded: {{ pluginConfigsError }}</p>
  <LoadingState v-else-if="pluginConfigsState === 'loading' && !pluginConfigs.length" text="Loading hoster settings…" />
  <template v-else>
    <p class="hint">The settings of the JDownloader's plugins, per site. Only plugins that have settings are listed.</p>
    <div class="filters">
      <div class="search">
        <Search :size="16" />
        <input v-model="query" type="search" placeholder="Filter hosters" aria-label="Filter hosters" />
      </div>
      <select v-model="kind" aria-label="Kind of plugin">
        <option value="">All</option>
        <option v-for="k in kinds" :key="k" :value="k">{{ kindLabel(k) }}</option>
      </select>
    </div>
    <p v-if="!shown.length" class="hint">No plugin found.</p>
    <section v-for="p in shown" :key="idOf(p)" class="plugin" :class="{ open: open === idOf(p) }">
      <button type="button" class="head" :aria-expanded="open === idOf(p)" @click="toggle(p)">
        <ChevronRight :size="16" class="chevron" />
        <img class="hosticon" :src="`/api/icons/${p.host}`" alt="" width="16" height="16" loading="lazy" @load="toneIcon" @error="($event.target as HTMLElement).style.visibility = 'hidden'" />
        <span class="name">{{ p.host }}</span>
        <span class="kind">{{ kindLabel(p.kind) }}</span>
        <span class="count">{{ p.count }}</span>
      </button>
      <div v-if="open === idOf(p)" class="body">
        <LoadingState v-if="loading && !group" variant="inline" text="Loading…" />
        <JdSettings v-else-if="group" :key="idOf(p)" :groups="[group]" :title="p.host" />
      </div>
    </section>
  </template>
</template>

<style scoped>
.hint { color: var(--muted); font-size: 0.85rem; }
.error { color: #d14343; font-size: 0.85rem; overflow-wrap: anywhere; }
.filters { display: flex; gap: 8px; margin-bottom: 12px; }
.search { flex: 1; display: flex; align-items: center; gap: 8px; padding: 0 10px; background: var(--bg); color: var(--muted); border: 1px solid var(--border); border-radius: 6px; }
.search:focus-within { border-color: var(--accent); }
.search input { flex: 1; min-width: 0; padding: 7px 0; background: none; color: var(--text); border: 0; outline: 0; font: inherit; }
select { padding: 7px 10px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; }
.plugin { margin-bottom: 6px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
.head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; background: none; border: 0; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.head:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 8px; }
.chevron { color: var(--muted); transition: transform 0.15s; }
.open .chevron { transform: rotate(90deg); }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.kind { padding: 1px 8px; border-radius: 999px; background: var(--hover); color: var(--muted); font-size: 0.72rem; }
.count { min-width: 2ch; text-align: center; }
.body { padding: 0 12px 12px; }
</style>
