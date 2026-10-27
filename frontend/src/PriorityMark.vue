<script setup lang="ts">
import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp } from 'lucide-vue-next'
import { computed } from 'vue'

// A small arrow for a priority other than the default: up for higher, down for lower (two arrows for the extremes).
const props = withDefaults(defineProps<{ priority?: string; size?: number }>(), { size: 15 })
const MARKS: Record<string, { icon: typeof ChevronUp; text: string; high: boolean }> = {
  HIGHEST: { icon: ChevronsUp, text: 'highest', high: true },
  HIGHER: { icon: ChevronsUp, text: 'higher', high: true },
  HIGH: { icon: ChevronUp, text: 'high', high: true },
  LOW: { icon: ChevronDown, text: 'low', high: false },
  LOWER: { icon: ChevronsDown, text: 'lower', high: false },
  LOWEST: { icon: ChevronsDown, text: 'lowest', high: false }
}
const mark = computed(() => (props.priority ? MARKS[props.priority] : undefined))
</script>

<template>
  <component :is="mark.icon" v-if="mark" :size="size" class="priority" :class="{ high: mark.high }" :title="`Priority: ${mark.text}`" :aria-label="`Priority ${mark.text}`" />
</template>

<style scoped>
.priority { flex: none; vertical-align: -2px; margin-right: 3px; color: var(--muted); }
.priority.high { color: var(--accent); }
</style>
