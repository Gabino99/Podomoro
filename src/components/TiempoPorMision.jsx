import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const fmt = (min) => {
  const h = Math.floor(min / 60), m = min % 60
  return h ? `${h} h ${m ? `${m} min` : ''}`.trim() : `${m} min`
}

// Tiempo dedicado a cada misión y proyecto. Solo cuenta sesiones de trabajo
// hechas con una misión en foco (desde que existe la columna task_id).
export default function TiempoPorMision({ userId }) {
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState(null)
  const [vista, setVista] = useState('mision')

  useEffect(() => {
    if (!userId) return
    let vivo = true
    supabase
      .from('sesiones')
      .select('task_id, mision, proyecto, proyecto_id, duracion_minutos, created_at')
      .eq('user_id', userId)
      .eq('tipo', 'trabajo')
      .eq('completada', true)
      .not('task_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5000)
      .then(({ data, error: e }) => {
        if (!vivo) return
        if (e) setError(e.message)
        else setFilas(data || [])
      })
    return () => { vivo = false }
  }, [userId])

  const grupos = useMemo(() => {
    const m = new Map()
    for (const s of filas || []) {
      const clave = vista === 'mision' ? s.task_id : (s.proyecto_id || s.proyecto || 'inbox')
      const g = m.get(clave) || {
        clave, minutos: 0, sesiones: 0, ultima: s.created_at,
        nombre: vista === 'mision' ? (s.mision || 'Sin nombre') : (s.proyecto || 'Inbox'),
        proyecto: s.proyecto || 'Inbox',
      }
      g.minutos += s.duracion_minutos
      g.sesiones += 1
      m.set(clave, g)
    }
    return [...m.values()].sort((a, b) => b.minutos - a.minutos)
  }, [filas, vista])

  const total = grupos.reduce((a, g) => a + g.minutos, 0)

  return (
    <div className="stats-panel">
      <div className="stats-tab-row">
        <button className={`stats-tab-btn ${vista === 'mision' ? 'active' : ''}`} onClick={() => setVista('mision')}>Por misión</button>
        <button className={`stats-tab-btn ${vista === 'proyecto' ? 'active' : ''}`} onClick={() => setVista('proyecto')}>Por proyecto</button>
      </div>
      <p className="stats-panel-title">
        Tiempo dedicado{filas ? ` · ${fmt(total)} en total` : ''}
      </p>
      {error && <p className="stats-empty">No se pudo cargar: {error}</p>}
      {!error && filas === null && <p className="stats-hint">Cargando…</p>}
      {!error && filas && grupos.length === 0 && (
        <p className="stats-empty">Aún no hay tiempo ligado a misiones. Use «Enfocar» en una misión y aparecerá aquí.</p>
      )}
      {grupos.map(g => (
        <div key={g.clave} style={{ margin: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {g.nombre}{vista === 'mision' && <small style={{ opacity: .55 }}> · {g.proyecto}</small>}
            </span>
            <b style={{ whiteSpace: 'nowrap' }}>{fmt(g.minutos)}</b>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#1a1a1a', marginTop: 4 }}>
            <div style={{ height: '100%', borderRadius: 3, background: '#f59e0b', width: `${Math.max(3, (g.minutos / (grupos[0].minutos || 1)) * 100)}%` }} />
          </div>
          <small style={{ opacity: .55 }}>{g.sesiones} {g.sesiones === 1 ? 'sesión' : 'sesiones'}</small>
        </div>
      ))}
      <p className="stats-hint">Solo cuenta sesiones hechas con una misión en foco, desde esta función.</p>
    </div>
  )
}
