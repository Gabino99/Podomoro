import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

// Carga y administra las recompensas del usuario (las no archivadas).
export function useRecompensas(userId) {
  const [recompensas, setRecompensas] = useState([])
  const [cargando,    setCargando]    = useState(true)
  const [error,       setError]       = useState(null)

  const recargar = useCallback(async () => {
    if (!userId) return
    setCargando(true)
    const { data, error } = await supabase
      .from('recompensas')
      .select('*')
      .eq('user_id', userId)
      .eq('archivada', false)
      .order('costo', { ascending: true })
    if (error) setError('No se pudieron cargar las recompensas.')
    else { setRecompensas(data); setError(null) }
    setCargando(false)
  }, [userId])

  useEffect(() => { recargar() }, [recargar])

  const crear = async (campos) => {
    const filas = (Array.isArray(campos) ? campos : [campos]).map(c => ({ ...c, user_id: userId }))
    const { error } = await supabase.from('recompensas').insert(filas)
    if (error) return { ok: false, mensaje: 'No se pudo guardar la recompensa.' }
    await recargar()
    return { ok: true }
  }

  const actualizar = async (id, campos) => {
    const { error } = await supabase.from('recompensas').update(campos).eq('id', id)
    if (error) return { ok: false, mensaje: 'No se pudo guardar los cambios.' }
    await recargar()
    return { ok: true }
  }

  const borrar = async (id) => {
    const { error } = await supabase.from('recompensas').delete().eq('id', id)
    if (error) return { ok: false, mensaje: 'No se pudo borrar.' }
    setRecompensas(prev => prev.filter(r => r.id !== id))
    return { ok: true }
  }

  // El costo lo decide el servidor, no el navegador.
  const canjear = async (id) => {
    const { data, error } = await supabase.rpc('canjear_recompensa', { p_recompensa_id: id })
    if (error) return { ok: false, mensaje: 'Error al canjear. Intente de nuevo.' }
    if (!data?.exito) return { ok: false, mensaje: data?.mensaje || 'No se pudo canjear.' }
    await recargar()
    return { ok: true, puntosRestantes: data.puntos_restantes, nombre: data.nombre }
  }

  return { recompensas, cargando, error, recargar, crear, actualizar, borrar, canjear }
}

// La recompensa que más conviene mostrar como "próxima meta":
// la de fecha límite más cercana que aún no alcanza; si no hay, la más barata que falta.
export function proximaMeta(recompensas, puntos) {
  const faltan = recompensas.filter(r => r.costo > puntos)
  if (faltan.length === 0) return null
  const conFecha = faltan.filter(r => r.fecha_limite).sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite))
  if (conFecha.length) return conFecha[0]
  return [...faltan].sort((a, b) => a.costo - b.costo)[0]
}
