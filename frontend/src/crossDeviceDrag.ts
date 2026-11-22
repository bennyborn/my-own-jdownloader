import { ref } from 'vue'
import { deviceName, withDevice } from './devices'
import { askConfirm } from './confirm'
import { showError, showSuccess } from './toast'

// A package dragged out of one device's list, kept here so a *different* device's list (its own drag
// instance never saw the dragstart, see dragReorder.ts) can offer itself as a drop target for it.
export interface CrossDragPayload {
  area: 'downloads' | 'linkgrabber'
  device: string
  packageId: number
  name: string
  // Download list only: already has bytes loaded or is running, so moving it restarts the transfer from 0% on the target.
  hasProgress: boolean
}

export const crossDrag = ref<CrossDragPayload | null>(null)

export const startCrossDrag = (payload: CrossDragPayload) => {
  crossDrag.value = payload
}

export const endCrossDrag = () => {
  crossDrag.value = null
}

// Set while a move is in flight (MovingDialog.vue shows it as a blocking dialog with a spinner): the backend only
// reports success once it confirmed the package landed on the target (it polls there for a few seconds), clearly
// longer than most other actions, so a corner toast alone was easy to miss / mistake for nothing having happened.
export const moving = ref<string | null>(null)

// Asks for confirmation (with a warning if progress would be lost), then moves the package over. Shared by the
// cross-device drag drop and the "Move to device…" context menu entry (for touch / no drag-and-drop).
export const moveToDevice = async (payload: CrossDragPayload, targetDevice: string, onMoved?: () => void): Promise<void> => {
  if (payload.device === targetDevice) return
  const warning = payload.hasProgress
    ? ` The download has already started on "${deviceName(payload.device)}" and will restart from 0% on "${deviceName(targetDevice)}"; its partial file is deleted on the source.`
    : ''
  const ok = await askConfirm({
    title: 'Move to another device',
    message: `"${payload.name}" will be moved to "${deviceName(targetDevice)}".${warning}`,
    confirmLabel: 'Move'
  })
  if (!ok) return
  moving.value = `Moving "${payload.name}" to "${deviceName(targetDevice)}"…`
  try {
    const res = await fetch(withDevice('/api/packages/move-to-device', payload.device), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: payload.area, packageId: payload.packageId, targetDevice })
    })
    if (!res.ok) throw new Error((await res.json().catch(() => undefined))?.error ?? `HTTP ${res.status}`)
    showSuccess(`"${payload.name}" was moved to "${deviceName(targetDevice)}"`)
    onMoved?.()
  } catch (e) {
    showError(`Moving to device failed: ${e instanceof Error ? e.message : e}`)
  } finally {
    moving.value = null
  }
}

// Drop target for a cross-device drag. No-op if nothing is being dragged or it is dropped back onto its own device.
export const dropCrossDrag = async (targetDevice: string, onMoved?: () => void): Promise<void> => {
  const payload = crossDrag.value
  endCrossDrag()
  if (!payload) return
  await moveToDevice(payload, targetDevice, onMoved)
}
