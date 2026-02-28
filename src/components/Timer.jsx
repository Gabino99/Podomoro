import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { PREMIOS, WORK_SESSIONS, BREAK_SESSIONS, CATEGORIAS, MAX_HISTORY } from '../lib/constants'
import { playWorkComplete, playBreakComplete } from '../lib/sounds'

function getNextPrize(puntos) {
  const sorted = [...PREMIOS].sort((a, b) => a.costo - b.costo)
  return sorted.find(p => p.costo > puntos) || null
}

function getTodayKey() {
  return new Date().toISOString().split('T')[0]
}

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

function NextPrizeBanner({ puntos }) {
  const next = getNextPrize(puntos)
  if (!next) return <div className="next-prize-banner all-unlocked">🏆 ¡Tenés puntos para todo!</div>
  const falta = next.costo - puntos
  const pct   = Math.min((puntos / next.costo) * 100, 100)
  return (
    <div className="next-prize-banner">
      <div className="next-prize-info">
        <span>{next.emoji} {next.nombre}</span>
        <span className="next-prize-falta">faltan {falta} pts</span>
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

export default function Timer({ userId, puntos, setPuntos, metaDiaria, onUpdateMeta, onRunningChange, onCompleteChange }) {
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

  const intervalRef = useRef(null)
  const puntosRef   = useRef(puntos)

  useEffect(() => { puntosRef.current = puntos }, [puntos])
  useEffect(() => { onRunningChange?.(isRunning)  }, [isRunning])
  useEffect(() => { onCompleteChange?.(isComplete) }, [isComplete])

  useEffect(() => {
    loadTodayStats()
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
  }, [userId])

  const loadTodayStats = async () => {
    const today = getTodayKey()
    const { data } = await supabase
      .from('sesiones')
      .select('duracion_minutos, created_at')
      .eq('user_id', userId)
      .eq('tipo', 'trabajo')
      .eq('completada', true)

    if (data) {
      const hoyMin = data.filter(s => s.created_at?.startsWith(today)).reduce((a, s) => a + s.duracion_minutos, 0)
      setMinutosHoy(hoyMin)
      let s = 0
      for (let i = 0; i < 30; i++) {
        const d = new Date(); d.setDate(d.getDate() - i)
        const day = d.toISOString().split('T')[0]
        if (data.some(r => r.created_at?.startsWith(day))) s++
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

    if (savedEnd && savedMode) {
      const remaining = Math.round((parseInt(savedEnd) - Date.now()) / 1000)
      if (remaining > 0) { setMode(savedMode); setSecondsLeft(remaining); setIsRunning(true) }
      else clearTimerStorage()
    }
  }, [])

  const clearTimerStorage = () => {
    ['pomodoro_end_time','pomodoro_mode','pomodoro_work_duration','pomodoro_break_duration','pomodoro_categoria']
      .forEach(k => localStorage.removeItem(k))
  }

  const totalSeconds = useMemo(() => mode === 'work' ? workDuration * 60 : breakDuration * 60, [mode, workDuration, breakDuration])
  const progress     = useMemo(() => ((totalSeconds - secondsLeft) / totalSeconds) * 100, [totalSeconds, secondsLeft])

  const completeSession = useCallback(async (currentMode, minutosGanados) => {
    const currentPuntos = puntosRef.current
    try {
      let nuevosPuntos = currentPuntos
      if (currentMode === 'work') {
        nuevosPuntos = currentPuntos + minutosGanados
        setPuntos(nuevosPuntos)
        puntosRef.current = nuevosPuntos
      }
      await supabase.from('perfiles').update({ puntos_totales: nuevosPuntos }).eq('user_id', userId)
      await supabase.from('sesiones').insert({
        user_id: userId, duracion_minutos: minutosGanados,
        tipo: currentMode === 'work' ? 'trabajo' : 'descanso',
        completada: true, categoria: currentMode === 'work' ? categoria : 'descanso',
        nota: nota.trim() || null,
      })
      setSessionHistory(prev => [
        { minutos: minutosGanados, hora: new Date().toLocaleTimeString(), tipo: currentMode === 'work' ? 'trabajo' : 'descanso', categoria },
        ...prev.slice(0, MAX_HISTORY - 1),
      ])
      if (currentMode === 'work') { setMinutosHoy(m => m + minutosGanados); playWorkComplete(); setShowBreakOffer(true) }
      else playBreakComplete()
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('¡Sesión completada! ⬡', {
          body: currentMode === 'work' ? `+${minutosGanados} puntos ganados.` : 'Descanso terminado.',
        })
      }
      clearTimerStorage(); setNota('')
    } catch (err) {
      setError('Error al guardar: ' + err.message)
      if (currentMode === 'work') { setPuntos(currentPuntos); puntosRef.current = currentPuntos }
    }
  }, [userId, setPuntos, categoria, nota])

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

  const resetTimer = useCallback((newMode = mode, newWork = workDuration, newBreak = breakDuration) => {
    clearInterval(intervalRef.current); clearTimerStorage()
    setIsRunning(false); setIsComplete(false); setError(null); setShowBreakOffer(false)
    setSecondsLeft(newMode === 'work' ? newWork * 60 : newBreak * 60)
  }, [mode, workDuration, breakDuration])

  const handleStart  = () => { if (!isComplete) { setShowBreakOffer(false); setIsRunning(true) } }
  const handlePause  = () => { setIsRunning(false); clearInterval(intervalRef.current); clearTimerStorage() }
  const handleModeChange = (newMode) => { setMode(newMode); resetTimer(newMode) }
  const handleWorkDurationChange  = (m) => { if (isRunning) return; setWorkDuration(m);  if (mode === 'work')  { setSecondsLeft(m * 60); setIsComplete(false) } }
  const handleBreakDurationChange = (m) => { if (isRunning) return; setBreakDuration(m); if (mode === 'break') { setSecondsLeft(m * 60); setIsComplete(false) } }
  const startBreakNow = () => { setShowBreakOffer(false); setMode('break'); setSecondsLeft(breakDuration * 60); setIsComplete(false); setTimeout(() => setIsRunning(true), 100) }

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
        <NextPrizeBanner puntos={puntos} />
      </div>

      <DailyGoalBar minutosHoy={minutosHoy} meta={metaDiaria} onChangeMeta={onUpdateMeta} />

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
        </div>
      </div>

      {mode === 'work' && !isRunning && !isComplete && (
        <div className="categoria-selector">
          {CATEGORIAS.map(c => (
            <button key={c.id} className={`cat-btn ${categoria === c.id ? 'active' : ''}`}
              onClick={() => setCategoria(c.id)} title={c.label}>
              {c.emoji} <span>{c.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="timer-circle-wrapper">
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

      {showBreakOffer && (
        <div className="break-offer">
          <p>¡Trabajo completado! ¿Empezar descanso de {breakDuration} min?</p>
          <div className="break-offer-actions">
            <button className="btn-primary" onClick={startBreakNow}>Sí, descansar</button>
            <button className="btn-ghost" onClick={() => { setShowBreakOffer(false); resetTimer() }}>Saltar</button>
          </div>
        </div>
      )}

      {!showBreakOffer && (
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

      {mode === 'work' && !isRunning && !isComplete && (
        <div className="nota-input-wrapper">
          <input className="nota-input" type="text"
            placeholder="Nota opcional (¿en qué trabajaste?)"
            value={nota} onChange={e => setNota(e.target.value)} maxLength={120} />
        </div>
      )}

      {sessionHistory.length > 0 && (
        <div className="session-history">
          <p className="history-title">Sesiones de hoy</p>
          {sessionHistory.map((s, i) => (
            <div key={i} className="history-item">
              <span>{CATEGORIAS.find(c => c.id === s.categoria)?.emoji ?? '📌'} {s.minutos} min {s.tipo}</span>
              <span className="history-time">{s.hora}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
