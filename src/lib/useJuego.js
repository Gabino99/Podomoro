import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'
import { textoCofre, insignia, rangoDe } from './juego'

// Estado del juego (nivel, racha, combo, retos, insignias…) desde el servidor,
// más una cola de avisos para celebrar logros.
export function useJuego(userId) {
  const [juego, setJuego]   = useState(null)
  const [avisos, setAvisos] = useState([])
  const nivelPrevio = useRef(null)
  const reglasRef = useRef(null)   // reglas vigentes, para los textos de los cofres
  const seq = useRef(0)

  const celebrar = useCallback((texto, tipo = 'info') => {
    const id = ++seq.current
    setAvisos(a => [...a.slice(-3), { id, texto, tipo }])
    setTimeout(() => setAvisos(a => a.filter(x => x.id !== id)), tipo === 'grande' ? 6000 : 4200)
  }, [])

  const refrescar = useCallback(async () => {
    if (!userId) return null
    const { data, error } = await supabase.rpc('estado_juego')
    if (error || !data?.exito) return null           // sin v6 instalada: la app sigue sin juego
    if (nivelPrevio.current && data.nivel > nivelPrevio.current) {
      const r = rangoDe(data.nivel)
      celebrar(`⬆️ ¡Subió a nivel ${data.nivel}! ${r.avatar} ${data.rango}`, 'grande')
    }
    nivelPrevio.current = data.nivel
    reglasRef.current = data.reglas ?? null
    setJuego(data)
    return data
  }, [userId, celebrar])

  // Celebra lo que devolvió el servidor al completar algo (misión, sync, reto, jefe).
  const celebrarResultado = useCallback((r) => {
    if (!r) return
    if (r.combo > 1) celebrar(`⚡ Combo ×${r.combo}${r.doble ? ' · ✨ doble' : ''}: +${r.puntos_mision} pts`, 'combo')
    else if (r.doble) celebrar(`✨ XP doble: +${r.puntos_mision} pts`, 'combo')
    const cofres = r.cofre ? [r.cofre] : (r.cofres ?? [])
    cofres.forEach(c => {
      // Con un solo cofre, los puntos son los que otorgó el servidor (el tope diario puede recortarlos).
      const t = textoCofre(c, reglasRef.current, r.cofre ? r.cofre_puntos : null)
      if (t) celebrar(`${t.emoji} ${t.texto}`, c === 'legendario' ? 'grande' : 'cofre')
    })
    ;(r.insignias ?? []).forEach(id => {
      const i = insignia(id)
      celebrar(`🏅 Nueva insignia: ${i.emoji} ${i.nombre}`, 'grande')
    })
  }, [celebrar])

  useEffect(() => {
    nivelPrevio.current = null
    refrescar()
    // Cada minuto: el combo se vence y el día cambia aunque no haga nada.
    const iv = setInterval(() => { if (document.visibilityState === 'visible') refrescar() }, 60000)
    return () => clearInterval(iv)
  }, [refrescar])

  return { juego, refrescar, celebrar, celebrarResultado, avisos }
}
