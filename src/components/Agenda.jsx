import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { llamarTodoist, diaDe, tieneHora, esJefe, hora12 } from '../lib/todoist'
import { fechaCR } from '../lib/fechas'

// ═══════════════════════════════════════════════════════
//  Agenda del día: eventos de Google Calendar + misiones de Todoist
//  en bloques. Pensada para TDAH: muestra el tiempo como espacio
//  (línea de "ahora", huecos libres), dice qué toca ahora y qué sigue,
//  y permite meter tareas sueltas en bloques con un toque.
// ═══════════════════════════════════════════════════════

const CR = '-06:00'                       // Costa Rica: UTC-6 fijo
const PX_MIN = 1.3                        // alto en px de cada minuto
const DUR_DEFECTO = 30
const HUECO_MIN = 15                      // huecos más cortos no se muestran
const COLCHON = 5                         // min de respiro entre bloques al autoplanear
const DIAS_MAX = 6                        // Todoist: de hoy a +6 días

const pad = (n) => String(n).padStart(2, '0')
const inicioDia = (fecha) => Date.parse(`${fecha}T00:00:00${CR}`)
const msDeTarea = (date) => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(date) ? date : `${date.length === 16 ? date + ':00' : date}${CR}`)
// ms → "YYYY-MM-DDTHH:MM" en hora de Costa Rica
const localCR = (ms) => new Date(ms - 6 * 3600e3).toISOString().slice(0, 16)
const horaDeMs = (ms) => hora12(localCR(ms).slice(11, 16))
const sumarDias = (fecha, n) => { const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const redondear5 = (ms) => Math.ceil(ms / 300000) * 300000
const durTexto = (min) => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}`
const ICONO_PRIO = { 1: '🔴', 2: '🟠', 3: '🔵', 4: '⚪' }

function nombreDia(fecha, hoy) {
  if (fecha === hoy) return 'Hoy'
  if (fecha === sumarDias(hoy, 1)) return 'Mañana'
  return new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// Reparte bloques que se cruzan en columnas.
function enColumnas(bloques) {
  const orden = [...bloques].sort((a, b) => a.ini - b.ini || b.fin - a.fin)
  const out = []
  let grupo = [], finGrupo = -Infinity
  const cerrar = () => {
    const cols = []
    for (const b of grupo) {
      let c = cols.findIndex(f => f <= b.ini)
      if (c === -1) { c = cols.length; cols.push(0) }
      cols[c] = b.fin
      b.col = c
    }
    for (const b of grupo) { b.ncols = cols.length; out.push(b) }
    grupo = []
  }
  for (const b of orden) {
    if (grupo.length && b.ini >= finGrupo) { cerrar(); finGrupo = -Infinity }
    grupo.push({ ...b })
    finGrupo = Math.max(finGrupo, b.fin)
  }
  if (grupo.length) cerrar()
  return out
}

// Huecos libres entre bloques, desde `desde` hasta `hasta` (ms).
function huecosLibres(bloques, desde, hasta) {
  const orden = bloques.filter(b => b.fin > desde && b.ini < hasta).sort((a, b) => a.ini - b.ini)
  const out = []
  let cursor = desde
  for (const b of orden) {
    if (b.ini - cursor >= HUECO_MIN * 60000) out.push({ ini: cursor, fin: b.ini })
    cursor = Math.max(cursor, b.fin)
  }
  if (hasta - cursor >= HUECO_MIN * 60000) out.push({ ini: cursor, fin: hasta })
  return out
}

function leerPref(clave, def) { try { const v = localStorage.getItem(clave); return v == null ? def : JSON.parse(v) } catch { return def } }
function guardarPref(clave, v) { try { localStorage.setItem(clave, JSON.stringify(v)) } catch { /* sin almacenamiento */ } }

export default function Agenda({ activo, onEnfocar, onTerminar }) {
  const hoy = fechaCR()
  const [fecha, setFecha] = useState(hoy)
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [ahora, setAhora] = useState(Date.now())
  const [sel, setSel] = useState(null)            // bloque o tarea abierta
  const [colocando, setColocando] = useState(null) // hueco elegido para meter una tarea
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [jornada, setJornada] = useState(() => leerPref('agenda_jornada', { ini: 7, fin: 22 }))
  const [alertas, setAlertas] = useState(() => leerPref('agenda_alertas', false))
  const avisados = useRef(new Set())
  const lineaRef = useRef(null)
  const avisoT = useRef(null)

  const mostrar = (t) => { setAviso(t); clearTimeout(avisoT.current); avisoT.current = setTimeout(() => setAviso(null), 3500) }

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const d = await llamarTodoist('dia', { fecha })
      setDatos(d); setError(null)
    } catch (e) { if (!silencioso) setError(e.message) }
    setCargando(false)
  }, [fecha])

  useEffect(() => { if (activo) cargar() }, [activo, cargar])
  useEffect(() => {
    const tic = setInterval(() => setAhora(Date.now()), 30000)
    const iv = setInterval(() => { if (document.visibilityState === 'visible') cargar(true) }, 5 * 60000)
    return () => { clearInterval(tic); clearInterval(iv) }
  }, [cargar])
  useEffect(() => { guardarPref('agenda_jornada', jornada) }, [jornada])
  useEffect(() => { guardarPref('agenda_alertas', alertas) }, [alertas])

  const proyectos = useMemo(() => Object.fromEntries((datos?.proyectos ?? []).map(p => [p.id, p.nombre])), [datos])
  const base = inicioDia(fecha)
  const esHoy = fecha === hoy

  // ── Armar bloques ──
  const { bloques, todoDia, sueltas } = useMemo(() => {
    const bloques = [], todoDia = [], sueltas = []
    for (const e of datos?.calendario?.eventos ?? []) {
      if (e.todoDia) { todoDia.push(e); continue }
      const ini = Math.max(Date.parse(e.inicio), base), fin = Math.min(Date.parse(e.fin), base + 864e5)
      bloques.push({ key: 'e' + e.inicio + e.titulo, tipo: 'evento', titulo: e.titulo, ini, fin: Math.max(fin, ini + 10 * 60000) })
    }
    for (const t of datos?.tareas ?? []) {
      if (diaDe(t) === fecha && tieneHora(t)) {
        const ini = msDeTarea(t.due.date)
        bloques.push({ key: 't' + t.id, tipo: 'tarea', titulo: t.contenido, ini, fin: ini + (t.duracion || DUR_DEFECTO) * 60000, tarea: t, sinDur: !t.duracion })
      } else sueltas.push(t)
    }
    sueltas.sort((a, b) => (esJefe(b, hoy) - esJefe(a, hoy)) || a.prioridad - b.prioridad)
    return { bloques, todoDia, sueltas }
  }, [datos, fecha, base, hoy])

  const columnas = useMemo(() => enColumnas(bloques), [bloques])

  // Rango visible: la jornada, ampliada si hay bloques fuera de ella.
  const hIni = Math.min(jornada.ini, ...bloques.map(b => Math.floor((b.ini - base) / 3600e3)))
  const hFin = Math.max(jornada.fin, ...bloques.map(b => Math.ceil((b.fin - base) / 3600e3)))
  const top = (ms) => ((ms - base) / 60000 - hIni * 60) * PX_MIN

  const desdeLibre = esHoy ? Math.max(redondear5(ahora), base + jornada.ini * 3600e3) : base + jornada.ini * 3600e3
  const huecos = useMemo(() => huecosLibres(bloques, desdeLibre, base + jornada.fin * 3600e3), [bloques, desdeLibre, base, jornada])
  const minLibres = huecos.reduce((s, h) => s + (h.fin - h.ini) / 60000, 0)
  const minSueltas = sueltas.reduce((s, t) => s + (t.duracion || DUR_DEFECTO), 0)

  const vigentes = bloques.filter(b => b.fin > ahora).sort((a, b) => a.ini - b.ini)
  const enCurso = esHoy ? vigentes.filter(b => b.ini <= ahora) : []
  const siguiente = esHoy ? vigentes.find(b => b.ini > ahora) : null

  // Scroll a "ahora" al abrir.
  useEffect(() => {
    if (activo && esHoy && !cargando && lineaRef.current) lineaRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activo, esHoy, cargando])

  // ── Alertas 5 min antes de cada bloque ──
  useEffect(() => {
    if (!alertas || !esHoy) return
    for (const b of vigentes) {
      const faltan = (b.ini - ahora) / 60000
      if (faltan > 0 && faltan <= 5 && !avisados.current.has(b.key)) {
        avisados.current.add(b.key)
        const texto = `${b.tipo === 'evento' ? '📅' : '🎯'} En ${Math.ceil(faltan)} min: ${b.titulo}`
        mostrar(texto)
        try { if (Notification?.permission === 'granted') new Notification('FOCUS · Agenda', { body: texto, icon: '/favicon.svg' }) } catch { /* sin notificaciones */ }
      }
    }
  }, [ahora, alertas, esHoy, vigentes])

  const activarAlertas = async () => {
    if (alertas) { setAlertas(false); return }
    try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission() } catch { /* nada */ }
    setAlertas(true)
    mostrar('🔔 Le aviso 5 min antes de cada bloque')
  }

  // ── Acciones ──
  const programar = async (t, ms, dur) => {
    await llamarTodoist('programar', { id: t.id, fecha: localCR(ms), duracion: dur })
  }

  const meterEn = async (t, hueco) => {
    const dur = Math.min(t.duracion || DUR_DEFECTO, Math.round((hueco.fin - hueco.ini) / 60000))
    setOcupado(true)
    try {
      await programar(t, hueco.ini, dur)
      mostrar(`📌 "${t.contenido}" a las ${horaDeMs(hueco.ini)}`)
      setColocando(null); setSel(null)
      await cargar(true)
    } catch (e) { mostrar('⚠️ ' + e.message) }
    setOcupado(false)
  }

  // Siguiente hueco donde quepa la tarea completa (o el primero libre).
  const primerHueco = (t) => {
    const dur = (t.duracion || DUR_DEFECTO) * 60000
    return huecos.find(h => h.fin - h.ini >= dur) ?? huecos[0] ?? null
  }

  const autoplanear = async () => {
    if (!sueltas.length) return
    if (!window.confirm(`¿Acomodar ${sueltas.length} tarea${sueltas.length > 1 ? 's' : ''} en sus huecos libres, por prioridad? Le dejo ${COLCHON} min de respiro entre cada una.`)) return
    setOcupado(true)
    const libres = huecos.map(h => ({ ...h }))
    let puestas = 0, fuera = 0
    for (const t of sueltas) {
      const dur = (t.duracion || DUR_DEFECTO) * 60000
      const h = libres.find(x => x.fin - x.ini >= dur)
      if (!h) { fuera++; continue }
      try {
        await programar(t, h.ini, dur / 60000)
        h.ini = redondear5(h.ini + dur + COLCHON * 60000)
        puestas++
      } catch { fuera++ }
    }
    await cargar(true)
    setOcupado(false)
    mostrar(`🧩 ${puestas} acomodada${puestas === 1 ? '' : 's'}${fuera ? ` · ${fuera} no caben hoy` : ''}`)
  }

  const terminar = async (t) => {
    setOcupado(true)
    try {
      const r = await onTerminar?.(t)
      mostrar(r?.ok === false ? 'Ya estaba completada' : `✅ ¡Hecho! +${Math.round(r?.puntos_ganados ?? 0)} pts`)
      setSel(null)
      await cargar(true)
    } catch (e) { mostrar('⚠️ ' + e.message) }
    setOcupado(false)
  }

  const mover = async (t, hhmm, dur) => {
    if (!/^\d\d:\d\d$/.test(hhmm)) return
    setOcupado(true)
    try {
      await programar(t, Date.parse(`${fecha}T${hhmm}:00${CR}`), dur)
      mostrar(`⏰ Movida a las ${hora12(hhmm)}`)
      setSel(null)
      await cargar(true)
    } catch (e) { mostrar('⚠️ ' + e.message) }
    setOcupado(false)
  }

  const enfocar = (t) => onEnfocar?.({ ...t, proyecto: proyectos[t.proyecto_id] || null })

  // ── Render ──
  const horas = []
  for (let h = hIni; h <= hFin; h++) horas.push(h)
  const altoTotal = (hFin - hIni) * 60 * PX_MIN
  const fechaMax = sumarDias(hoy, DIAS_MAX)

  return (
    <div className="agenda">
      {/* Navegación de días */}
      <div className="ag-top">
        <div className="ag-nav">
          <button onClick={() => { setFecha(sumarDias(fecha, -1)); setSel(null) }} disabled={fecha <= hoy}>◀</button>
          <h2>{nombreDia(fecha, hoy)}</h2>
          <button onClick={() => { setFecha(sumarDias(fecha, 1)); setSel(null) }} disabled={fecha >= fechaMax}>▶</button>
          {!esHoy && <button className="ag-hoy" onClick={() => setFecha(hoy)}>Hoy</button>}
        </div>
        <div className="ag-tools">
          <button className={`ag-chip ${alertas ? 'on' : ''}`} onClick={activarAlertas} title="Aviso 5 min antes de cada bloque">
            {alertas ? '🔔 Avisos on' : '🔕 Avisos off'}
          </button>
          <button className="ag-chip" onClick={() => cargar()} title="Recargar">🔄</button>
        </div>
      </div>

      {aviso && <div className="ag-aviso">{aviso}</div>}
      {error && <div className="error-message">{error}</div>}

      {/* Ahora y siguiente: contra la ceguera temporal */}
      {esHoy && datos && (
        <div className="ag-ahora">
          {enCurso.length ? enCurso.map(b => {
            const pct = Math.min(100, ((ahora - b.ini) / (b.fin - b.ini)) * 100)
            const resta = Math.max(0, Math.round((b.fin - ahora) / 60000))
            return (
              <div key={b.key} className={`ag-ahora-card ${b.tipo}`}>
                <small>▶ AHORA</small>
                <b>{b.tipo === 'evento' ? '📅' : '🎯'} {b.titulo}</b>
                <div className="ag-barra"><div style={{ width: `${pct}%` }} /></div>
                <span>Quedan {durTexto(resta)} · termina {horaDeMs(b.fin)}</span>
                {b.tarea && (
                  <div className="ag-acc">
                    <button onClick={() => enfocar(b.tarea)}>⏱️ Enfocar</button>
                    <button onClick={() => terminar(b.tarea)} disabled={ocupado}>✅ Hecho</button>
                  </div>
                )}
              </div>
            )
          }) : (
            <div className="ag-ahora-card libre">
              <small>▶ AHORA</small>
              <b>🟢 Tiempo libre{siguiente ? ` por ${durTexto(Math.round((siguiente.ini - ahora) / 60000))}` : ''}</b>
              {sueltas.length > 0 && (
                <div className="ag-acc">
                  <button onClick={() => enfocar(sueltas[0])}>⏱️ Enfocar: {sueltas[0].contenido.slice(0, 40)}</button>
                </div>
              )}
            </div>
          )}
          {siguiente && (
            <div className={`ag-ahora-card sig ${(siguiente.ini - ahora) <= 15 * 60000 ? 'pronto' : ''}`}>
              <small>⏭ SIGUE {horaDeMs(siguiente.ini)}</small>
              <b>{siguiente.tipo === 'evento' ? '📅' : '🎯'} {siguiente.titulo}</b>
              <span>en {durTexto(Math.max(0, Math.round((siguiente.ini - ahora) / 60000)))}</span>
            </div>
          )}
        </div>
      )}

      {/* Resumen del día */}
      {datos && (
        <div className="ag-resumen">
          <span>📦 {bloques.length} bloque{bloques.length === 1 ? '' : 's'}</span>
          <span>🟢 {durTexto(Math.round(minLibres))} libres{esHoy ? ' desde ya' : ''}</span>
          {sueltas.length > 0 && (
            <span className={minSueltas > minLibres ? 'malo' : ''}>
              🧺 {sueltas.length} sin hora ({durTexto(minSueltas)}){minSueltas > minLibres ? ' · ¡no caben!' : ''}
            </span>
          )}
          {datos.calendario && !datos.calendario.configurado && <span className="tenue">Google Calendar no conectado</span>}
          {datos.calendario?.error && <span className="malo">📅 {datos.calendario.error}</span>}
        </div>
      )}

      {todoDia.length > 0 && (
        <div className="ag-todo-dia">{todoDia.map(e => <span key={e.titulo + e.inicio}>📌 {e.titulo}</span>)}</div>
      )}

      <div className="ag-cuerpo">
        {/* Línea de tiempo */}
        <div className="ag-linea" style={{ height: altoTotal }}>
          {horas.map(h => (
            <div key={h} className="ag-hora" style={{ top: (h - hIni) * 60 * PX_MIN }}>
              <span>{hora12(`${pad(h % 24)}:00`)}</span>
            </div>
          ))}

          {huecos.map(h => {
            const min = Math.round((h.fin - h.ini) / 60000)
            const alto = (h.fin - h.ini) / 60000 * PX_MIN
            return (
              <button key={'h' + h.ini} className={`ag-hueco ${colocando?.ini === h.ini ? 'activo' : ''}`}
                style={{ top: top(h.ini), height: alto }}
                onClick={() => { setColocando(colocando?.ini === h.ini ? null : h); setSel(null) }}
                title="Toque para meter una tarea aquí">
                {alto >= 22 && <span>＋ Libre {durTexto(min)}</span>}
              </button>
            )
          })}

          {columnas.map(b => {
            const pasado = esHoy && b.fin <= ahora
            const alto = Math.max(22, (b.fin - b.ini) / 60000 * PX_MIN - 2)
            return (
              <button key={b.key}
                className={`ag-bloque ${b.tipo} ${pasado ? 'pasado' : ''} ${b.tarea ? 'p' + b.tarea.prioridad : ''} ${sel?.key === b.key ? 'sel' : ''}`}
                style={{ top: top(b.ini) + 1, height: alto, left: `calc(${(b.col / b.ncols) * 100}% + 2px)`, width: `calc(${100 / b.ncols}% - 4px)` }}
                onClick={() => { setSel(sel?.key === b.key ? null : b); setColocando(null) }}>
                <b>{b.tipo === 'evento' ? '📅 ' : ''}{b.titulo}</b>
                {alto >= 36 && <small>{horaDeMs(b.ini)} – {horaDeMs(b.fin)}{b.sinDur ? ' (~30 min)' : ''}</small>}
              </button>
            )
          })}

          {esHoy && ahora >= base + hIni * 3600e3 && ahora <= base + hFin * 3600e3 && (
            <div className="ag-ahora-linea" ref={lineaRef} style={{ top: top(ahora) }}><span>{horaDeMs(ahora)}</span></div>
          )}
        </div>

        {/* Panel lateral: detalle, colocar o tareas sueltas */}
        <aside className="ag-lado">
          {sel && (
            <DetalleBloque b={sel} proyectos={proyectos} ocupado={ocupado}
              onCerrar={() => setSel(null)} onEnfocar={enfocar} onTerminar={terminar} onMover={mover} />
          )}

          {colocando && !sel && (
            <div className="ag-panel">
              <div className="ag-panel-tit">
                <b>＋ {horaDeMs(colocando.ini)} – {horaDeMs(colocando.fin)}</b>
                <button className="btn-ghost small" onClick={() => setColocando(null)}>✕</button>
              </div>
              <p className="tenue">¿Qué hace en este hueco de {durTexto(Math.round((colocando.fin - colocando.ini) / 60000))}?</p>
              {sueltas.length === 0 && <p className="tenue">No hay tareas sin hora. 🎉 Úselo para descansar.</p>}
              {sueltas.map(t => (
                <button key={t.id} className="ag-suelta" disabled={ocupado} onClick={() => meterEn(t, colocando)}>
                  {ICONO_PRIO[t.prioridad]} {t.contenido}
                  <small>{durTexto(t.duracion || DUR_DEFECTO)}</small>
                </button>
              ))}
            </div>
          )}

          {!sel && !colocando && (
            <div className="ag-panel">
              <div className="ag-panel-tit">
                <b>🧺 Sin hora ({sueltas.length})</b>
                {sueltas.length > 0 && huecos.length > 0 && (
                  <button className="ag-chip on" disabled={ocupado} onClick={autoplanear}>🧩 Autoplanear</button>
                )}
              </div>
              {cargando && !datos && <p className="tenue">Cargando…</p>}
              {datos && sueltas.length === 0 && <p className="tenue">Todo tiene su bloque. 💪</p>}
              {sueltas.map(t => {
                const h = primerHueco(t)
                return (
                  <div key={t.id} className={`ag-suelta-fila ${esJefe(t, hoy) ? 'vencida' : ''}`}>
                    <div className="ag-suelta-txt">
                      <span>{esJefe(t, hoy) ? '💀' : ICONO_PRIO[t.prioridad]} {t.contenido}</span>
                      <small>{proyectos[t.proyecto_id] || ''} · {durTexto(t.duracion || DUR_DEFECTO)}</small>
                    </div>
                    <div className="ag-suelta-acc">
                      {h && <button disabled={ocupado} onClick={() => meterEn(t, h)} title="Al siguiente hueco libre">📌 {horaDeMs(h.ini)}</button>}
                      {esHoy && <button onClick={() => enfocar(t)} title="Empezar ya en el Temporizador">⏱️</button>}
                    </div>
                  </div>
                )
              })}
              <div className="ag-jornada">
                <span>Mi jornada:</span>
                <select value={jornada.ini} onChange={e => setJornada(j => ({ ...j, ini: Math.min(+e.target.value, j.fin - 1) }))}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hora12(`${pad(h)}:00`)}</option>)}
                </select>
                <span>a</span>
                <select value={jornada.fin} onChange={e => setJornada(j => ({ ...j, fin: Math.max(+e.target.value, j.ini + 1) }))}>
                  {Array.from({ length: 24 }, (_, h) => h + 1).map(h => <option key={h} value={h}>{hora12(`${pad(h % 24)}:00`)}</option>)}
                </select>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function DetalleBloque({ b, proyectos, ocupado, onCerrar, onEnfocar, onTerminar, onMover }) {
  const [hhmm, setHhmm] = useState(localCR(b.ini).slice(11, 16))
  const [dur, setDur] = useState(Math.round((b.fin - b.ini) / 60000))
  useEffect(() => { setHhmm(localCR(b.ini).slice(11, 16)); setDur(Math.round((b.fin - b.ini) / 60000)) }, [b])
  const t = b.tarea
  return (
    <div className="ag-panel">
      <div className="ag-panel-tit">
        <b>{b.tipo === 'evento' ? '📅' : '🎯'} {b.titulo}</b>
        <button className="btn-ghost small" onClick={onCerrar}>✕</button>
      </div>
      <p className="tenue">{horaDeMs(b.ini)} – {horaDeMs(b.fin)} · {durTexto(Math.round((b.fin - b.ini) / 60000))}</p>
      {b.tipo === 'evento' && <p className="tenue">Evento de Google Calendar (solo lectura).</p>}
      {t && (
        <>
          {proyectos[t.proyecto_id] && <p className="tenue">📁 {proyectos[t.proyecto_id]}{t.due?.recurrente ? ' · 🔁 hábito' : ''}</p>}
          <div className="ag-acc col">
            <button onClick={() => onEnfocar(t)}>⏱️ Enfocar ahora</button>
            <button onClick={() => onTerminar(t)} disabled={ocupado}>✅ ¡Hecho!</button>
          </div>
          <div className="ag-mover">
            <label>⏰ Hora <input type="time" value={hhmm} step={300} onChange={e => setHhmm(e.target.value)} /></label>
            <label>⌛ Min
              <select value={dur} onChange={e => setDur(+e.target.value)}>
                {[...new Set([15, 25, 30, 45, 60, 90, 120, dur])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <button disabled={ocupado} onClick={() => onMover(t, hhmm, dur)}>Guardar</button>
          </div>
        </>
      )}
    </div>
  )
}
