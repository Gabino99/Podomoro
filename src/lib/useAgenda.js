import { useState, useEffect, useCallback } from 'react'
import { llamarTodoist } from './todoist'

// Próximos eventos de Google Calendar (los lee la Edge Function con el secreto
// GOOGLE_ICS_URL). Se refresca cada 5 min y el "en N min" se recalcula cada 30 s.
export function useAgenda(activo) {
  const [datos, setDatos] = useState({ configurado: false, eventos: [] })
  const [error, setError] = useState(null)
  const [ahora, setAhora] = useState(Date.now())

  const cargar = useCallback(async () => {
    try {
      const r = await llamarTodoist('agenda')
      setDatos({ configurado: !!r.configurado, eventos: r.eventos ?? [] })
      setError(null)
    } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => {
    if (!activo) return
    cargar()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') cargar() }, 5 * 60 * 1000)
    const tic = setInterval(() => setAhora(Date.now()), 30 * 1000)
    return () => { clearInterval(iv); clearInterval(tic) }
  }, [activo, cargar])

  const vigentes = datos.eventos.filter(e => new Date(e.fin).getTime() > ahora)
  const enCurso = vigentes.find(e => new Date(e.inicio).getTime() <= ahora) ?? null
  const proximo = vigentes.find(e => new Date(e.inicio).getTime() > ahora) ?? null
  const minutosHasta = (e) => (e ? Math.max(0, Math.round((new Date(e.inicio).getTime() - ahora) / 60000)) : null)

  return {
    configurado: datos.configurado, eventos: vigentes, enCurso, proximo, error,
    // Minutos libres antes del próximo evento (null = no hay nada en las próximas horas)
    ventana: proximo ? minutosHasta(proximo) : null,
    minutosHasta, recargar: cargar,
  }
}

export const horaCorta = (iso) => new Date(iso).toLocaleTimeString('es-CR', {
  timeZone: 'America/Costa_Rica', hour: 'numeric', minute: '2-digit', hour12: true,
}).replace(/\s?a\.\s?m\./i, ' am').replace(/\s?p\.\s?m\./i, ' pm')

export function textoEnMinutos(min) {
  if (min < 60) return `en ${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return `en ${h} h${m ? ` ${m} min` : ''}`
}
