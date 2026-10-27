<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

export interface SpeedSample {
  t: number // ms timestamp
  v: number // bytes per second
}

const props = defineProps<{ samples: SpeedSample[]; windowSeconds: number; limit?: number }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let raf = 0
let observer: ResizeObserver | undefined

const resize = () => {
  const el = canvas.value
  if (!el) return
  const ratio = window.devicePixelRatio || 1
  el.width = Math.max(1, Math.round(el.clientWidth * ratio))
  el.height = Math.max(1, Math.round(el.clientHeight * ratio))
}

// Scrolls continuously with real time: x depends on the sample's age, so the graph glides left
// between updates instead of jumping.
const draw = () => {
  raf = requestAnimationFrame(draw)
  const el = canvas.value
  const ctx = el?.getContext('2d')
  if (!el || !ctx) return
  const ratio = window.devicePixelRatio || 1
  const w = el.width / ratio
  const h = el.height / ratio
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const now = Date.now()
  const span = props.windowSeconds * 1000
  const visible = props.samples.filter((s) => now - s.t <= span + 10000)
  if (visible.length === 0) return

  // With a limit (speed limit, or the pause speed) the limit line is at half height; faster samples still fit.
  const limit = props.limit && props.limit > 0 ? props.limit : 0
  const peak = limit ? Math.max(limit * 2, ...visible.map((s) => s.v * 1.15)) : Math.max(...visible.map((s) => s.v), 100 * 1024) * 1.15
  const x = (t: number) => w - ((now - t) / span) * w
  const y = (v: number) => h - 3 - (v / peak) * (h - 8)

  // Hold the latest value up to "now" so the line reaches the right edge.
  const points = [...visible.map((s) => ({ x: x(s.t), y: y(s.v) })), { x: w, y: y(visible[visible.length - 1].v) }]

  const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#10ac84'
  ctx.beginPath()
  ctx.moveTo(points[0].x, h)
  ctx.lineTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    const mid = (points[i - 1].x + points[i].x) / 2
    ctx.bezierCurveTo(mid, points[i - 1].y, mid, points[i].y, points[i].x, points[i].y)
  }
  ctx.lineTo(w, h)
  ctx.closePath()
  const fill = ctx.createLinearGradient(0, 0, 0, h)
  fill.addColorStop(0, accent + '66')
  fill.addColorStop(1, accent + '0d')
  ctx.fillStyle = fill
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    const mid = (points[i - 1].x + points[i].x) / 2
    ctx.bezierCurveTo(mid, points[i - 1].y, mid, points[i].y, points[i].x, points[i].y)
  }
  ctx.strokeStyle = accent + 'bb'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // The limit: a dashed horizontal line.
  if (limit) {
    const ly = Math.round(y(limit)) + 0.5
    ctx.beginPath()
    ctx.setLineDash([6, 4])
    ctx.moveTo(0, ly)
    ctx.lineTo(w, ly)
    ctx.strokeStyle = getComputedStyle(el).getPropertyValue('--muted').trim() || '#888'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
  }
}

onMounted(() => {
  resize()
  observer = new ResizeObserver(resize)
  if (canvas.value) observer.observe(canvas.value)
  raf = requestAnimationFrame(draw)
})
onUnmounted(() => {
  cancelAnimationFrame(raf)
  observer?.disconnect()
})
</script>

<template>
  <canvas ref="canvas" class="graph" aria-hidden="true" />
</template>

<style scoped>
.graph { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0.3; border-radius: inherit; }
</style>
