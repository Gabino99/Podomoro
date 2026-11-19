import { supabase } from './supabase'
import { fechaCR } from './fechas'

// Llama a la Edge Function `todoist`. El token de Todoist nunca pasa por el navegador.
export async function llamarTodoist(action, datos = {}) {
  const { data, error } = await supabase.functions.invoke('todoist', { body: { action, ...datos } })
  if (error) {
    let mensaje = 'No se pudo hablar con Todoist. Revise la conexión.'
    try {
      const cuerpo = await error.context?.json?.()
      if (cuerpo?.error) mensaje = cuerpo.error
    } catch { /* respuesta sin JSON */ }
    if (/Failed to send|FunctionsFetchError/i.test(String(error.name || error.message))) {
      mensaje = 'La función de Todoist no responde. ¿Ya la desplegó en Supabase?'
    }
    throw new Error(mensaje)
  }
  if (data && data.ok === false && data.error) throw new Error(data.error)
  return data
}

// ── Utilidades de misiones ──
export const diaDe = (t) => (t.due?.date || '').slice(0, 10)
export const tieneHora = (t) => (t.due?.date || '').length > 10
export const esJefe = (t, hoy = fechaCR()) => !!diaDe(t) && diaDe(t) < hoy

// Bono de una misión según las reglas del usuario (las manda estado_juego). Vencida y zombi son
// totales, no extras; si aplican las dos vale el mayor; nunca menos que la base. Es lo que
// muestra la pantalla: el servidor calcula y otorga el valor real (el combo y el tope diario
// pueden cambiarlo). Mientras llegan las reglas se usan los valores iniciales.
const REGLAS_ESPERA = { mision_base: 5, mision_vencida: 10, mision_zombi: 10 }
export function puntosDe(t, hoy = fechaCR(), zombi = false, reglas = null) {
  const r = reglas ?? REGLAS_ESPERA
  return Math.max(r.mision_base, esJefe(t, hoy) ? r.mision_vencida : 0, zombi ? r.mision_zombi : 0)
}

export function hora12(hhmm) {
  let [h, m] = hhmm.split(':').map(Number)
  const ap = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}

export function cuandoTexto(t, hoy = fechaCR()) {
  if (!t.due) return 'Sin fecha'
  const d = diaDe(t)
  if (d < hoy) {
    const dias = Math.round((new Date(hoy + 'T12:00:00') - new Date(d + 'T12:00:00')) / 86400000)
    return `Vencida hace ${dias} día${dias > 1 ? 's' : ''}`
  }
  return tieneHora(t) ? `Hoy ${hora12(t.due.date.slice(11, 16))}` : 'Hoy'
}

export function ordenar(tareas, hoy = fechaCR()) {
  return [...tareas].sort((a, b) => {
    const ja = esJefe(a, hoy), jb = esJefe(b, hoy)
    if (ja !== jb) return ja ? -1 : 1
    if (diaDe(a) !== diaDe(b)) return diaDe(a) < diaDe(b) ? -1 : 1
    const ta = tieneHora(a) ? a.due.date : diaDe(a) + 'T99'
    const tb = tieneHora(b) ? b.due.date : diaDe(b) + 'T99'
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.prioridad - b.prioridad
  })
}

// Opciones de "Posponer". Las fechas van en hora local de Costa Rica.
const pad = (n) => String(n).padStart(2, '0')
const fechaHora = (d) => `${fechaCR(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
export function opcionesPosponer(ahora = new Date()) {
  const ops = []
  const redondear = (min) => { const d = new Date(ahora.getTime() + min * 60000); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); return d }
  ops.push(['⏰ +1 hora', fechaHora(redondear(60))])
  ops.push(['⏰ +2 horas', fechaHora(redondear(120))])
  if (ahora.getHours() < 19) { const d = new Date(ahora); d.setHours(19, 0, 0, 0); ops.push(['🌙 Hoy 7 pm', fechaHora(d)]) }
  if (ahora.getHours() < 21) { const d = new Date(ahora); d.setHours(21, 0, 0, 0); ops.push(['🌙 Hoy 9 pm', fechaHora(d)]) }
  const dia = (n) => { const d = new Date(ahora); d.setDate(d.getDate() + n); return fechaCR(d) }
  ops.push(['📅 Mañana', dia(1)])
  ops.push(['🏖️ Sábado', dia(((6 - ahora.getDay() + 7) % 7) || 7)])
  ops.push(['🗓️ Lunes', dia(((1 - ahora.getDay() + 7) % 7) || 7)])
  ops.push(['📆 En 1 semana', dia(7)])
  return ops
}
