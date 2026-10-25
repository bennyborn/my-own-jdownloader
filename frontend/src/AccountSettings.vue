<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-vue-next'
import { toneIcon } from './iconTone'
import { settingsDevice } from './devices'
import { accounts, accountsError, accountsState, addAccount, loadAccounts, loadPremiumHosters, premiumHosters, refreshAccounts, removeAccounts, setAccountsEnabled, setCredentials, type Account } from './accounts'
import { askConfirm } from './confirm'
import { formatBytes } from './format'
import { showError } from './toast'

watch(settingsDevice, () => {
  void loadAccounts()
  void loadPremiumHosters()
})
void loadAccounts()
void loadPremiumHosters()

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

const status = (a: Account): { text: string; tone: 'ok' | 'warn' | 'bad' | 'off' } => {
  if (!a.enabled) return { text: 'Disabled', tone: 'off' }
  if (a.error) return { text: a.errorString || a.error.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()), tone: 'bad' }
  if (!a.valid) return { text: 'Not valid', tone: 'warn' }
  return { text: 'Premium', tone: 'ok' }
}
const validUntil = (a: Account) => (a.validUntil ? new Date(a.validUntil).toLocaleDateString() : 'unlimited')
const traffic = (a: Account) => (a.trafficMax ? `${formatBytes(a.trafficLeft ?? 0)} of ${formatBytes(a.trafficMax)} left` : 'unlimited')
const trafficPercent = (a: Account) => (a.trafficMax ? Math.min(100, Math.round(((a.trafficLeft ?? 0) / a.trafficMax) * 100)) : 0)

// --- Add ------------------------------------------------------------------------------------------------
const adding = ref(false)
const form = reactive({ hostname: '', username: '', password: '' })
const canAdd = computed(() => form.hostname.trim() && form.username.trim() && !busy.value)
const add = async () => {
  if (await run('Adding the account failed', () => addAccount(form.hostname, form.username, form.password))) {
    Object.assign(form, { hostname: '', username: '', password: '' })
    adding.value = false
  }
}

// --- Edit -----------------------------------------------------------------------------------------------
const editing = ref<number | null>(null)
const edit = reactive({ username: '', password: '' })
const startEdit = (a: Account) => {
  editing.value = a.uuid
  edit.username = a.username
  edit.password = ''
}
const saveEdit = async (a: Account) => {
  if (await run('Saving failed', () => setCredentials(a.uuid, edit.username, edit.password))) editing.value = null
}

const remove = async (a: Account) => {
  if (!(await askConfirm({ title: 'Remove account', message: `Remove the ${a.hostname} account "${a.username}" from the JDownloader?`, confirmLabel: 'Remove', danger: true }))) return
  await run('Removing failed', () => removeAccounts([a.uuid]))
}
</script>

