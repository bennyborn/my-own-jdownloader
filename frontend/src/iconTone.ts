// Some favicons are a single dark (or light) colour on a transparent background and disappear on the opposite
// theme. After an icon loaded it is measured once; such icons get data-tone="dark" / "light", and the global
// styles in App.vue invert them when they would otherwise be hard to see.
const SIZE = 16
const tones = new Map<string, 'dark' | 'light' | ''>()

const measure = (img: HTMLImageElement): 'dark' | 'light' | '' => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return ''
  try {
    ctx.drawImage(img, 0, 0, SIZE, SIZE)
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE)
    let seen = 0
    let luma = 0
    let chroma = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue
      seen++
      luma += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
      chroma += (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])) / 255
    }
    // Needs some content and a visibly transparent background (an icon on a solid tile stays as it is).
    if (seen < 4 || seen > SIZE * SIZE * 0.85 || chroma / seen > 0.15) return ''
    const average = luma / seen
    return average < 0.25 ? 'dark' : average > 0.8 ? 'light' : ''
  } catch {
    return '' // tainted or undecodable: leave the icon alone
  }
}

// @load handler for host icons.
export const toneIcon = (event: Event) => {
  const img = event.target as HTMLImageElement
  let tone = tones.get(img.currentSrc)
  if (tone === undefined) {
    tone = measure(img)
    tones.set(img.currentSrc, tone)
  }
  if (tone) img.dataset.tone = tone
  else delete img.dataset.tone
}
