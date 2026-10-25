const url = document.getElementById('url')
const password = document.getElementById('password')
const msg = document.getElementById('msg')
const cnl = document.getElementById('cnl')
const notify = document.getElementById('notify')
chrome.storage.local.get(['backendUrl', 'password', 'cnl', 'notify']).then((s) => {
  cnl.checked = s.cnl !== false
  notify.checked = s.notify !== false
  url.value = s.backendUrl ?? ''
  password.value = s.password ?? ''
})
document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ backendUrl: url.value.trim(), password: password.value, cnl: cnl.checked, notify: notify.checked })
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
