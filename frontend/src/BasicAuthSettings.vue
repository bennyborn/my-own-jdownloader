<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import LoadingState from './LoadingState.vue'
import { Pencil, Plus, Trash2, X } from 'lucide-vue-next'
import { settingsDevice } from './devices'
import { addLogin, loadLogins, logins, loginsError, loginsState, removeLogins, updateLogin, type BasicAuth, type BasicAuthType } from './basicAuth'
import { askConfirm } from './confirm'
import { showError } from './toast'

watch(settingsDevice, () => void loadLogins())
void loadLogins()

const busy = ref(false)
const run = async (what: string, job: () => Promise<void>): Promise<boolean> => {
  busy.value = true
  try {
    await job()
    return true
  } catch (e) {
    showError(`${what}: ${e instanceof Error ? e.message : e}`)
    return false
  } finally {
    busy.value = false
  }
}

// --- Add ------------------------------------------------------------------------------------------------
const adding = ref(false)
const form = reactive({ type: 'HTTP' as BasicAuthType, hostmask: '', username: '', password: '' })
const canAdd = computed(() => form.hostmask.trim() && form.username.trim() && !busy.value)
const add = async () => {
  if (await run('Adding the login failed', () => addLogin(form.type, form.hostmask, form.username, form.password))) {
    Object.assign(form, { hostmask: '', username: '', password: '' })
    adding.value = false
  }
}

// --- Edit -----------------------------------------------------------------------------------------------
const editing = ref<number | null>(null)
const edit = reactive({ type: 'HTTP' as BasicAuthType, hostmask: '', username: '', password: '' })
const startEdit = (a: BasicAuth) => {
  editing.value = a.id
  Object.assign(edit, { type: a.type, hostmask: a.hostmask, username: a.username, password: '' })
}
const saveEdit = async (a: BasicAuth) => {
  if (await run('Saving failed', () => updateLogin(a.id, { ...edit }))) editing.value = null
}

const remove = async (a: BasicAuth) => {
  if (!(await askConfirm({ title: 'Remove login', message: `Remove the ${a.type} login "${a.username}" for ${a.hostmask} from the JDownloader?`, confirmLabel: 'Remove', danger: true }))) return
  await run('Removing failed', () => removeLogins([a.id]))
}
</script>

<template>
  <p v-if="loginsState === 'error'" class="error">The logins could not be loaded: {{ loginsError }}</p>
  <template v-else>
    <p class="hint intro">Logins for sites that ask for a user name and password (HTTP or FTP), used when a link needs them. The host can be a name like <code>files.example.com</code> or a pattern like <code>*.example.com</code>.</p>
    <div class="toolbar">
      <button type="button" class="primary" @click="adding = !adding"><Plus :size="15" /> Add login</button>
    </div>

    <form v-if="adding" class="card add" @submit.prevent="add">
      <div class="field">
        <label for="ba-type">Type</label>
        <select id="ba-type" v-model="form.type"><option>HTTP</option><option>FTP</option></select>
      </div>
      <div class="field">
        <label for="ba-host">Host</label>
        <input id="ba-host" v-model="form.hostmask" type="text" autocomplete="off" placeholder="e.g. files.example.com" />
      </div>
      <div class="field">
        <label for="ba-user">Username</label>
        <input id="ba-user" v-model="form.username" type="text" autocomplete="off" />
      </div>
      <div class="field">
        <label for="ba-pass">Password</label>
        <input id="ba-pass" v-model="form.password" type="password" autocomplete="new-password" />
      </div>
      <div class="actions">
        <button type="button" @click="adding = false">Cancel</button>
        <button type="submit" class="primary" :disabled="!canAdd">Add</button>
      </div>
    </form>

    <LoadingState v-if="loginsState === 'loading' && !logins.length" text="Loading logins…" />
    <p v-else-if="!logins.length && !adding" class="hint">No logins yet.</p>

    <article v-for="a in logins" :key="a.id" class="card login" :class="{ off: !a.enabled }">
      <div class="head">
        <span class="type">{{ a.type }}</span>
        <div class="who">
          <strong>{{ a.hostmask }}</strong>
          <span class="dim">{{ a.username }}</span>
        </div>
      </div>
      <form v-if="editing === a.id" class="edit" @submit.prevent="saveEdit(a)">
        <select v-model="edit.type" aria-label="Type"><option>HTTP</option><option>FTP</option></select>
        <input v-model="edit.hostmask" type="text" autocomplete="off" aria-label="Host" />
        <input v-model="edit.username" type="text" autocomplete="off" aria-label="Username" />
        <input v-model="edit.password" type="password" autocomplete="new-password" aria-label="New password" placeholder="New password (empty keeps it)" />
        <button type="submit" class="primary" :disabled="busy || !edit.username.trim() || !edit.hostmask.trim()">Save</button>
        <button type="button" aria-label="Cancel" @click="editing = null"><X :size="14" /></button>
      </form>
      <div class="row-actions">
        <label class="switch"><input type="checkbox" :checked="a.enabled" :disabled="busy" @change="run('Switching failed', () => updateLogin(a.id, { enabled: ($event.target as HTMLInputElement).checked }))" /> Enabled</label>
        <span class="spacer"></span>
        <button type="button" class="icon" title="Edit" aria-label="Edit" @click="startEdit(a)"><Pencil :size="15" /></button>
        <button type="button" class="icon" title="Remove" aria-label="Remove" :disabled="busy" @click="remove(a)"><Trash2 :size="15" /></button>
      </div>
    </article>
  </template>
</template>

<style scoped>
.hint, .dim { color: var(--muted); }
.hint { font-size: 0.85rem; }
.intro { margin-top: 0; }
.error { color: #d14343; font-size: 0.85rem; overflow-wrap: anywhere; }
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.card { display: grid; gap: 12px; margin-bottom: 12px; padding: 14px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
.login.off { opacity: 0.7; }
.head { display: flex; align-items: center; gap: 10px; }
.type { padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; background: var(--hover); color: var(--muted); }
.who { display: grid; min-width: 0; flex: 1; }
.who strong, .who span { overflow: hidden; text-overflow: ellipsis; }
.who span { font-size: 0.85rem; }
.row-actions { display: flex; align-items: center; gap: 4px; }
.spacer { flex: 1; }
.switch { display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; cursor: pointer; }
.field { display: grid; gap: 4px; }
.field label { font-size: 0.85rem; }
.edit { display: flex; gap: 8px; flex-wrap: wrap; }
.edit input { flex: 1; min-width: 140px; }
input[type='text'], input[type='password'], select { box-sizing: border-box; padding: 7px 10px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; }
.field input, .field select { width: 100%; }
.actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.icon { padding: 6px; background: none; border-color: transparent; color: var(--muted); }
button.icon:hover { color: var(--text); background: var(--hover); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
