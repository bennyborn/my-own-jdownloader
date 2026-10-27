import { ref, watch } from 'vue'
import { devices, loadUpdates, withDevice } from './devices'
import { showError, showSuccess } from './toast'

// What the update of a JDownloader is doing right now, shown as a toast until it is back online.
export const updateStatus = ref<string | null>(null)
// Devices whose update is running (the update button shows a spinner for them).
export const updating = ref<string[]>([])
// Counts the finished restarts / updates, for pages that show what the JDownloader has after one.
export const finishedWatches = ref(0)

const NO_RESTART_AFTER = 3 * 60_000
const GIVE_UP_AFTER = 20 * 60_000

// Follows a device through "shutting down" (online), "restarting and installing" (offline) and back online.
// The device list is polled all the time, so a watch on it is enough.
export const watchUpdate = (deviceId: string, restartOnly = false) => {
  const name = () => devices.value.find((d) => d.id === deviceId)?.name ?? 'JDownloader'
  const started = Date.now()
  let wentOffline = false
  updating.value = [...updating.value, deviceId]
  updateStatus.value = restartOnly ? `Restart of ${name()}: shutting down…` : `Update on ${name()}: stopping downloads and restarting…`

  const stop = watch(
    devices,
    () => {
      const online = devices.value.find((d) => d.id === deviceId)?.online
      if (online === false && !wentOffline) {
        wentOffline = true
        updateStatus.value = restartOnly ? `Restart of ${name()}: starting again…` : `Update on ${name()}: installing, this takes a few minutes…`
      } else if (online === true && wentOffline) {
        finish()
        showSuccess(restartOnly ? `${name()} is back online.` : `${name()} is back online with the update.`)
        void loadUpdates()
      }
    },
    { deep: true }
  )
  // The online state of the device list can lag behind a restart; JD's own uptime tells it for sure (one cheap call now and then).
  let ticks = 0
  const lookAtUptime = async () => {
    try {
      const res = await fetch(withDevice('/api/jd-system', deviceId))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { uptime } = (await res.json()) as { uptime: number }
      if (uptime < Date.now() - started && updating.value.includes(deviceId)) {
        finish()
        showSuccess(restartOnly ? `${name()} is back online.` : `${name()} is back online with the update.`)
        void loadUpdates()
      }
    } catch {
      if (!wentOffline) {
        wentOffline = true
        updateStatus.value = restartOnly ? `Restart of ${name()}: starting again…` : `Update on ${name()}: installing, this takes a few minutes…`
      }
    }
  }
  const timer = setInterval(() => {
    if (++ticks % 2 === 0) void lookAtUptime()
    const waited = Date.now() - started
    if (waited > GIVE_UP_AFTER) {
      finish()
      showError(`${name()} did not come back within 20 minutes. Check the JDownloader.`)
    } else if (!wentOffline && waited > NO_RESTART_AFTER) {
      finish()
      showError(`${name()} did not restart.`)
    }
  }, 5000)
  function finish() {
    stop()
    clearInterval(timer)
    updateStatus.value = null
    finishedWatches.value++
    updating.value = updating.value.filter((id) => id !== deviceId)
  }
}
