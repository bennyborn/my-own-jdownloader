package app.myownjd

import android.content.Context
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.os.SystemClock
import android.provider.Settings
import android.view.View
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

// A very quiet background: a few soft colour glows drift slowly over the dark base (periods of 20-40 seconds).
// Stands still if the system has animations switched off.
class AmbientView(context: Context) : View(context) {
    private class Glow(val color: Int, val cx: Float, val cy: Float, val ax: Float, val ay: Float, val period: Float, val phase: Float, val radius: Float) {
        var shader: Shader? = null
        val matrix = Matrix()
    }

    private val glows = listOf(
        Glow(0xFF015866.toInt(), 0.25f, 0.20f, 0.20f, 0.12f, 34f, 0f, 0.75f),
        Glow(0xFF10AC84.toInt(), 0.80f, 0.75f, 0.18f, 0.14f, 41f, 2f, 0.60f),
        Glow(0xFFFECF02.toInt(), 0.70f, 0.15f, 0.15f, 0.10f, 27f, 4f, 0.40f)
    )
    private val alpha = intArrayOf(0x90, 0x48, 0x14)
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val start = SystemClock.uptimeMillis()
    private val animated = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        glows.forEachIndexed { i, g ->
            val r = max(w, h) * g.radius
            g.shader = RadialGradient(0f, 0f, r, (alpha[i] shl 24) or (g.color and 0xFFFFFF), g.color and 0xFFFFFF, Shader.TileMode.CLAMP)
        }
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawColor(0xFF0D1117.toInt())
        val t = (SystemClock.uptimeMillis() - start) / 1000f
        for (g in glows) {
            val angle = (2 * Math.PI * t / g.period + g.phase).toFloat()
            g.matrix.setTranslate(width * (g.cx + g.ax * sin(angle)), height * (g.cy + g.ay * cos(angle)))
            g.shader?.setLocalMatrix(g.matrix)
            paint.shader = g.shader
            canvas.drawPaint(paint)
        }
        if (animated) postInvalidateDelayed(33)
    }
}