<template>
  <p v-if="accountsState === 'error'" class="error">The accounts could not be loaded: {{ accountsError }}</p>
  <template v-else>
    <div class="toolbar">
      <button type="button" class="primary" @click="adding = !adding"><Plus :size="15" /> Add account</button>
      <button type="button" :disabled="busy || !accounts.length" @click="run('Refresh failed', () => refreshAccounts(accounts.map((a) => a.uuid)))"><RefreshCw :size="15" /> Refresh all</button>
    </div>

    <form v-if="adding" class="card add" @submit.prevent="add">
      <div class="field">
        <label for="acc-host">Hoster</label>
        <input id="acc-host" v-model="form.hostname" list="premium-hosters" type="text" autocomplete="off" placeholder="e.g. rapidgator.net" />
        <datalist id="premium-hosters"><option v-for="h in premiumHosters" :key="h" :value="h"></option></datalist>
      </div>
      <div class="field">
        <label for="acc-user">Username</label>
        <input id="acc-user" v-model="form.username" type="text" autocomplete="off" />
      </div>
      <div class="field">
        <label for="acc-pass">Password</label>
        <input id="acc-pass" v-model="form.password" type="password" autocomplete="new-password" />
      </div>
      <div class="actions">
        <button type="button" @click="adding = false">Cancel</button>
        <button type="submit" class="primary" :disabled="!canAdd">Add</button>
      </div>
    </form>

    <p v-if="accountsState === 'loading' && !accounts.length" class="hint">Loading…</p>
    <p v-else-if="!accounts.length && !adding" class="hint">No accounts yet. Without one, hosters only work in their free mode.</p>

    <article v-for="a in accounts" :key="a.uuid" class="card account" :class="{ off: !a.enabled }">
      <div class="head">
        <img class="hosticon" :src="`/api/icons/${a.hostname}`" alt="" width="20" height="20" @load="toneIcon" @error="($event.target as HTMLElement).style.display = 'none'" />
        <div class="who">
          <strong>{{ a.hostname }}</strong>
          <span class="dim">{{ a.username }}</span>
        </div>
        <span class="badge" :class="status(a).tone">{{ status(a).text }}</span>
      </div>
      <dl class="facts">
        <div><dt>Valid until</dt><dd>{{ validUntil(a) }}</dd></div>
        <div>
          <dt>Traffic</dt>
          <dd>
            {{ traffic(a) }}
            <span v-if="a.trafficMax" class="bar"><span :style="{ width: trafficPercent(a) + '%' }"></span></span>
          </dd>
        </div>
      </dl>
      <form v-if="editing === a.uuid" class="edit" @submit.prevent="saveEdit(a)">
        <input v-model="edit.username" type="text" autocomplete="off" aria-label="Username" />
        <input v-model="edit.password" type="password" autocomplete="new-password" aria-label="New password" placeholder="New password" />
        <button type="submit" class="primary" :disabled="busy || !edit.username.trim()">Save</button>
        <button type="button" aria-label="Cancel" @click="editing = null"><X :size="14" /></button>
      </form>
      <div class="row-actions">
        <label class="switch"><input type="checkbox" :checked="a.enabled" :disabled="busy" @change="run('Switching failed', () => setAccountsEnabled([a.uuid], ($event.target as HTMLInputElement).checked))" /> Enabled</label>
        <span class="spacer"></span>
        <button type="button" class="icon" title="Check again" aria-label="Check again" :disabled="busy" @click="run('Refresh failed', () => refreshAccounts([a.uuid]))"><RefreshCw :size="15" /></button>
        <button type="button" class="icon" title="Change login" aria-label="Change login" @click="startEdit(a)"><Pencil :size="15" /></button>
        <button type="button" class="icon" title="Remove" aria-label="Remove" :disabled="busy" @click="remove(a)"><Trash2 :size="15" /></button>
      </div>
    </article>
  </template>
</template>

<style scoped>
.hint, .dim { color: var(--muted); }
.hint { font-size: 0.85rem; }
.error { color: #d14343; font-size: 0.85rem; overflow-wrap: anywhere; }
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.card { display: grid; gap: 12px; margin-bottom: 12px; padding: 14px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
.account.off { opacity: 0.7; }
.head { display: flex; align-items: center; gap: 10px; }
.who { display: grid; min-width: 0; flex: 1; }
.who span { overflow: hidden; text-overflow: ellipsis; font-size: 0.85rem; }
.badge { padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; white-space: nowrap; background: var(--hover); color: var(--muted); }
.badge.ok { color: #3fb27f; background: color-mix(in srgb, #3fb27f 15%, transparent); }
.badge.warn { color: #e0a030; background: color-mix(in srgb, #e0a030 15%, transparent); }
.badge.bad { color: #d14343; background: color-mix(in srgb, #d14343 15%, transparent); }
.facts { display: flex; gap: 28px; flex-wrap: wrap; margin: 0; font-size: 0.85rem; }
.facts dt { color: var(--muted); font-size: 0.75rem; }
.facts dd { margin: 0; display: grid; gap: 4px; }
.bar { display: block; width: 160px; height: 4px; background: var(--hover); border-radius: 2px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); }
.row-actions { display: flex; align-items: center; gap: 4px; }
.spacer { flex: 1; }
.switch { display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; cursor: pointer; }
.field { display: grid; gap: 4px; }
.field label { font-size: 0.85rem; }
.edit { display: flex; gap: 8px; flex-wrap: wrap; }
.edit input { flex: 1; min-width: 140px; }
input[type='text'], input[type='password'] { width: 100%; box-sizing: border-box; padding: 7px 10px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; }
.actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.icon { padding: 6px; background: none; border-color: transparent; color: var(--muted); }
button.icon:hover { color: var(--text); background: var(--hover); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
