import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { WORK_SESSIONS, BREAK_SESSIONS, CATEGORIAS, MAX_HISTORY } from '../lib/constants'
import { playWorkComplete, playBreakComplete, setVolume, getVolume } from '../lib/sounds'
import { proximaMeta } from '../lib/useRecompensas'
import { fechaCR, diasHasta } from '../lib/fechas'
import { horaCorta, textoEnMinutos } from '../lib/useAgenda'
import MusicaEnfoque from './MusicaEnfoque'

function DailyGoalBar({ minutosHoy, meta, onChangeMeta }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(meta)
  const pct  = Math.min((minutosHoy / meta) * 100, 100)
  const done = pct >= 100

  const save = () => {
    const val = Math.max(10, Math.min(480, parseInt(draft) || meta))
    onChangeMeta(val)
    setEditing(false)
  }

  return (
    <div className="daily-goal-bar">
      <div className="daily-goal-header">
        <span className="daily-goal-label">{done ? '✅' : '🎯'} Meta diaria</span>
        <div className="daily-goal-right">
          {editing ? (
            <div className="daily-goal-edit">
              <input type="number" min="10" max="480" value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && save()} autoFocus />
              <button className="btn-ghost small" onClick={save}>✓</button>
            </div>
          ) : (
            <>
              <span className="daily-goal-value">{minutosHoy} / {meta} min</span>
              <button className="btn-ghost small" onClick={() => { setDraft(meta); setEditing(true) }}>✎</button>
            </>
          )}
        </div>
      </div>
      <div className="daily-goal-track">
        <div className={`daily-goal-fill ${done ? 'done' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function NextPrizeBanner({ puntos, recompensas }) {
  if (recompensas.length === 0) {
    return <div className="next-prize-banner all-unlocked">🎁 Cree su primera recompensa en la pestaña Recompensas</div>
  }
  const next = proximaMeta(recompensas, puntos)
  if (!next) return <div className="next-prize-banner all-unlocked">🏆 ¡Tiene puntos para todo!</div>
  const falta = next.costo - puntos
  const pct   = Math.min((puntos / next.costo) * 100, 100)
  const dias  = diasHasta(next.fecha_limite)
  return (
    <div className="next-prize-banner">
      <div className="next-prize-info">
        <span>{next.emoji} {next.nombre}</span>
        <span className="next-prize-falta">
          faltan {falta} pts{dias !== null && dias >= 0 ? ` · ${dias} d` : ''}
        </span>
      </div>
      <div className="next-prize-track">
        <div className="next-prize-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function StreakBadge({ streak }) {
  if (streak < 2) return null
  return <div className="streak-badge" title={`${streak} días consecutivos`}>🔥 {streak} días</div>
}

function VolumeSlider() {
  const [vol, setVol] = useState(getVolume)
  const handleChange = (e) => {
    const v = parseFloat(e.target.value)
    setVol(v)
    setVolume(v)
  }
  return (
    <div className="volume-slider">
      <span className="volume-icon">{vol === 0 ? '🔇' : vol < 0.5 ? '🔉' : '🔊'}</span>
      <input type="range" min="0" max="1" step="0.05" value={vol} onChange={handleChange} />
    </div>
  )
}

export default function Timer({
  userId, puntos, setPuntos, recompensas = [], metaDiaria, onUpdateMeta, onRunningChange, onCompleteChange,
  activo = true,             // la pestaña está a la vista (el Temporizador sigue vivo aunque no lo esté)
  mision = null,             // misión de Todoist amarrada al pomodoro (Modo enfoque)
  inicioFoco = 0,            // sube cada vez que se pide "Modo enfoque" desde Misiones
  onTerminarMision,          // async (mision) => respuesta de la Edge Function
  onSoltarMision,
  onSesionGuardada,          // (respuesta de registrar_sesion) => celebrar insignias y refrescar el juego
  proximoEvento = null,      // próximo evento de Google Calendar { titulo, inicio, fin }
  ventana = null,            // minutos que faltan para ese evento
  spotifyUrl = null,
  onSpotifyGuardado,
}) {
  const [mode,           setMode]           = useState('work')
  const [workDuration,   setWorkDuration]   = useState(25)
  const [breakDuration,  setBreakDuration]  = useState(5)
  const [secondsLeft,    setSecondsLeft]    = useState(25 * 60)
  const [isRunning,      setIsRunning]      = useState(false)
  const [isComplete,     setIsComplete]     = useState(false)
  const [sessionHistory, setSessionHistory] = useState([])
  const [error,          setError]          = useState(null)
  const [categoria,      setCategoria]      = useState('general')
  const [nota,           setNota]           = useState('')
  const [showBreakOffer, setShowBreakOffer] = useState(false)
  const [minutosHoy,     setMinutosHoy]     = useState(0)
  const [streak,         setStreak]         = useState(0)
  const [autoMode,       setAutoMode]       = useState(() => localStorage.getItem('pomodoro_auto') === 'true')
  const [pendingBreak,   setPendingBreak]   = useState(false)
  const [preguntaMision, setPreguntaMision] = useState(false)   // "¿La terminó?" al acabar el pomodoro
  const [cerrandoMision, setCerrandoMision] = useState(false)
  const [avisoMision,    setAvisoMision]    = useState(null)

  const intervalRef = useRef(null)
  const puntosRef   = useRef(puntos)
  const misionRef   = useRef(mision)
  useEffect(() => { misionRef.current = mision; if (!mision) setPreguntaMision(false) }, [mision])

  useEffect(() => { puntosRef.current = puntos }, [puntos])
  useEffect(() => { onRunningChange?.(isRunning)  }, [isRunning])
  useEffect(() => { onCompleteChange?.(isComplete) }, [isComplete])

  useEffect(() => {
    loadTodayStats()
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
  }, [userId])

  // #2 — Atajo de teclado: Espacio para iniciar/pausar
  useEffect(() => {
    const handleKey = (e) => {
      if (!activo) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        if (isComplete) return
        if (isRunning) handlePause()
        else handleStart()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activo, isRunning, isComplete, secondsLeft, mode, workDuration, breakDuration, categoria])

  const loadTodayStats = async () => {
    const today = fechaCR()
    const desde = new Date()
    desde.setDate(desde.getDate() - 31)
    const { data, error } = await supabase
      .from('sesiones')
      .select('duracion_minutos, created_at')
      .eq('user_id', userId)
      .eq('tipo', 'trabajo')
      .eq('completada', true)
      .gte('created_at', desde.toISOString())

    if (error) { console.error(error); return }
    if (data) {
      // Se agrupa por día de Costa Rica (no UTC)
      const dias = data.map(r => ({ dia: fechaCR(r.created_at), min: r.duracion_minutos }))
      setMinutosHoy(dias.filter(r => r.dia === today).reduce((a, r) => a + r.min, 0))
      const conSesion = new Set(dias.map(r => r.dia))
      let s = 0
      for (let i = 0; i < 30; i++) {
        const d = new Date(); d.setDate(d.getDate() - i)
        if (conSesion.has(fechaCR(d))) s++
        else if (i > 0) break
      }
      setStreak(s)
    }
  }

  useEffect(() => {
    const savedEnd   = localStorage.getItem('pomodoro_end_time')
    const savedMode  = localStorage.getItem('pomodoro_mode')
    const savedWork  = localStorage.getItem('pomodoro_work_duration')
    const savedBreak = localStorage.getItem('pomodoro_break_duration')
    const savedCat   = localStorage.getItem('pomodoro_categoria')

    if (savedWork)  setWorkDuration(parseInt(savedWork))
    if (savedBreak) setBreakDuration(parseInt(savedBreak))
    if (savedCat)   setCategoria(savedCat)

    const savedPaused = localStorage.getItem('pomodoro_paused_seconds')
    if (savedPaused && savedMode) {
      setMode(savedMode)
      setSecondsLeft(parseInt(savedPaused))
    } else if (savedEnd && savedMode) {
      const remaining = Math.round((parseInt(savedEnd) - Date.now()) / 1000)
      if (remaining > 0) { setMode(savedMode); setSecondsLeft(remaining); setIsRunning(true) }
      else clearTimerStorage()
    }
  }, [])

  const clearTimerStorage = () => {
    ['pomodoro_end_time','pomodoro_mode','pomodoro_work_duration','pomodoro_break_duration','pomodoro_categoria','pomodoro_paused_seconds']
      .forEach(k => localStorage.removeItem(k))
  }

  const totalSeconds = useMemo(() => mode === 'work' ? workDuration * 60 : breakDuration * 60, [mode, workDuration, breakDuration])
  const progress     = useMemo(() => ((totalSeconds - secondsLeft) / totalSeconds) * 100, [totalSeconds, secondsLeft])

  const completeSession = useCallback(async (currentMode, minutosGanados) => {
    try {
      // El servidor guarda la sesión y suma los puntos en un solo paso.
      const { data, error: rpcError } = await supabase.rpc('registrar_sesion', {
        p_duracion:  minutosGanados,
        p_tipo:      currentMode === 'work' ? 'trabajo' : 'descanso',
        p_categoria: currentMode === 'work' ? categoria : 'descanso',
        p_nota:      nota.trim() || null,
      })
      if (rpcError || !data?.exito) throw rpcError || new Error('respuesta inválida')

      if (currentMode === 'work') {
        setPuntos(data.puntos_totales)
        puntosRef.current = data.puntos_totales
        onSesionGuardada?.(data)
      }
      setSessionHistory(prev => [
        { minutos: minutosGanados, hora: new Date().toLocaleTimeString(), tipo: currentMode === 'work' ? 'trabajo' : 'descanso', categoria },
        ...prev.slice(0, MAX_HISTORY - 1),
      ])
      if (currentMode === 'work') { setMinutosHoy(m => m + minutosGanados); playWorkComplete() }
      else playBreakComplete()
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('¡Sesión completada! ⬡', {
          body: currentMode === 'work' ? `+${minutosGanados} puntos ganados.` : 'Descanso terminado.',
        })
      }
      clearTimerStorage(); setNota('')

      // Modo enfoque: antes de seguir, preguntar si la misión quedó terminada.
      if (currentMode === 'work' && misionRef.current) {
        setShowBreakOffer(false)
        setPreguntaMision(true)
        return
      }

      // #10 — Auto-pomodoro
      if (autoMode) {
        if (currentMode === 'work') {
          setShowBreakOffer(false)
          setMode('break')
          setSecondsLeft(breakDuration * 60)
          setIsComplete(false)
          setPendingBreak(true)
        } else {
          setMode('work')
          setSecondsLeft(workDuration * 60)
          setIsComplete(false)
          setPendingBreak(true)
        }
      } else if (currentMode === 'work') {
        setShowBreakOffer(true)
      }
    } catch (err) {
      console.error(err)
      setError('No se pudo guardar la sesión, así que los puntos no se sumaron. Revise su conexión.')
    }
  }, [userId, setPuntos, categoria, nota, autoMode, breakDuration, workDuration, onSesionGuardada])

  useEffect(() => {
    if (!isRunning) return
    const capturedMode  = mode
    const capturedWork  = workDuration
    const capturedBreak = breakDuration

    if (!localStorage.getItem('pomodoro_end_time')) {
      localStorage.setItem('pomodoro_end_time', (Date.now() + secondsLeft * 1000).toString())
      localStorage.setItem('pomodoro_mode', capturedMode)
      localStorage.setItem('pomodoro_work_duration', capturedWork.toString())
      localStorage.setItem('pomodoro_break_duration', capturedBreak.toString())
      localStorage.setItem('pomodoro_categoria', categoria)
    }

    intervalRef.current = setInterval(() => {
      const remaining = Math.round((parseInt(localStorage.getItem('pomodoro_end_time')) - Date.now()) / 1000)
      if (remaining <= 0) {
        clearInterval(intervalRef.current)
        setSecondsLeft(0); setIsRunning(false); setIsComplete(true)
        completeSession(capturedMode, capturedMode === 'work' ? capturedWork : capturedBreak)
      } else {
        setSecondsLeft(remaining)
      }
    }, 500)

    return () => clearInterval(intervalRef.current)
  }, [isRunning])

  // pendingBreak triggers auto-start
  useEffect(() => {
    if (pendingBreak && !isRunning && !isComplete) {
      setPendingBreak(false)
      setIsRunning(true)
    }
  }, [pendingBreak, mode, isRunning, isComplete])

  // Modo enfoque: cada vez que Misiones pide enfocar, arranca un pomodoro con la misión.
  // Si ya hay uno corriendo, no lo interrumpe: la misión queda amarrada a ese.
  useEffect(() => {
    if (!inicioFoco || !misionRef.current) return
    const m = misionRef.current
    setAvisoMision(null); setPreguntaMision(false)
    setNota((m.contenido || '').slice(0, 120))
    if (isRunning) return
    const dur = m.duracion >= 5 && m.duracion <= 90 ? m.duracion : workDuration
    clearInterval(intervalRef.current); clearTimerStorage()
    setMode('work'); setWorkDuration(dur); setSecondsLeft(dur * 60)
    setIsComplete(false); setShowBreakOffer(false); setError(null)
    setPendingBreak(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicioFoco])

  const responderMision = async (terminada) => {
    const m = misionRef.current
    if (!terminada || !m) { setPreguntaMision(false); setShowBreakOffer(true); return }
    if (cerrandoMision) return
    setCerrandoMision(true)
    try {
      const r = await onTerminarMision?.(m)
      if (r?.ok === false && r?.motivo === 'ya_completada') setAvisoMision('Esa misión ya estaba completada en Todoist.')
      else setAvisoMision(`✅ «${m.contenido}» completada: +${r?.puntos_ganados ?? 0} pts${r?.zombi ? ' (zombi ×1.5)' : ''}`)
      onSoltarMision?.()
      setPreguntaMision(false); setShowBreakOffer(true)
    } catch (e) {
      setError(`No se pudo completar en Todoist: ${e.message}`)
    } finally {
      setCerrandoMision(false)
    }
  }

  const resetTimer = useCallback((newMode = mode, newWork = workDuration, newBreak = breakDuration) => {
    clearInterval(intervalRef.current); clearTimerStorage()
    setIsRunning(false); setIsComplete(false); setError(null); setShowBreakOffer(false)
    setSecondsLeft(newMode === 'work' ? newWork * 60 : newBreak * 60)
  }, [mode, workDuration, breakDuration])

  const handleStart  = () => { if (!isComplete) { setShowBreakOffer(false); localStorage.removeItem('pomodoro_paused_seconds'); setIsRunning(true) } }
  const handlePause  = () => { setIsRunning(false); clearInterval(intervalRef.current); localStorage.setItem('pomodoro_paused_seconds', secondsLeft.toString()); localStorage.setItem('pomodoro_mode', mode); localStorage.setItem('pomodoro_work_duration', workDuration.toString()); localStorage.setItem('pomodoro_break_duration', breakDuration.toString()); localStorage.setItem('pomodoro_categoria', categoria); localStorage.removeItem('pomodoro_end_time') }
  const handleModeChange = (newMode) => { setMode(newMode); resetTimer(newMode) }
  const handleWorkDurationChange  = (m) => { if (isRunning) return; setWorkDuration(m);  if (mode === 'work')  { setSecondsLeft(m * 60); setIsComplete(false) } }
  const handleBreakDurationChange = (m) => { if (isRunning) return; setBreakDuration(m); if (mode === 'break') { setSecondsLeft(m * 60); setIsComplete(false) } }
  const startBreakNow = () => { setShowBreakOffer(false); setMode('break'); setSecondsLeft(breakDuration * 60); setIsComplete(false); setPendingBreak(true) }

  const toggleAutoMode = () => {
    const next = !autoMode
    setAutoMode(next)
    localStorage.setItem('pomodoro_auto', next.toString())
  }

  const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, '0')
  const seconds = (secondsLeft % 60).toString().padStart(2, '0')
  const radius  = 130
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (progress / 100) * circumference

  return (
    <div className="timer-container">
      {error && <div className="error-message">{error}<button className="btn-ghost small" onClick={() => setError(null)}>✕</button></div>}

      <div className="timer-top-row">
        <StreakBadge streak={streak} />
        <NextPrizeBanner puntos={puntos} recompensas={recompensas} />
      </div>

      <DailyGoalBar minutosHoy={minutosHoy} meta={metaDiaria} onChangeMeta={onUpdateMeta} />

      {mision && (
        <div className="foco-mision">
          <div className="foco-mision-info">
            <div className="foco-mision-etq">🎯 Misión en foco{mision.zombi ? ' · 🧟 zombi ×1.5' : ''}</div>
            <div className="foco-mision-nombre">{mision.contenido}</div>
            <div className="foco-mision-meta">
              {mision.proyecto || 'Inbox'}{mision.duracion ? ` · ⏱️ ${mision.duracion} min` : ''}
            </div>
          </div>
          {!preguntaMision && (
            <button className="btn-ghost small" onClick={() => onSoltarMision?.()} title="Soltar la misión (el pomodoro sigue)">✕</button>
          )}
        </div>
      )}
      {avisoMision && !mision && (
        <div className="next-prize-banner all-unlocked">{avisoMision}
          <button className="btn-ghost small" onClick={() => setAvisoMision(null)}>✕</button>
        </div>
      )}

      <div className="mode-toggle">
        <button className={`mode-btn ${mode === 'work'  ? 'active' : ''}`} onClick={() => handleModeChange('work')}>Trabajo</button>
        <button className={`mode-btn ${mode === 'break' ? 'active' : ''}`} onClick={() => handleModeChange('break')}>Descanso</button>
      </div>

      <div className="duration-selectors">
        <div className="selector-group">
          {(mode === 'work' ? WORK_SESSIONS : BREAK_SESSIONS).map(m => (
            <button key={m}
              className={`dur-btn ${(mode === 'work' ? workDuration : breakDuration) === m ? 'active' : ''}`}
              onClick={() => mode === 'work' ? handleWorkDurationChange(m) : handleBreakDurationChange(m)}
              disabled={isRunning}
            >{m}m</button>
          ))}
          <div className="custom-duration">
            <input
              type="number"
              min="1"
              max="180"
              placeholder="Min"
              className="custom-duration-input"
              disabled={isRunning}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = Math.max(1, Math.min(180, parseInt(e.target.value) || 0))
                  if (val > 0) {
                    mode === 'work' ? handleWorkDurationChange(val) : handleBreakDurationChange(val)
                    e.target.value = ''
                    e.target.blur()
                  }
                }
              }}
            />
          </div>
        </div>
      </div>

      {mode === 'work' && !isRunning && !isComplete && (
        <div className="categoria-selector show-labels">
          {CATEGORIAS.map(c => (
            <button key={c.id} className={`cat-btn ${categoria === c.id ? 'active' : ''}`}
              onClick={() => setCategoria(c.id)} title={c.label}>
              {c.emoji} <span>{c.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className={`timer-circle-wrapper ${isRunning ? 'running' : ''}`}>
        <svg className="timer-svg" viewBox="0 0 300 300">
          <circle className="circle-bg" cx="150" cy="150" r={radius} fill="none" strokeWidth="6" />
          <circle
            className={`circle-progress ${isComplete ? 'complete' : ''}`}
            cx="150" cy="150" r={radius}
            fill="none" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 150 150)"
          />
        </svg>
        <div className="timer-display">
          {isComplete ? (
            <div className="complete-badge">✓</div>
          ) : (
            <>
              <span className="time-text">{minutes}:{seconds}</span>
              <span className="time-label">{mode === 'work' ? `+${workDuration} pts` : 'Descanso'}</span>
            </>
          )}
        </div>
      </div>

      {mode === 'work' && !isRunning && !isComplete && proximoEvento && ventana != null && workDuration > ventana && (
        <div className="aviso-agenda">
          <span>⏰ «{proximoEvento.titulo}» empieza {textoEnMinutos(ventana)} ({horaCorta(proximoEvento.inicio)}): un pomodoro de {workDuration} min no cabe.</span>
          {ventana - 2 >= 5 && (
            <button onClick={() => handleWorkDurationChange(ventana - 2)}>Ajustar a {ventana - 2} min</button>
          )}
        </div>
      )}

      {preguntaMision && mision && (
        <div className="foco-pregunta">
          <p>⏱️ ¡Pomodoro terminado! ¿Terminó «{mision.contenido}»?</p>
          <div className="foco-pregunta-acciones">
            <button className="foco-si" onClick={() => responderMision(true)} disabled={cerrandoMision}>
              {cerrandoMision ? 'Completando…' : '✅ Sí, la terminé'}
            </button>
            <button className="btn-secondary" onClick={() => responderMision(false)} disabled={cerrandoMision}>⏳ Todavía no</button>
            <button className="btn-ghost" onClick={() => { onSoltarMision?.(); setPreguntaMision(false); setShowBreakOffer(true) }} disabled={cerrandoMision}>Soltar misión</button>
          </div>
        </div>
      )}

      {showBreakOffer && (
        <div className="break-offer">
          <p>¡Trabajo completado! ¿Empezar descanso de {breakDuration} min?</p>
          <div className="break-offer-actions">
            <button className="btn-primary" onClick={startBreakNow}>Sí, descansar</button>
            <button className="btn-ghost" onClick={() => { setShowBreakOffer(false); resetTimer() }}>Saltar</button>
          </div>
        </div>
      )}

      {!showBreakOffer && !preguntaMision && (
        <div className="timer-controls">
          {!isRunning && !isComplete && (
            <button className="btn-primary large" onClick={handleStart}>
              {secondsLeft < totalSeconds ? 'Reanudar' : 'Iniciar'}
            </button>
          )}
          {isRunning && <button className="btn-secondary large" onClick={handlePause}>Pausar</button>}
          {isComplete && <button className="btn-primary large" onClick={() => resetTimer()}>Nueva sesión</button>}
          {(isRunning || (!isComplete && secondsLeft < totalSeconds)) && (
            <button className="btn-ghost" onClick={() => resetTimer()}>Cancelar</button>
          )}
        </div>
      )}

      {!isRunning && !isComplete && (
        <div className="timer-settings-row">
          <button className={`auto-mode-btn ${autoMode ? 'active' : ''}`} onClick={toggleAutoMode}>
            {autoMode ? '🔄 Auto' : '🔄 Manual'}
          </button>
          <VolumeSlider />
          <span className="shortcut-hint">Espacio = iniciar/pausar</span>
        </div>
      )}

      {mode === 'work' && !isRunning && !isComplete && (
        <div className="nota-input-wrapper">
          <input className="nota-input" type="text"
            placeholder="Nota opcional (¿en qué trabajaste?)"
            value={nota} onChange={e => setNota(e.target.value)} maxLength={120} />
        </div>
      )}

      <MusicaEnfoque url={spotifyUrl} onGuardada={onSpotifyGuardado} />

      {sessionHistory.length > 0 ? (
        <div className="session-history">
          <p className="history-title">Sesiones de hoy</p>
          {sessionHistory.map((s, i) => (
            <div key={i} className="history-item">
              <span>{CATEGORIAS.find(c => c.id === s.categoria)?.emoji ?? '📌'} {s.minutos} min {s.tipo}</span>
              <span className="history-time">{s.hora}</span>
            </div>
          ))}
        </div>
      ) : (
        !isRunning && !isComplete && minutosHoy === 0 && (
          <div className="welcome-empty">
            <p>¡Empezá tu primera sesión del día!</p>
            <p className="welcome-sub">Elegí una duración y dale Iniciar (o presioná Espacio)</p>
          </div>
        )
      )}
    </div>
  )
}
