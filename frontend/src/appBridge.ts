// The Android app (android/) shows this web interface in a WebView and hands it a bridge object named "Android".
// In a normal browser there is none, and everything here stays inactive.
export interface AndroidBridge {
  // Opens the native solver screen for a token captcha (ids go as strings, JS numbers do not survive every bridge type).
  solve(id: string, device: string): void
  // JSON {url, password}: the connection data, kept on the phone only.
  getConfig(): string
  // Saves the connection data and reloads the interface from the new address. Returns '' or an error message.
  setConfig(url: string, password: string): string
  // The bell: 'on' | 'off' | 'ask' (permission can be requested) | 'blocked' (only the Android settings help).
  // The app watches the backend for captchas itself and notifies natively, also when the interface is closed.
  notifyState(): string
  // Bell clicked: requests the permission, switches on or off, or opens the system settings. The answer comes as the
  // event "android-state" on window (the state is read again then).
  toggleNotify(): void
  // JSON {next, after}: what the solver does once a captcha is done: continue with the next open one (next), and when none is
  // left go back to where the user was ('back') or show the downloads ('downloads').
  getSolverOptions(): string
  setSolverOptions(next: boolean, after: string): void
  // A native notification when a package has finished downloading and the app is not in front.
  getNotifyDownloads(): boolean
  setNotifyDownloads(on: boolean): void
  // Click'n'Load on the phone: 'on' | 'off'. Switching on starts a background service (127.0.0.1:9666).
  cnlState(): string
  setCnl(on: boolean): void
  // Where links from outside the interface (Click'n'Load, "share" from other apps) go: '' = default device, 'ask', or a device id.
  getCnlDevice(): string
  setCnlDevice(id: string): void
  // JSON {enabled, after, hide, available}: the app lock (after = minutes in the background, 0 = every time).
  getLock(): string
  // Switching the lock on or off asks for the phone's fingerprint / PIN first (answer: event "android-state").
  // Returns '' or an error message.
  setLock(enabled: boolean, after: number, hide: boolean): string
  // JSON {name, code}: the installed version of the app.
  appVersion(): string
  // JSON {kind, name, message}: idle | checking | current | unavailable | available | downloading | installing | error. Changes come as "android-state".
  updateState(): string
  // Asks the backend whether it offers a newer APK (the app also does this once at every start).
  checkUpdate(): void
  // Downloads the offered APK and hands it to Android's installer (which asks the user).
  installUpdate(): void
}

export const androidBridge = (window as unknown as { Android?: AndroidBridge }).Android
export const inApp = androidBridge !== undefined

export const solveInApp = (job: { id: number; device: string }) => androidBridge?.solve(String(job.id), job.device)

// Our browser extension marks every page it runs on, so the interface can tell whether a solver page can be solved here.
export const extensionActive = () => inApp || document.documentElement.hasAttribute('data-myjd-extension')
