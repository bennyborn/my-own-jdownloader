<script setup lang="ts">
import { ArrowDownToLine, ArrowUpToLine, Folder, Link2, Merge, PackagePlus, Pencil, Play, Power, PowerOff, Shuffle, Split, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted } from 'vue'
import { closeMenu, menu, mergePackages, moveToDownloads, moveToEdge, removeItem, startDownload, startFolder, startRename, interleaveHosts, splitBlocked, splitByHost, startShowLinks, toggleEnabled } from './itemActions'

const target = computed(() => menu.value?.target)

// Keep the menu inside the viewport.
const position = computed(() => {
  if (!menu.value) return {}
  const width = 240
  const height = (target.value?.kind === 'package' ? 332 : 212) + (target.value?.area === 'linkgrabber' ? 48 : 40) + (target.value?.mergeIds && target.value.mergeIds.length > 1 ? 40 : 0)
  return {
    left: Math.max(8, Math.min(menu.value.x, window.innerWidth - width - 8)) + 'px',
    top: Math.max(8, Math.min(menu.value.y, window.innerHeight - height - 8)) + 'px'
  }
})

const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu()
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('blur', closeMenu)
  window.addEventListener('resize', closeMenu)
  window.addEventListener('scroll', closeMenu, true)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('blur', closeMenu)
  window.removeEventListener('resize', closeMenu)
  window.removeEventListener('scroll', closeMenu, true)
})
</script>

<template>
  <div v-if="menu && target" class="backdrop" @pointerdown="closeMenu" @contextmenu.prevent="closeMenu">
    <ul class="menu" :style="position" role="menu" @pointerdown.stop @contextmenu.prevent.stop>
      <li v-if="target.area === 'downloads'">
        <button type="button" role="menuitem" @click="startDownload(target)">
          <Play :size="15" /> Start download
        </button>
      </li>
      <li v-if="target.area === 'linkgrabber'">
        <button type="button" role="menuitem" @click="moveToDownloads(target)">
          <PackagePlus :size="15" /> Add to downloads
        </button>
      </li>
      <li v-if="target.mergeIds && target.mergeIds.length > 1">
        <button type="button" role="menuitem" @click="mergePackages(target)">
          <Merge :size="15" /> Merge {{ target.mergeIds.length }} packages here
        </button>
      </li>
      <li class="sep" role="separator" />
      <li>
        <button type="button" role="menuitem" @click="startRename(target)">
          <Pencil :size="15" /> Rename <kbd>F2</kbd>
        </button>
      </li>
      <li>
        <button type="button" role="menuitem" @click="startShowLinks(target)">
          <Link2 :size="15" /> {{ target.kind === 'package' ? 'Show download links…' : 'Show download link…' }}
        </button>
      </li>
      <li>
        <button type="button" role="menuitem" @click="toggleEnabled(target)">
          <component :is="target.enabled ? PowerOff : Power" :size="15" /> {{ target.enabled ? 'Disable' : 'Enable' }}{{ target.selectedLinkIds ? ` ${target.selectedLinkIds.length} selected` : '' }}
        </button>
      </li>
      <li v-if="target.kind === 'package'">
        <button type="button" role="menuitem" @click="startFolder(target)">
          <Folder :size="15" /> Change download folder…
        </button>
      </li>
      <li v-if="target.kind === 'package'">
        <button type="button" role="menuitem" :disabled="!!splitBlocked(target)" :title="splitBlocked(target)" @click="splitByHost(target)">
          <Split :size="15" /> Split by host…
        </button>
      </li>
      <li v-if="target.kind === 'package' && (target.hostCount ?? 0) > 1">
        <button type="button" role="menuitem" @click="interleaveHosts(target)">
          <Shuffle :size="15" /> Interleave hosters…
        </button>
      </li>
      <li class="sep" role="separator" />
      <li>
        <button type="button" role="menuitem" @click="moveToEdge(target, 'top')">
          <ArrowUpToLine :size="15" /> Move to top
        </button>
      </li>
      <li>
        <button type="button" role="menuitem" @click="moveToEdge(target, 'bottom')">
          <ArrowDownToLine :size="15" /> Move to bottom
        </button>
      </li>
      <li class="sep" role="separator" />
      <li>
        <button type="button" role="menuitem" class="danger" @click="removeItem(target)">
          <Trash2 :size="15" /> Remove…
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 200; }
.menu { position: fixed; width: 240px; margin: 0; padding: 6px; list-style: none; background: var(--card); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35); }
button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; background: none; border: 0; border-radius: 6px; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
button:hover:not(:disabled) { background: var(--hover); }
button:disabled { opacity: 0.4; cursor: default; }
button.danger:hover:not(:disabled) { color: #d14343; }
.sep { height: 1px; margin: 4px 6px; background: var(--border); }
kbd { margin-left: auto; color: var(--muted); font: inherit; font-size: 0.75rem; }
</style>
