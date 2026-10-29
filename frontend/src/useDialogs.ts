import { computed, ref } from 'vue'
import { devices, withDevice } from './devices'
import { useLive } from './live'
import { showError } from './toast'

export interface JdDialog {
  id: number
  device: string
  deviceName: string
  kind: 'choice' | 'multi' | 'input' | 'login' | 'newpassword' | 'confirm' | 'message' | 'other'
  title: string
  message: string
  details: { label: string; value: string }[]
  okText?: string
  cancelText?: string
  choices?: string[]
  preselected?: number
  defaultText?: string
  defaultUsername?: string
  rememberOption?: boolean
  remember?: boolean
}

export interface DialogAnswer {
  cancel: boolean
  index?: number
  indices?: number[]
  text?: string
  username?: string
  password?: string
  verification?: string
  remember?: boolean
}

// The dialogs the JDownloaders wait on (see backend/src/dialogs.ts). The first one is shown.
export const useDialogs = () => {
  const list = ref<JdDialog[]>([])
  const handled = ref<Set<string>>(new Set()) // answered just now, hidden until JD drops them
  const keyOf = (d: Pick<JdDialog, 'device' | 'id'>) => `${d.device}/${d.id}`

  const apply = (data: JdDialog[]) => {
    list.value = data
    const open = new Set(list.value.map(keyOf))
    if ([...handled.value].some((k) => !open.has(k))) handled.value = new Set([...handled.value].filter((k) => open.has(k)))
  }

  // Looks now (after an answer); otherwise the stream brings the changes.
  const reload = async () => {
    try {
      const res = await fetch('/api/dialogs')
      if (res.ok) apply(await res.json())
    } catch {
      /* the stream brings the next one */
    }
  }

  // JD answers its dialogs in its own order; when it names the one it wants first, that one is shown first.
  const first = ref<string | null>(null)
  const open = computed(() => list.value.filter((d) => !handled.value.has(keyOf(d))))
  const current = computed(() => open.value.find((d) => keyOf(d) === first.value) ?? open.value[0] ?? null)
  const more = computed(() => Math.max(0, open.value.length - 1))
  const multiple = computed(() => devices.value.length > 1)

  const answer = async (d: JdDialog, answer: DialogAnswer) => {
    handled.value = new Set(handled.value).add(keyOf(d))
    let reordered = false
    try {
      const res = await fetch(withDevice(`/api/dialogs/${d.id}/answer`, d.device), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(answer) })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        reordered = res.status === 409
        if (reordered) first.value = `${d.device}/${body?.first}`
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
    } catch (e) {
      handled.value = new Set([...handled.value].filter((k) => k !== keyOf(d)))
      if (!reordered) showError(`Answering the question failed: ${e instanceof Error ? e.message : e}`)
    }
    void reload()
  }

  useLive('dialogs', (data) => apply(data as JdDialog[]))

  return { current, more, multiple, answer }
}
