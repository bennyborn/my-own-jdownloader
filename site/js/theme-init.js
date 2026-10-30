// Runs before the first paint: applies a stored theme choice so the page does not flash in the wrong theme.
try {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light') document.documentElement.dataset.theme = stored
} catch {
  /* storage unavailable: follow the system */
}
