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

    const notes = [
      { freq: 523.25, start: 0,    dur: 0.25 }, // C5
      { freq: 659.25, start: 0.18, dur: 0.25 }, // E5
      { freq: 783.99, start: 0.36, dur: 0.4  }, // G5
    ]

    notes.forEach(({ freq, start, dur }) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start)
      gain.gain.setValueAtTime(0, ctx.currentTime + start)
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + dur)
    })
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
    osc.frequency.setValueAtTime(440, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.4)
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)
  } catch (_) {}
}
