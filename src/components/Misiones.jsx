import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { fechaCR } from '../lib/fechas'
import { getVolume } from '../lib/sounds'
import {
  llamarTodoist, ordenar, esJefe, puntosDe, cuandoTexto, opcionesPosponer,
} from '../lib/todoist'
import { supabase } from '../lib/supabase'
import { recomendar, afinidad } from '../lib/juego'

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

export default function Misiones({ puntos, setPuntos, onEnfocar, juego, refrescarJuego, celebrar, celebrarResultado }) {
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
  const [detalles, setDetalles]   = useState({})        // id -> { contexto, reprogramadas, zombi, subtareas }
  const [ctxTexto, setCtxTexto]   = useState('')
  const [ctxEstado, setCtxEstado] = useState('')        // '' | 'guardando' | 'guardado'
  const [pasosTexto, setPasosTexto] = useState('')
  const [jefe, setJefe]           = useState(null)      // { proyecto_id, nombre, hp, hp_max }
  const [candidatos, setCandidatos] = useState([])
  const [cargandoJefe, setCargandoJefe] = useState(true)
  const [cobrando, setCobrando]   = useState(null)
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
      if (d.vaciado?.nuevo) { celebrar?.('🌴 ¡Tablero vacío! No quedan misiones para hoy.', 'grande'); celebrarResultado?.(d.vaciado) }
      setProyectos(Object.fromEntries(d.proyectos.map(p => [p.id, p.nombre])))
      setError(null)
    } catch (e) {
      if (!silencioso) setError(e.message)
    }
    setCargando(false)
  }, [celebrar, celebrarResultado])

  // Puntos por lo que completó fuera de la app (app de Todoist, coach…).
  // El cron del servidor lo hace cada 10 min; aquí se adelanta al abrir la pestaña.
  const ultimaSync = useRef(0)
  const sincronizar = useCallback(async () => {
    if (Date.now() - ultimaSync.current < 2 * 60 * 1000) return
    ultimaSync.current = Date.now()
    try {
      const r = await llamarTodoist('sync')
      if (r?.nuevas > 0) {
        if (typeof r.puntos_totales === 'number') setPuntos(r.puntos_totales)
        mostrarAviso(`+${r.puntos_ganados} pts por ${r.nuevas} misión${r.nuevas > 1 ? 'es' : ''} hecha${r.nuevas > 1 ? 's' : ''} fuera de la app 🎉`)
        celebrarResultado?.(r)
        refrescarJuego?.()
      }
    } catch { /* silencioso: el cron lo reintenta */ }
  }, [setPuntos, mostrarAviso, celebrarResultado, refrescarJuego])

  // ── Jefe de proyecto: vida = tareas activas no repetitivas del proyecto ──
  const cargarJefe = useCallback(async (opciones = {}) => {
    try {
      const r = await llamarTodoist('jefe', opciones)
      if (r.derrota?.exito) {
        celebrar?.(`🐉 ¡Derrotó al jefe ${r.derrota.nombre}! +${r.derrota.premio} pts`, 'grande')
        if (typeof r.derrota.puntos_totales === 'number') setPuntos(r.derrota.puntos_totales)
        celebrarResultado?.(r.derrota)
        refrescarJuego?.()
      }
      setJefe(r.jefe); setCandidatos(r.candidatos ?? [])
    } catch { /* el jefe es opcional */ }
    setCargandoJefe(false)
  }, [celebrar, celebrarResultado, refrescarJuego, setPuntos])
  useEffect(() => { cargarJefe() }, [cargarJefe])

  const cambiarJefe = () => {
    if (!candidatos.length) return
    const i = candidatos.findIndex(c => c.id === jefe?.proyecto_id)
    const sig = candidatos[(i + 1) % candidatos.length]
    setCargandoJefe(true)
    cargarJefe({ cambiar: true, proyecto_id: sig.id })
  }

  // ── Retos de hoy: el servidor revisa que de verdad se cumplieron ──
  const cobrarReto = async (reto) => {
    if (cobrando) return
    setCobrando(reto.id)
    const { data, error } = await supabase.rpc('cobrar_reto', { p_reto: reto.id })
    setCobrando(null)
    if (error) { setError('No se pudo cobrar el reto: ' + error.message); return }
    if (!data?.exito) { mostrarAviso(data?.mensaje || 'Todavía no lo cumple.'); return }
    if (typeof data.puntos_totales === 'number') setPuntos(data.puntos_totales)
    celebrar?.(`🏆 Reto cumplido: ${reto.nombre} +${data.premio}`, 'cofre')
    celebrarResultado?.(data)
    refrescarJuego?.()
  }

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => {
    sincronizar()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') sincronizar() }, 60000)
    return () => clearInterval(iv)
  }, [sincronizar])
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
    const elegida = lista.find(t => t.id === actualId)
    if (elegida) return elegida
    const libres = lista.filter(t => !saltadas.has(t.id))
    return recomendar(libres.length ? libres : lista, juego?.energia) || null
  }, [lista, actualId, saltadas, juego?.energia])
  const esRecomendada = !!(actual && juego?.energia && juego.energia !== 'media' && afinidad(actual, juego.energia) > 0)

  // ── Detalle de la misión actual: contexto, veces pospuesta (zombi) y pasos ──
  const det = actual ? detalles[actual.id] : null
  const zombiDe = (t) => !!detalles[t.id]?.zombi
  useEffect(() => {
    if (!actual) return
    setMenu(m => (m === 'zombi' || m === 'partir') ? null : m)
    setCtxTexto(detalles[actual.id]?.contexto ?? ''); setCtxEstado(''); setPasosTexto('')
    if (detalles[actual.id]) return
    let vivo = true
    llamarTodoist('detalle', { id: actual.id })
      .then(d => { if (vivo) { setDetalles(p => ({ ...p, [actual.id]: d })); setCtxTexto(t => t || d.contexto || '') } })
      .catch(() => { /* el detalle es opcional */ })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actual?.id])

  const guardarContexto = async () => {
    if (!actual || !ctxTexto.trim() || ctxEstado === 'guardando') return
    const id = actual.id
    setCtxEstado('guardando')
    try {
      await llamarTodoist('contexto', { id, texto: ctxTexto })
      setDetalles(p => ({ ...p, [id]: { ...(p[id] || {}), contexto: ctxTexto.trim() } }))
      setCtxEstado('guardado')
    } catch (e) { setCtxEstado(''); setError(e.message) }
  }

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
    const estimado = puntosDe(t, hoy, zombiDe(t))
    quitar(t)
    sonar('hecho')
    setFlotante(`+${estimado}`); setTimeout(() => setFlotante(null), 1200)
    mostrarAviso(ANIMOS[Math.floor(Math.random() * ANIMOS.length)])
    const r = await ejecutar(t, 'complete', { esperado: t.due?.date || null })
    if (!r) return
    if (r.ok === false && r.motivo === 'ya_completada') { mostrarAviso('Esa ya estaba completada en Todoist.'); return }
    if (typeof r.puntos_totales === 'number') setPuntos(r.puntos_totales)
    if (r.error_puntos) setError('Se completó en Todoist, pero no se pudieron sumar los puntos: ' + r.error_puntos)
    celebrarResultado?.(r)
    refrescarJuego?.()
    if (jefe && t.proyecto_id === jefe.proyecto_id) cargarJefe()
  }, [ejecutar, hoy, mostrarAviso, setPuntos, detalles, celebrarResultado, refrescarJuego, jefe, cargarJefe])

  // Posponer: si es zombi (3+ veces) y no tiene pasos, primero hay que partirla o soltarla.
  const abrirPosponer = useCallback(() => {
    if (!actual) return
    const d = detalles[actual.id]
    if (d?.zombi && !d.subtareas) setMenu(m => m === 'zombi' ? null : 'zombi')
    else setMenu(m => m === 'posponer' ? null : 'posponer')
  }, [actual, detalles])

  const partir = useCallback(async (t) => {
    const pasos = pasosTexto.split('\n').map(s => s.trim()).filter(Boolean)
    if (!t || pasos.length < 2 || enCurso.current.has(t.id)) { mostrarAviso('Escriba al menos 2 pasos, uno por línea.'); return }
    setMenu(null); setPasosTexto('')
    const r = await ejecutar(t, 'partir', { pasos })
    if (!r?.creadas) return
    setTareas(prev => [...prev, ...r.creadas.filter(c => !prev.some(z => z.id === c.id))])
    setDetalles(p => ({ ...p, [t.id]: { ...(p[t.id] || {}), subtareas: (p[t.id]?.subtareas || 0) + r.creadas.length } }))
    setActualId(r.creadas[0].id)
    mostrarAviso(`🧩 Partida en ${r.creadas.length} pasos. Empiece por el primero.`)
  }, [ejecutar, mostrarAviso, pasosTexto])

  const soltar = useCallback(async (t) => {
    if (!t || enCurso.current.has(t.id)) return
    quitar(t)
    mostrarAviso('🗑️ Soltada: P4, 🗑️ Superflua y fuera de su vista por 30 días.')
    await ejecutar(t, 'soltar')
  }, [ejecutar, mostrarAviso])

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
      else if (k === 'p' && actual) abrirPosponer()
      else if (k === 's') saltar()
      else if (k === 'd' && actual) setMenu(m => m === 'borrar' ? null : 'borrar')
      else if (k === 'f' && actual && onEnfocar) onEnfocar({ ...actual, proyecto: proyectos[actual.proyecto_id] || null, zombi: zombiDe(actual) })
      else if (k === 'escape') setMenu(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [actual, completar, saltar, abrirPosponer, onEnfocar, proyectos, detalles])

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

      <div className={`mis-layout ${juego ? 'con-lateral' : ''}`}>
        {juego && (
          <aside className="mis-lateral">
            <div className="lat-bloque">
              <div className="lat-titulo">🏆 Retos de hoy</div>
              {(juego.retos ?? []).map(reto => (
                <div key={reto.id} className={`reto ${reto.cobrado ? 'cobrado' : ''}`}>
                  <div className="reto-nombre">{reto.cobrado ? '✅' : '🎯'} {reto.nombre}</div>
                  <div className="reto-barra"><div style={{ width: `${Math.round((reto.progreso / reto.meta) * 100)}%` }} /></div>
                  <div className="reto-pie">
                    <span>{reto.progreso} / {reto.meta}</span>
                    {reto.cobrado
                      ? <span className="reto-ok">Cobrado</span>
                      : reto.progreso >= reto.meta
                        ? <button className="reto-cobrar" onClick={() => cobrarReto(reto)} disabled={cobrando === reto.id}>¡Cobrar! +{reto.premio}</button>
                        : <span className="reto-premio">+{reto.premio} pts</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="lat-bloque">
              <div className="lat-titulo">🐉 Jefe de proyecto</div>
              {cargandoJefe ? <div className="jefe-vacio">Cargando vida…</div>
                : !jefe ? <div className="jefe-vacio">No hay proyectos con tareas pendientes. 🌴</div>
                : (
                  <div className="jefe">
                    <div className="jefe-monstruo" aria-hidden>{jefe.hp_max >= 10 ? '🐉' : jefe.hp_max >= 5 ? '👹' : '👾'}</div>
                    <div className="jefe-nombre">{jefe.nombre}</div>
                    <div className="jefe-vida" title={`${jefe.hp} de ${jefe.hp_max} tareas`}>
                      <div style={{ width: `${Math.round((jefe.hp / Math.max(1, jefe.hp_max)) * 100)}%` }} />
                      <span>❤️ {jefe.hp} / {jefe.hp_max}</span>
                    </div>
                    <div className="jefe-pista">Vacíe el proyecto para derrotarlo: +200</div>
                    {candidatos.length > 1 && <button className="jefe-cambiar" onClick={cambiarJefe}>🔄 Cambiar de jefe</button>}
                  </div>
                )}
            </div>

            <div className="lat-bloque lat-atajos">
              <div className="lat-titulo">⌨️ Atajos</div>
              <div><kbd>C</kbd> completar · <kbd>P</kbd> posponer · <kbd>S</kbd> saltar</div>
              <div><kbd>D</kbd> eliminar · <kbd>F</kbd> modo enfoque</div>
              <div className="lat-glosario">
                👹 <b>Jefe:</b> vencida de días anteriores, ×1.5.<br />
                ⚡ <b>Combo:</b> otra misión antes de 45 min sube ×0.5 (hasta ×3).<br />
                🧟 <b>Zombi:</b> pospuesta 3+ veces; partirla o soltarla. ×1.5.<br />
                🎁 <b>Cofres:</b> cada misión puede soltar uno (32 %).
              </div>
            </div>
          </aside>
        )}
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
                {det?.zombi && <span className="mis-tag zombi" title="Pospuesta 3 veces o más: terminarla vale x1.5">🧟 ZOMBI ×{det.reprogramadas}</span>}
                {esRecomendada && <span className="mis-tag reco" title={`Va con su energía ${juego.energia}`}>⭐ RECOMENDADA</span>}
                <span className="mis-tag pts">+{puntosDe(actual, hoy, det?.zombi)} pts</span>
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

              <div className="mis-contexto">
                <div className="mis-contexto-titulo">
                  🧠 Contexto
                  {ctxEstado === 'guardado' && <span>✓ guardado en Todoist</span>}
                  {ctxEstado === 'guardando' && <span>guardando…</span>}
                </div>
                <textarea
                  value={ctxTexto}
                  onChange={e => { setCtxTexto(e.target.value); setCtxEstado('') }}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) guardarContexto() }}
                  placeholder="¿Dónde se quedó? ¿Qué falta? ¿Qué necesita para arrancar?"
                  maxLength={2000} rows={2} />
                <div className="mis-contexto-fila">
                  <button onClick={guardarContexto} disabled={!ctxTexto.trim() || ctxEstado === 'guardando' || ctxTexto.trim() === (det?.contexto ?? '')}>💾 Guardar</button>
                </div>
              </div>

              {menu === 'zombi' && (
                <div className="mis-menu zombi">
                  <div className="mis-menu-titulo">🧟 Esta tarea ya se pospuso {det?.reprogramadas} veces</div>
                  <div className="mis-menu-aviso">
                    Para moverla otra vez, pártala en pasos más pequeños o suéltela.
                    Si la termina hoy, vale ×1.5.
                  </div>
                  <div className="mis-menu-fila">
                    <button onClick={() => setMenu('partir')}>🧩 Partir en pasos</button>
                    <button onClick={() => soltar(actual)}>🗑️ Soltarla (P4, 30 días)</button>
                    <button onClick={() => setMenu(null)}>✕</button>
                  </div>
                </div>
              )}
              {menu === 'partir' && (
                <div className="mis-menu">
                  <div className="mis-menu-titulo">🧩 Un paso por línea (quedan para hoy)</div>
                  <textarea className="mis-pasos" value={pasosTexto} onChange={e => setPasosTexto(e.target.value)} rows={4}
                    placeholder={'Abrir el documento\nEscribir el primer párrafo\nEnviarlo'} autoFocus />
                  <div className="mis-menu-fila derecha">
                    <button onClick={() => setMenu(null)}>Cancelar</button>
                    <button onClick={() => partir(actual)} disabled={pasosTexto.split('\n').filter(s => s.trim()).length < 2}>Crear pasos</button>
                  </div>
                </div>
              )}

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
                <button className="mis-btn posponer" onClick={abrirPosponer}>⏰ Posponer<small>tecla P</small></button>
                <button className="mis-btn saltar" onClick={saltar}>⏭️ Saltar<small>tecla S</small></button>
                <button className="mis-btn borrar" onClick={() => setMenu(m => m === 'borrar' ? null : 'borrar')}>🗑️ Eliminar<small>tecla D</small></button>
              </div>
              <div className="mis-acciones2">
                {onEnfocar && (
                  <button onClick={() => onEnfocar({ ...actual, proyecto: proyectos[actual.proyecto_id] || null, zombi: !!det?.zombi })}>
                    🎯 Modo enfoque <small>F</small>
                  </button>
                )}
                <button onClick={() => setMenu(m => m === 'partir' ? null : 'partir')}>🧩 Partir en pasos</button>
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
                <div className="mis-item-pts">+{puntosDe(t, hoy, zombiDe(t))}</div>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {aviso && <div className="mis-aviso">{aviso}</div>}
    </div>
  )
}
