import { computed, onMounted, onUnmounted, ref } from 'vue'

export interface DeviceInfo {
  id: string
  name: string
  type: string
  online: boolean | undefined // undefined: the first check is still running
  default: boolean
}

// "all" is the overview that lists the downloads of every device.
export const ALL = 'all'

export const devices = ref<DeviceInfo[]>([])
export const devicesLoaded = ref(false)

const STORAGE_KEY = 'device'
const readStored = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

// The URL anchor looks like "#downloads?device=<id|all>"; the choice is also remembered in the browser.
// The settings page adds its section: "#settings/plugins?device=…".
export type Tab = 'downloads' | 'grabber' | 'settings'
export const parseHash = (hash = location.hash): { tab: Tab; device?: string; section?: string } => {
  const [name, query] = hash.replace(/^#/, '').split('?')
  const [page, section] = name.split('/')
  const tab: Tab = page === 'linkgrabber' ? 'grabber' : page === 'settings' ? 'settings' : 'downloads'
  return { tab, section: tab === 'settings' ? section || undefined : undefined, device: new URLSearchParams(query ?? '').get('device') ?? undefined }
}
export const formatHash = (tab: Tab, device: string, section?: string): string =>
  `#${tab === 'grabber' ? 'linkgrabber' : tab === 'settings' ? `settings${section ? `/${section}` : ''}` : 'downloads'}${device ? `?device=${encodeURIComponent(device)}` : ''}`

// '' means "the default device of the backend".
export const selected = ref<string>(parseHash().device ?? readStored())
export const select = (id: string) => {
  selected.value = id
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* only a convenience */
  }
}

export const defaultDevice = computed(() => devices.value.find((d) => d.default) ?? devices.value[0])
export const multiple = computed(() => devices.value.length > 1)
// The overview only makes sense with more than one device.
export const showingAll = computed(() => selected.value === ALL && multiple.value)
// The single device that requests go to when none is named: the chosen one, else the default device.
export const currentDevice = computed(() => {
  const chosen = devices.value.find((d) => d.id === selected.value)
  return (chosen ?? defaultDevice.value)?.id ?? ''
})
// The device the JDownloader settings are about. With a single device chosen that is it; in the overview of all
// devices the settings page lists every device and the user picks one there (remembered in the browser).
const SETTINGS_KEY = 'settingsDevice'
const pickedDevice = ref<string>(
  (() => {
    try {
      return localStorage.getItem(SETTINGS_KEY) ?? ''
    } catch {
      return ''
    }
  })()
)
export const settingsDevice = computed(() => {
  if (!showingAll.value) return currentDevice.value
  const usable = (d: DeviceInfo) => d.online !== false
  return (devices.value.find((d) => d.id === pickedDevice.value && usable(d)) ?? devices.value.find((d) => d.default && usable(d)) ?? devices.value.find(usable))?.id ?? ''
})
export const pickSettingsDevice = (id: string) => {
  pickedDevice.value = id
  try {
    localStorage.setItem(SETTINGS_KEY, id)
  } catch {
    /* only a convenience */
  }
}
export const deviceName = (id: string) => devices.value.find((d) => d.id === id)?.name ?? ''

// Adds the device to an API URL (no device: the current one).
export const withDevice = (url: string, device: string | undefined = currentDevice.value): string =>
  device ? `${url}${url.includes('?') ? '&' : '?'}device=${encodeURIComponent(device)}` : url

export const loadDevices = async () => {
  try {
    const res = await fetch('/api/devices')
    if (!res.ok) return
    devices.value = await res.json()
    devicesLoaded.value = true
  } catch {
    /* the next poll retries */
  }
}

// Devices with an update waiting (JD finds updates by itself; we only look now and then, the backend keeps the answer a minute).
export const updates = ref<Record<string, boolean>>({})
export const anyUpdate = computed(() => Object.values(updates.value).some(Boolean))
export const loadUpdates = async () => {
  await Promise.all(
    devices.value
      .filter((d) => d.online !== false)
      .map(async (d) => {
        try {
          const res = await fetch(withDevice('/api/update', d.id))
          if (res.ok) updates.value = { ...updates.value, [d.id]: (await res.json()).available === true }
        } catch {
          /* the old answer stays */
        }
      })
  )
}

// Keeps the device list (and with it the online state) up to date.
export const useDevices = () => {
  let timer: ReturnType<typeof setInterval> | undefined
  let updateTimer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    void loadDevices().then(loadUpdates)
    timer = setInterval(loadDevices, 5000)
    updateTimer = setInterval(() => !document.hidden && loadUpdates(), 10 * 60_000)
  })
  onUnmounted(() => {
    clearInterval(timer)
    clearInterval(updateTimer)
  })
}
