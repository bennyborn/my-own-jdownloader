const url = document.getElementById('url')
const password = document.getElementById('password')
const msg = document.getElementById('msg')
const cnl = document.getElementById('cnl')
const notify = document.getElementById('notify')
// Graphical dropdown for the Click'n'Load device ('' = default device of the backend, 'ask' = choose each time).
const trigger = document.getElementById('cnlTrigger')
const menu = document.getElementById('cnlMenu')
let cnlDevice = ''
let items = [
  { value: '', label: 'Default device of the backend', icon: 'server' },
  { value: 'ask', label: 'Ask every time', icon: 'circle-help' }
]
let icons
const iconOf = (item) => {
  const node = icons.icon(item.icon, 16)
  if (item.icon === 'server') node.classList.add('on')
  if (item.icon === 'server-off') node.classList.add('off')
  return node
}
const renderDropdown = () => {
  const current = items.find((i) => i.value === cnlDevice) ?? items[0]
  trigger.replaceChildren(iconOf(current), Object.assign(document.createElement('span'), { className: 'label', textContent: current.label }), icons.icon('chevron-down', 14))
  menu.replaceChildren(
    ...items.map((item) => {
      const li = Object.assign(document.createElement('li'), { role: 'option', className: (item.value === current.value ? 'active ' : '') + (item.offline ? 'offline' : '') })
      li.append(iconOf(item), Object.assign(document.createElement('span'), { className: 'label', textContent: item.label }))
      if (item.offline) li.append(Object.assign(document.createElement('span'), { className: 'state', textContent: 'offline' }))
      else if (item.value === current.value) li.append(icons.icon('check', 14))
      li.addEventListener('click', () => {
        cnlDevice = item.value
        menu.hidden = true
        trigger.setAttribute('aria-expanded', 'false')
        renderDropdown()
      })
      return li
    })
  )
}
trigger.addEventListener('click', () => {
  menu.hidden = !menu.hidden
  trigger.setAttribute('aria-expanded', String(!menu.hidden))
})
document.addEventListener('click', (e) => {
  if (!menu.hidden && !document.getElementById('cnlDevice').contains(e.target)) {
    menu.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
  }
})
chrome.storage.local.get(['backendUrl', 'password', 'cnl', 'notify', 'cnlDevice']).then(async (s) => {
  cnl.checked = s.cnl !== false
  notify.checked = s.notify !== false
  url.value = s.backendUrl ?? ''
  password.value = s.password ?? ''
  // The devices come from the backend; if it is not reachable, only the saved choice is offered.
  const saved = s.cnlDevice ?? ''
  icons = await import('./icons.js')
  const { api } = await import('./api.js')
  const devices = await api('/api/devices').catch(() => [])
  items = [...items, ...devices.map((d) => ({ value: d.id, label: d.name, icon: d.online === false ? 'server-off' : 'server', offline: d.online === false }))]
  if (saved && saved !== 'ask' && !devices.some((d) => d.id === saved)) items.push({ value: saved, label: 'Saved device (backend not reachable)', icon: 'server-off' })
  cnlDevice = saved
  renderDropdown()
})
document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ backendUrl: url.value.trim(), password: password.value, cnl: cnl.checked, notify: notify.checked, cnlDevice })
  msg.textContent = 'Saved.'
})

// The test works regardless of the checkbox: it only shows that notifications reach the desktop.
const testMsg = document.getElementById('testmsg')
document.getElementById('test').addEventListener('click', async () => {
  testMsg.className = ''
  testMsg.textContent = ''
  const res = await chrome.runtime.sendMessage({ type: 'test-notification' }).catch(() => undefined)
  testMsg.className = res?.ok ? '' : 'err'
  // No answer at all: the background part of the extension is an older version (it does not know this message
  // and the "notifications" permission is missing) until the extension is reloaded.
  testMsg.textContent = res?.ok ? 'Sent, you should see it now.' : res?.error ?? 'No answer from the extension: reload it at chrome://extensions'
})
