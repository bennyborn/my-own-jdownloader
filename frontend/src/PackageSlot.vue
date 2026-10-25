<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { entriesOf, fetchPackageData, pluginTick } from './plugins'
import type { PluginArea } from './plugins'

// A named block of the package card. The content between the tags is the block's default; plugins can put
// their components before or after it, or replace it (they then get the default as their own slot).
const props = defineProps<{ name: string; pkg: { uuid: number; name: string }; area?: PluginArea; device?: string }>()
defineOptions({ inheritAttrs: false })

const entries = computed(() => entriesOf(props.name))
const before = computed(() => entries.value.filter((e) => e.mode === 'prepend'))
const after = computed(() => entries.value.filter((e) => e.mode === 'append'))
const replacing = computed(() => entries.value.filter((e) => e.mode === 'replace').at(-1))

// Each plugin's data for this package, handed to its components as `data`.
const data = reactive<Record<string, Record<string, unknown>>>({})
watch(
  [() => props.pkg.name, entries, pluginTick],
  async ([name]) => {
    for (const id of new Set(entries.value.map((e) => e.pluginId))) {
      const result = await fetchPackageData(id, name, props.pkg.uuid, props.area ?? 'downloads', props.device)
      if (name === props.pkg.name) data[id] = result
    }
  },
  { immediate: true }
)
</script>

<template>
  <component :is="e.component" v-for="e in before" :key="`b${e.pluginId}`" :pkg="pkg" :area="area ?? 'downloads'" :device="device" :data="data[e.pluginId]" />
  <component :is="replacing.component" v-if="replacing" :pkg="pkg" :area="area ?? 'downloads'" :device="device" :data="data[replacing.pluginId]"><slot /></component>
  <slot v-else />
  <component :is="e.component" v-for="e in after" :key="`a${e.pluginId}`" :pkg="pkg" :area="area ?? 'downloads'" :device="device" :data="data[e.pluginId]" />
</template>
