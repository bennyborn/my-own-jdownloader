import { readFileSync, writeFileSync } from 'node:fs'

// A thin frame a little lighter than the dark UI, so a screenshot does not vanish into a dark page (README on GitHub).
// Drawn into the finished image: exactly one image pixel, whatever the pixel ratio of the screenshot.
export const FRAME = '#3d444d'

export const frameImage = async (browser, file, color = FRAME) => {
  const page = await browser.newPage()
  const data = readFileSync(file).toString('base64')
  const out = await page.evaluate(
    async ({ data, color }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      const { naturalWidth: w, naturalHeight: h } = img
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      ctx.fillStyle = color
      for (const [x, y, width, height] of [[0, 0, w, 1], [0, h - 1, w, 1], [0, 0, 1, h], [w - 1, 0, 1, h]]) ctx.fillRect(x, y, width, height)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { data, color }
  )
  writeFileSync(file, Buffer.from(out, 'base64'))
  await page.close()
}
