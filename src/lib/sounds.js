/**
 * Genera sonidos usando Web Audio API — sin archivos externos.
 */

function getAudioContext() {
  if (typeof window === 'undefined') return null
  return new (window.AudioContext || window.webkitAudioContext)()
}

/**
 * Toca una secuencia de notas (chime de compleción de sesión de trabajo).
 */
export function playWorkComplete() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const melody = [
      { freq: 523.25, dur: 0.3 }, // C5
      { freq: 659.25, dur: 0.3 }, // E5
      { freq: 783.99, dur: 0.3 }, // G5
      { freq: 1046.5, dur: 0.5 }, // C6
    ]

    const totalReps = 6
    let offset = 0
    for (let r = 0; r < totalReps; r++) {
      if (r > 0) offset += 0.8
      melody.forEach(({ freq, dur }) => {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, ctx.currentTime + offset)
        gain.gain.setValueAtTime(0, ctx.currentTime + offset)
        gain.gain.linearRampToValueAtTime(0.7, ctx.currentTime + offset + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + dur)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(ctx.currentTime + offset)
        osc.stop(ctx.currentTime + offset + dur)
        offset += dur * 0.7
      })
    }
  } catch (_) { /* silencioso si el navegador bloquea */ }
}

/**
 * Toca un sonido suave para compleción de descanso.
 */
export function playBreakComplete() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    for (let r = 0; r < 10; r++) {
      const t = r * 3
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(440, ctx.currentTime + t)
      o.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + t + 2.0)
      g.gain.setValueAtTime(0.6, ctx.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 2.5)
      o.connect(g)
      g.connect(ctx.destination)
      o.start(ctx.currentTime + t)
      o.stop(ctx.currentTime + t + 2.5)
    }
  } catch (_) {}
}
