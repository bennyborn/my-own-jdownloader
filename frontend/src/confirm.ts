import { ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  // Information only: a single OK button.
  hideCancel?: boolean
  // Optional checkbox; the caller reads `checked` after the dialog resolved.
  option?: { label: string; checked: boolean }
}

export const confirmState = ref<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)

// Replacement for window.confirm(): resolves to true if the user confirmed.
export const askConfirm = (options: ConfirmOptions): Promise<boolean> =>
  new Promise((resolve) => {
    confirmState.value?.resolve(false)
    confirmState.value = { ...options, resolve }
  })

export const answerConfirm = (ok: boolean) => {
  confirmState.value?.resolve(ok)
  confirmState.value = null
}

// Shows a message with a single OK button.
export const showInfo = (title: string, message: string): Promise<boolean> => askConfirm({ title, message, confirmLabel: 'OK', hideCancel: true })
