import React, { useState, useMemo } from 'react'
import { llamarTodoist, ordenar, puntosDe, esJefe, cuandoTexto } from '../lib/todoist'
import { fechaCR } from '../lib/fechas'

// Elegir en el Temporizador en qué misión de Todoist va a trabajar.
// Carga la lista solo cuando se abre (hoy + vencidas, el mismo orden que la pestaña Misiones).
export default function SelectorMision({ onElegir, reglas = null }) {
  const [abierto, setAbierto] = useState(false)
  const [tareas, setTareas] = useState(null)
  const [proyectos, setProyectos] = useState({})
  const [error, setError] = useState(null)
  const [buscar, setBuscar] = useState('')
  const hoy = fechaCR()

  const abrir = async () => {
    setAbierto(true); setError(null); setBuscar('')
    try {
      const d = await llamarTodoist('list')
      setTareas(d.tareas)
      setProyectos(Object.fromEntries(d.proyectos.map(p => [p.id, p.nombre])))
    } catch (e) { setError(e.message) }
  }

  const lista = useMemo(() => {
    if (!tareas) return []
    const q = buscar.trim().toLowerCase()
    return ordenar(tareas, hoy).filter(t => !q
      || t.contenido.toLowerCase().includes(q)
      || (proyectos[t.proyecto_id] || '').toLowerCase().includes(q))
  }, [tareas, buscar, proyectos, hoy])

  const elegir = (t) => {
    onElegir({ ...t, proyecto: proyectos[t.proyecto_id] || null })
    setAbierto(false)
  }

  if (!abierto) {
    return <button className="selector-abrir" onClick={abrir}>🎯 Elegir una misión de Todoist</button>
  }

  return (
    <div className="selector">
      <div className="selector-cabeza">
        <span>🎯 ¿En qué va a trabajar?</span>
        <button className="btn-ghost small" onClick={() => setAbierto(false)}>✕</button>
      </div>
      <input className="selector-buscar" value={buscar} onChange={e => setBuscar(e.target.value)}
        placeholder="Buscar por nombre o proyecto…" autoFocus />
      {error && <div className="selector-vacio">{error}</div>}
      {!error && !tareas && <div className="selector-vacio">Cargando misiones de Todoist…</div>}
      {tareas && lista.length === 0 && <div className="selector-vacio">{tareas.length ? 'Nada coincide con la búsqueda.' : '¡No tiene misiones para hoy! 🌴'}</div>}
      <div className="selector-lista">
        {lista.map(t => (
          <button key={t.id} className={`selector-item ${esJefe(t, hoy) ? 'jefe' : ''}`} onClick={() => elegir(t)}>
            <div className="selector-item-info">
              <div className="selector-item-nombre">{t.contenido}</div>
              <div className="selector-item-meta">
                {esJefe(t, hoy) ? '👹 ' : ''}{cuandoTexto(t, hoy)} · {proyectos[t.proyecto_id] || 'Inbox'}{t.duracion ? ` · ⏱️ ${t.duracion} min` : ''}
              </div>
            </div>
            <div className="selector-item-pts">+{puntosDe(t, hoy, false, reglas)}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
