import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { fechaCR } from '../lib/fechas'
import { getVolume } from '../lib/sounds'
import {
  llamarTodoist, ordenar, esJefe, puntosDe, cuandoTexto, opcionesPosponer,
} from '../lib/todoist'

// Sonido corto de "misión cumplida" (respeta el volumen de la app).
function sonar(tipo = 'hecho') {
  const vol = getVolume()
  if (!vol) return
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const notas = tipo === 'hecho' ? [523, 659, 784, 1046] : [440, 370]
    notas.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = 'square'; o.frequency.value = f
      const t0 = ctx.currentTime + i * 0.08
      g.gain.setValueAtTime(0.06 * vol, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12)
      o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.13)
    })
  } catch { /* sin audio */ }
}

const ANIMOS = ['¡Eso es! Una menos 💥', '¡Qué nivel! 🔥', 'Misión cumplida 🏅', '¡Imparable! 🚀', 'Su yo del futuro le agradece 🙌', '¡Tuanis! Siga así 🎯']
const etiqueta = (l) => l.replace(/_/g, ' ')

export default function Misiones({ puntos, setPuntos }) {
  const [tareas, setTareas]       = useState([])
  const [proyectos, setProyectos] = useState({})
  const [cargando, setCargando]   = useState(true)
  const [error, setError]         = useState(null)
  const [filtro, setFiltro]       = useState('todas')
  const [actualId, setActualId]   = useState(null)
  const [saltadas, setSaltadas]   = useState(() => new Set())
  const [menu, setMenu]           = useState(null)      // null | 'posponer' | 'borrar'
  const [fechaManual, setFechaManual] = useState('')
  const [aviso, setAviso]         = useState(null)
  const [flotante, setFlotante]   = useState(null)
  const [pendientes, setPendientes] = useState(0)
  const enCurso = useRef(new Set())        // ids con una acción viajando a Todoist
  const ocultas = useRef(new Map())        // id -> ms: no mostrarlas aunque una recarga las traiga
  const avisoT = useRef(null)

  const hoy = fechaCR()

  const mostrarAviso = useCallback((texto) => {
    setAviso(texto)
    clearTimeout(avisoT.current)
    avisoT.current = setTimeout(() => setAviso(null), 3200)
  }, [])

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const d = await llamarTodoist('list')
      const limite = Date.now() - 5 * 60 * 1000
      for (const [id, ms] of ocultas.current) if (ms < limite && !enCurso.current.has(id)) ocultas.current.delete(id)
      setTareas(d.tareas.filter(t => !ocultas.current.has(t.id)))
      setProyectos(Object.fromEntries(d.proyectos.map(p => [p.id, p.nombre])))
      setError(null)
    } catch (e) {
      if (!silencioso) setError(e.message)
    }
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])
  // Refresca cada minuto mientras la pestaña está visible (por si completa algo en Todoist).
  useEffect(() => {
    const iv = setInterval(() => { if (document.visibilityState === 'visible') cargar(true) }, 60000)
    const alVolver = () => { if (document.visibilityState === 'visible') cargar(true) }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', alVolver) }
  }, [cargar])

  const lista = useMemo(() => ordenar(tareas, hoy).filter(t =>
    filtro === 'todas' ? true : filtro === 'jefes' ? esJefe(t, hoy) : t.proyecto_id === filtro
  ), [tareas, filtro, hoy])

  const actual = useMemo(() => {
    return lista.find(t => t.id === actualId) || lista.find(t => !saltadas.has(t.id)) || lista[0] || null
  }, [lista, actualId, saltadas])

  // ── Acciones: la tarea se mueve en pantalla al instante y Todoist se actualiza por detrás ──
  const ejecutar = useCallback(async (t, accion, datos, alFallar) => {
    enCurso.current.add(t.id); setPendientes(enCurso.current.size)
    try {
      return await llamarTodoist(accion, { id: t.id, ...datos })
    } catch (e) {
      ocultas.current.delete(t.id)
      alFallar?.()
      setTareas(prev => prev.some(z => z.id === t.id) ? prev : [...prev, t])
      setError(`${e.message} Se la devolví al tablero: "${t.contenido}".`)
      return null
    } finally {
      enCurso.current.delete(t.id); setPendientes(enCurso.current.size)
    }
  }, [])

  const quitar = (t) => {
    ocultas.current.set(t.id, Date.now())
    setTareas(prev => prev.filter(z => z.id !== t.id))
    setActualId(null); setMenu(null)
  }

  const completar = useCallback(async (t) => {
    if (!t || enCurso.current.has(t.id)) return
    const estimado = puntosDe(t, hoy)
    quitar(t)
    sonar('hecho')
    setFlotante(`+${estimado}`); setTimeout(() => setFlotante(null), 1200)
    mostrarAviso(ANIMOS[Math.floor(Math.random() * ANIMOS.length)])
    const r = await ejecutar(t, 'complete', { esperado: t.due?.date || null })
    if (!r) return
    if (r.ok === false && r.motivo === 'ya_completada') { mostrarAviso('Esa ya estaba completada en Todoist.'); return }
    if (typeof r.puntos_totales === 'number') setPuntos(r.puntos_totales)
    if (r.error_puntos) setError('Se completó en Todoist, pero no se pudieron sumar los puntos: ' + r.error_puntos)
  }, [ejecutar, hoy, mostrarAviso, setPuntos])

  const posponer = useCallback(async (t, fecha, texto) => {
    if (!t || enCurso.current.has(t.id) || !fecha) return
    if (fecha.slice(0, 10) > hoy) quitar(t)
    else {
      setTareas(prev => prev.map(z => z.id === t.id ? { ...z, due: { ...(z.due || {}), date: fecha.length > 10 ? fecha + ':00' : fecha } } : z))
      setActualId(null); setMenu(null)
    }
    sonar('mover')
    mostrarAviso(`${texto}: movida en Todoist 👍`)
    await ejecutar(t, 'postpone', { fecha }, () => setTareas(prev => prev.map(z => z.id === t.id ? t : z)))
  }, [ejecutar, hoy, mostrarAviso])

  const borrar = useCallback(async (t) => {
    if (!t || enCurso.current.has(t.id)) return
    quitar(t)
    mostrarAviso('🗑️ Eliminada de Todoist. Menos ruido, más foco.')
    await ejecutar(t, 'delete')
  }, [ejecutar, mostrarAviso])

  const saltar = useCallback(() => {
    if (!actual) return
    const nuevas = new Set(saltadas); nuevas.add(actual.id)
    const i = lista.findIndex(z => z.id === actual.id)
    const sig = [...lista.slice(i + 1), ...lista.slice(0, i)].find(z => !nuevas.has(z.id))
    if (!sig) { setSaltadas(new Set()); setActualId(lista[(i + 1) % lista.length]?.id ?? null) }
    else { setSaltadas(nuevas); setActualId(sig.id) }
    setMenu(null)
  }, [actual, lista, saltadas])

  // Atajos de teclado: C completar · P posponer · S saltar · D eliminar · Esc cerrar
  useEffect(() => {
    const h = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'c' && actual) completar(actual)
      else if (k === 'p' && actual) setMenu(m => m === 'posponer' ? null : 'posponer')
      else if (k === 's') saltar()
      else if (k === 'd' && actual) setMenu(m => m === 'borrar' ? null : 'borrar')
      else if (k === 'escape') setMenu(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [actual, completar, saltar])

  // ── Vista ──
  const conteoProy = useMemo(() => {
    const c = {}; tareas.forEach(t => { c[t.proyecto_id] = (c[t.proyecto_id] || 0) + 1 }); return c
  }, [tareas])
  const jefes = tareas.filter(t => esJefe(t, hoy)).length

  if (cargando) return <div className="misiones-container"><div className="mis-vacio">Cargando misiones de Todoist…</div></div>

  return (
    <div className="misiones-container">
      {error && (
        <div className="error-message">{error}
          <button className="btn-ghost small" onClick={() => setError(null)}>✕</button>
          <button className="btn-ghost small" onClick={() => cargar()}>Reintentar</button>
        </div>
      )}
      {pendientes > 0 && <div className="mis-sync">⏳ Guardando {pendientes} en Todoist…</div>}

      <div className="mis-layout">
        <section className={`mis-card ${actual && esJefe(actual, hoy) ? 'jefe' : ''}`}>
          {!actual ? (
            <div className="mis-vacio">
              <div className="mis-vacio-icono">{tareas.length ? '🧭' : '🏆'}</div>
              {tareas.length ? 'No hay misiones en este filtro.' : '¡Tablero limpio! No quedan misiones para hoy.'}
            </div>
          ) : (
            <>
              <div className="mis-tags">
                {esJefe(actual, hoy) ? <span className="mis-tag jefe">👹 JEFE VENCIDO</span> : <span className="mis-tag">⚔️ MISIÓN</span>}
                {actual.prioridad < 4 && <span className={`mis-tag p${actual.prioridad}`}>P{actual.prioridad}</span>}
                {actual.due?.recurrente && <span className="mis-tag">🔁 HÁBITO</span>}
                <span className="mis-tag pts">+{puntosDe(actual, hoy)} pts</span>
              </div>
              <h2 className="mis-titulo">{actual.contenido}</h2>
              <div className="mis-meta">
                <span>📅 {cuandoTexto(actual, hoy)}</span>
                <span>{proyectos[actual.proyecto_id] || 'Inbox'}</span>
                {actual.duracion && <span>⏱️ {actual.duracion} min</span>}
              </div>
              {actual.etiquetas.length > 0 && (
                <div className="mis-etiquetas">{actual.etiquetas.map(l => <span key={l}>{etiqueta(l)}</span>)}</div>
              )}
              {actual.descripcion && <div className="mis-desc">{actual.descripcion}</div>}

              {menu === 'posponer' && (
                <div className="mis-menu">
                  <div className="mis-menu-titulo">¿Para cuándo?</div>
                  <div className="mis-menu-opciones">
                    {opcionesPosponer().map(([texto, fecha]) => (
                      <button key={texto} onClick={() => posponer(actual, fecha, texto)}>{texto}</button>
                    ))}
                  </div>
                  <div className="mis-menu-fila">
                    <input type="date" min={hoy} value={fechaManual} onChange={e => setFechaManual(e.target.value)} />
                    <button onClick={() => fechaManual && posponer(actual, fechaManual, `📆 ${fechaManual}`)}>Mover</button>
                    <button onClick={() => setMenu(null)}>✕</button>
                  </div>
                </div>
              )}
              {menu === 'borrar' && (
                <div className="mis-menu borrar">
                  <div>¿Eliminar "{actual.contenido}" de Todoist?</div>
                  <div className="mis-menu-aviso">
                    {actual.due?.recurrente ? 'Es un hábito repetitivo: se borra la serie completa. ' : ''}No se puede deshacer.
                  </div>
                  <div className="mis-menu-fila derecha">
                    <button onClick={() => setMenu(null)}>Cancelar</button>
                    <button className="peligro" onClick={() => borrar(actual)}>🗑️ Sí, eliminar</button>
                  </div>
                </div>
              )}

              <div className="mis-acciones">
                <button className="mis-btn hecho" onClick={() => completar(actual)}>✅ ¡Hecho!<small>tecla C</small></button>
                <button className="mis-btn posponer" onClick={() => setMenu(m => m === 'posponer' ? null : 'posponer')}>⏰ Posponer<small>tecla P</small></button>
                <button className="mis-btn saltar" onClick={saltar}>⏭️ Saltar<small>tecla S</small></button>
                <button className="mis-btn borrar" onClick={() => setMenu(m => m === 'borrar' ? null : 'borrar')}>🗑️ Eliminar<small>tecla D</small></button>
              </div>
            </>
          )}
          {flotante && <div className="mis-flotante">{flotante}</div>}
        </section>

        <aside className="mis-cola">
          <div className="mis-cola-titulo">
            Mapa de misiones <span>{lista.length}</span>
            <button className="btn-ghost small" onClick={() => cargar()} title="Actualizar">🔄</button>
          </div>
          <div className="mis-filtros">
            <button className={filtro === 'todas' ? 'on' : ''} onClick={() => { setFiltro('todas'); setActualId(null) }}>Todas ({tareas.length})</button>
            {jefes > 0 && <button className={filtro === 'jefes' ? 'on' : ''} onClick={() => { setFiltro('jefes'); setActualId(null) }}>👹 Jefes ({jefes})</button>}
            {Object.entries(conteoProy).map(([pid, n]) => (
              <button key={pid} className={filtro === pid ? 'on' : ''} onClick={() => { setFiltro(pid); setActualId(null) }}>
                {proyectos[pid] || 'Proyecto'} ({n})
              </button>
            ))}
          </div>
          <div className="mis-lista">
            {lista.length === 0 && <div className="mis-vacio">Nada por aquí 🌴</div>}
            {lista.map(t => (
              <button key={t.id}
                className={`mis-item ${actual?.id === t.id ? 'actual' : ''} ${esJefe(t, hoy) ? 'jefe' : ''}`}
                onClick={() => { setActualId(t.id); setMenu(null) }}>
                <div>
                  <div className="mis-item-nombre">{t.contenido}</div>
                  <div className="mis-item-meta">{esJefe(t, hoy) ? '👹 ' : ''}{cuandoTexto(t, hoy)} · {proyectos[t.proyecto_id] || ''}</div>
                </div>
                <div className="mis-item-pts">+{puntosDe(t, hoy)}</div>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {aviso && <div className="mis-aviso">{aviso}</div>}
    </div>
  )
}
