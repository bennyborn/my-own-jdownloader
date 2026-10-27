import { ref } from 'vue'

export interface PromptOptions {
  title: string
  message?: string
  confirmLabel?: string
  // A text field (placeholder, start value) or a list of choices to pick one from (the first one is preselected unless `initial` names one).
  placeholder?: string
  initial?: string
  allowEmpty?: boolean
  choices?: { value: string; label: string }[]
}

export const promptState = ref<(PromptOptions & { value: string; resolve: (value: string | null) => void }) | null>(null)

// Asks for a text or a choice: resolves to the entered text / chosen value, or null when cancelled.
export const askPrompt = (options: PromptOptions): Promise<string | null> =>
  new Promise((resolve) => {
    promptState.value?.resolve(null)
    promptState.value = { ...options, value: options.initial ?? options.choices?.[0]?.value ?? '', resolve }
  })

export const answerPrompt = (ok: boolean) => {
  const state = promptState.value
  if (!state) return
  promptState.value = null
  state.resolve(ok && (state.allowEmpty || state.value.trim()) ? state.value : null)
}
