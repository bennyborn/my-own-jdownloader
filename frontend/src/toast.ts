import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  kind?: 'success'
}

export const toasts = ref<Toast[]>([])
let nextId = 1

export const dismissToast = (id: number) => (toasts.value = toasts.value.filter((t) => t.id !== id))

// A progress toast stays as long as the work is going on (null hides it); it cannot be dismissed by hand.
export const progress = ref<string | null>(null)

// Shows an error toast; it disappears on click or after a time that grows with the message length.
export const showError = (message: string) => {
  if (toasts.value.some((t) => t.message === message && t.kind !== 'success')) return // the same message twice says nothing new
  const id = nextId++
  toasts.value = [...toasts.value, { id, message }]
  setTimeout(() => dismissToast(id), Math.min(15000, 4000 + message.length * 60))
}

// Shows a success toast (e.g. a package finished downloading); it disappears on click or after a few seconds.
export const showSuccess = (message: string) => {
  const id = nextId++
  toasts.value = [...toasts.value, { id, message, kind: 'success' }]
  setTimeout(() => dismissToast(id), 8000)
}
