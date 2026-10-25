<script setup lang="ts">
import { ArchiveRestore, RotateCcw, Check, ArrowDownToLine, ArrowUpToLine, Folder, OctagonPause, Layers, Link2, Merge, PackagePlus, Pencil, Play, Power, PowerOff, ArrowDownAZ, Shuffle, Split, Square, Trash2 } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { closeMenu, menu, menuArchives, mergePackages, moveToDownloads, moveToEdge, removeItem, resetItem, startDownload, startFolder, startExtraction, startRename, toggleStopMark, toggleArchiveSetting, interleaveHosts, sortLinks, splitBlocked, splitByHost, startShowLinks, startVariants, toggleEnabled } from './itemActions'

const target = computed(() => menu.value?.target)
// Starting only makes sense for what is waiting: not for a running or a finished download (JD has no per-download pause).
// A running download is stopped by disabling it: JD aborts it then. That entry takes the place of "Start".
const stopsRunning = computed(() => target.value?.area === 'downloads' && target.value.running === true && target.value.enabled)
const canStart = computed(() => target.value?.area === 'downloads' && !target.value.running && !target.value.finished)

// Keep the menu inside the viewport: it is placed at the pointer first, then moved by its measured size.
const menuEl = ref<HTMLElement | null>(null)
const position = ref<{ left: string; top: string; visibility?: 'hidden' }>({ left: '0px', top: '0px', visibility: 'hidden' })
watch(
  menu,
  async (m) => {
    if (!m) return
    position.value = { left: `${m.x}px`, top: `${m.y}px`, visibility: 'hidden' }
    await nextTick()
    const width = menuEl.value?.offsetWidth ?? 240
    const height = menuEl.value?.offsetHeight ?? 0
    position.value = {
      left: Math.max(8, Math.min(m.x, window.innerWidth - width - 8)) + 'px',
      top: Math.max(8, Math.min(m.y, window.innerHeight - height - 8)) + 'px'
    }
  },
  { immediate: true }
)

// Archive settings: checked when every archive of the item has it on.
const archiveOptions = [
  { key: 'autoExtract', label: 'Extract after download' },
  { key: 'removeFilesAfterExtraction', label: 'Delete archives after extraction' },
  { key: 'removeDownloadLinksAfterExtraction', label: 'Remove links after extraction' }
] as const
const canExtract = computed(() => menuArchives.value.some((a) => a.complete))
const archiveOn = (key: (typeof archiveOptions)[number]['key']) => menuArchives.value.every((a) => a.settings[key])

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
    <ul ref="menuEl" class="menu" :style="position" role="menu" @pointerdown.stop @contextmenu.prevent.stop>
      <li v-if="stopsRunning">
        <button type="button" role="menuitem" @click="toggleEnabled(target)">
          <Square :size="15" /> Disable / Stop{{ target.selectedLinkIds ? ` ${target.selectedLinkIds.length} selected` : '' }}
        </button>
      </li>
      <li v-if="canStart">
        <button type="button" role="menuitem" @click="startDownload(target)">
          <Play :size="15" /> Start download
        </button>
      </li>
      <li v-if="target.area === 'downloads' && !target.finished && !target.selectedLinkIds">
        <button type="button" role="menuitem" @click="toggleStopMark(target)">
          <OctagonPause :size="15" style="color: #e0a030" /> {{ target.stopMarked ? 'Remove stop mark' : 'Set stop mark here' }}
        </button>
      </li>
      <li v-if="menuArchives.length">
        <button type="button" role="menuitem" :disabled="!canExtract" :title="canExtract ? undefined : 'Not all parts are downloaded yet'" @click="startExtraction(target)">
          <ArchiveRestore :size="15" /> Extract now
        </button>
      </li>
      <li v-if="target.area === 'linkgrabber'">
        <button type="button" role="menuitem" @click="moveToDownloads(target)">
          <PackagePlus :size="15" /> Add to downloads
        </button>
      </li>
      <li v-if="target.kind === 'link' && target.hasVariants && !target.selectedLinkIds">
        <button type="button" role="menuitem" @click="startVariants(target)">
          <Layers :size="15" /> Choose variants…
        </button>
      </li>
      <li v-if="target.mergeIds && target.mergeIds.length > 1">
        <button type="button" role="menuitem" @click="mergePackages(target)">
          <Merge :size="15" /> Merge {{ target.mergeIds.length }} packages here
        </button>
      </li>
      <li v-if="stopsRunning || canStart || menuArchives.length || (target.area === 'downloads' && !target.finished && !target.selectedLinkIds) || target.area === 'linkgrabber' || (target.mergeIds && target.mergeIds.length > 1)" class="sep" role="separator" />
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
      <li v-if="!stopsRunning">
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
      <li v-if="target.kind === 'package'">
        <button type="button" role="menuitem" @click="sortLinks(target)">
          <ArrowDownAZ :size="15" /> Sort links alphabetically
        </button>
      </li>
      <template v-if="menuArchives.length">
        <li class="sep" role="separator" />
        <li v-for="opt in archiveOptions" :key="opt.key">
          <button type="button" role="menuitemcheckbox" :aria-checked="archiveOn(opt.key)" @click="toggleArchiveSetting(target, opt.key)">
            <span class="box"><Check v-if="archiveOn(opt.key)" :size="13" /></span> {{ opt.label }}
          </button>
        </li>
      </template>
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
      <li v-if="target.area === 'downloads'">
        <button type="button" role="menuitem" class="danger" @click="resetItem(target)">
          <RotateCcw :size="15" /> Reset…
        </button>
      </li>
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
.menu { position: fixed; box-sizing: border-box; width: 240px; margin: 0; padding: 6px; list-style: none; background: var(--card); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35); }
button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; background: none; border: 0; border-radius: 6px; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
button:hover:not(:disabled) { background: var(--hover); }
button:disabled { opacity: 0.4; cursor: default; }
button.danger:hover:not(:disabled) { color: #d14343; }
.sep { height: 1px; margin: 4px 6px; background: var(--border); }
.box { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 15px; height: 15px; border: 1px solid var(--border); border-radius: 4px; }
kbd { margin-left: auto; color: var(--muted); font: inherit; font-size: 0.75rem; }
</style>
