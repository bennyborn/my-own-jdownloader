<script setup lang="ts">
import { reactive } from 'vue'
import { loadPlugins, plugins, savePlugin, type PluginInfo } from './plugins'
import { showError } from './toast'

void loadPlugins()

// Edits per plugin, only what the user touched is sent.
const drafts = reactive<Record<string, Record<string, string | boolean | null>>>({})
const saving = reactive(new Set<string>())

const draftOf = (p: PluginInfo) => (drafts[p.id] ??= {})
const valueOf = (p: PluginInfo, key: string, fallback: string | boolean | undefined) => (key in draftOf(p) ? draftOf(p)[key] : fallback)
const dirty = (p: PluginInfo) => Object.keys(drafts[p.id] ?? {}).length > 0

const run = async (p: PluginInfo, change: Parameters<typeof savePlugin>[1]) => {
  saving.add(p.id)
  try {
    await savePlugin(p.id, change)
    delete drafts[p.id]
  } catch (e) {
    showError(`Saving failed: ${e instanceof Error ? e.message : e}`)
  } finally {
    saving.delete(p.id)
  }
}
</script>

<template>
  <p class="hint">Plugins are folders in the server's <code>plugins</code> directory and run as trusted code on the server. New ones show up after a restart.</p>
  <p v-if="!plugins.length" class="hint">No plugins installed.</p>
  <section v-for="p in plugins" :key="p.id" class="plugin">
    <div class="title">
      <label class="switch"><input type="checkbox" :checked="p.enabled" :disabled="saving.has(p.id)" @change="run(p, { enabled: ($event.target as HTMLInputElement).checked })" /> <strong>{{ p.name }}</strong></label>
      <span v-if="p.version" class="dim">v{{ p.version }}</span>
    </div>
    <p v-if="p.description" class="hint">{{ p.description }}</p>
    <p v-if="p.enabled && !p.configured" class="warn">Not active yet: fill in the required settings.</p>
    <p v-if="p.error" class="error">{{ p.error }}</p>
    <div v-for="s in p.settings" :key="s.key" class="field">
      <label :for="`${p.id}-${s.key}`">{{ s.label }}<span v-if="s.required" class="dim"> *</span></label>
      <input v-if="s.type === 'boolean'" :id="`${p.id}-${s.key}`" type="checkbox" :checked="valueOf(p, s.key, s.value) === true" @change="draftOf(p)[s.key] = ($event.target as HTMLInputElement).checked" />
      <select v-else-if="s.type === 'select'" :id="`${p.id}-${s.key}`" :value="valueOf(p, s.key, s.value)" @change="draftOf(p)[s.key] = ($event.target as HTMLSelectElement).value">
        <option v-for="o in s.options" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <div v-else-if="s.type === 'password'" class="secret">
        <input :id="`${p.id}-${s.key}`" type="password" autocomplete="off" :placeholder="s.set ? 'set (type to replace)' : 'not set'" :value="draftOf(p)[s.key] ?? ''" @input="draftOf(p)[s.key] = ($event.target as HTMLInputElement).value" />
        <button v-if="s.set" type="button" :disabled="saving.has(p.id)" @click="run(p, { values: { [s.key]: null } })">Remove</button>
      </div>
      <input v-else :id="`${p.id}-${s.key}`" type="text" :value="valueOf(p, s.key, s.value) ?? ''" @input="draftOf(p)[s.key] = ($event.target as HTMLInputElement).value" />
      <small v-if="s.description" class="dim">{{ s.description }}</small>
    </div>
    <div v-if="p.settings.length" class="actions">
      <button type="button" class="primary" :disabled="!dirty(p) || saving.has(p.id)" @click="run(p, { values: drafts[p.id] })">Save</button>
    </div>
  </section>
</template>

<style scoped>
.hint, .dim { color: var(--muted); }
.hint { margin: 0 0 12px; font-size: 0.85rem; line-height: 1.5; }
.plugin { display: grid; gap: 10px; margin-bottom: 12px; padding: 14px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
.plugin .hint { margin: 0; }
.title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.field { display: grid; gap: 4px; }
.field label { font-size: 0.85rem; }
.field small { font-size: 0.78rem; line-height: 1.4; }
input[type='text'], input[type='password'], select { width: 100%; box-sizing: border-box; padding: 7px 10px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; }
input[type='checkbox'] { justify-self: start; }
.secret { display: flex; gap: 8px; }
.warn { margin: 0; color: #e0a030; font-size: 0.85rem; }
.error { margin: 0; color: #d14343; font-size: 0.85rem; overflow-wrap: anywhere; }
.actions { display: flex; justify-content: flex-end; }
button { padding: 7px 16px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code { font-size: 0.85em; }
</style>
