import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

const WORK_SESSIONS = [20, 25, 30, 45, 60]
const BREAK_SESSIONS = [5, 10]
const MAX_HISTORY = 5

export default function Timer({ userId, puntos, setPuntos }) {
  const [mode, setMode] = useState('work')
  const [workDuration, setWorkDuration] = useState(25)
  const [breakDuration, setBreakDuration] = useState(5)
  const [secondsLeft, setSecondsLeft] = useState(25 * 60)
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [sessionHistory, setSessionHistory] = useState([])
  const [error, setError] = useState(null)
  const intervalRef = useRef(null)

  const totalSeconds = useMemo(() => 
    mode === 'work' ? workDuration * 60 : breakDuration * 60, 
    [mode, workDuration, breakDuration]
  )

  const progress = useMemo(() => 
    ((totalSeconds - secondsLeft) / totalSeconds) * 100, 
    [totalSeconds, secondsLeft]
  )

  // EFECTO LÁZARO: Recupera el tiempo si refrescas o cambias de pestaña
  useEffect(() => {
    const savedEndTime = localStorage.getItem('pomodoro_end_time')
    const savedMode = localStorage.getItem('pomodoro_mode')
    const savedWorkDuration = localStorage.getItem('pomodoro_work_duration')
    const savedBreakDuration = localStorage.getItem('pomodoro_break_duration')

    if (savedWorkDuration) setWorkDuration(parseInt(savedWorkDuration))
    if (savedBreakDuration) setBreakDuration(parseInt(savedBreakDuration))

    if (savedEndTime && savedMode) {
      const remaining = Math.round((parseInt(savedEndTime) - Date.now()) / 1000)
      if (remaining > 0) {
        setMode(savedMode)
        setSecondsLeft(remaining)
        setIsRunning(true)
      } else {
        localStorage.removeItem('pomodoro_end_time')
      }
    }
  }, [])

  const resetTimer = useCallback((newMode = mode, newWork = workDuration, newBreak = breakDuration) => {
    clearInterval(intervalRef.current)
    localStorage.removeItem('pomodoro_end_time')
    setIsRunning(false)
    setIsComplete(false)
    setError(null)
    const duration = newMode === 'work' ? newWork * 60 : newBreak * 60
    setSecondsLeft(duration)
  }, [mode, workDuration, breakDuration])

  const completeSession = useCallback(async (minutosGanados) => {
    try {
      let nuevosPuntos = puntos
      if (mode === 'work') {
        nuevosPuntos = puntos + minutosGanados
        setPuntos(nuevosPuntos)
      }

      const { error: updateError } = await supabase
        .from('perfiles')
        .update({ puntos_totales: nuevosPuntos })
        .eq('user_id', userId)

      if (updateError) throw updateError

      const { error: insertError } = await supabase.from('sesiones').insert({
        user_id: userId,
        duracion_minutos: minutosGanados,
        tipo: mode === 'work' ? 'trabajo' : 'descanso',
        completada: true,
      })

      if (insertError) throw insertError

      setSessionHistory(prev => [
        { 
          minutos: minutosGanados, 
          hora: new Date().toLocaleTimeString(), 
          tipo: mode === 'work' ? 'trabajo' : 'descanso' 
        }, 
        ...prev.slice(0, MAX_HISTORY - 1)
      ])
      localStorage.removeItem('pomodoro_end_time')
    } catch (err) {
      setError('Error al guardar la sesión: ' + err.message)
      if (mode === 'work') setPuntos(puntos) // Revertir puntos si falla
    }
  }, [puntos, setPuntos, userId, mode])

  useEffect(() => {
    if (isRunning) {
      if (!localStorage.getItem('pomodoro_end_time')) {
        const endTime = Date.now() + (secondsLeft * 1000)
        localStorage.setItem('pomodoro_end_time', endTime.toString())
        localStorage.setItem('pomodoro_mode', mode)
        localStorage.setItem('pomodoro_work_duration', workDuration.toString())
        localStorage.setItem('pomodoro_break_duration', breakDuration.toString())
      }
      intervalRef.current = setInterval(() => {
        const endTime = parseInt(localStorage.getItem('pomodoro_end_time'))
        const now = Date.now()
        const remaining = Math.round((endTime - now) / 1000)
        if (remaining <= 0) {
          clearInterval(intervalRef.current)
          setSecondsLeft(0)
          setIsRunning(false)
          setIsComplete(true)
          const minutos = mode === 'work' ? workDuration : breakDuration
          completeSession(minutos)
        } else {
          setSecondsLeft(remaining)
        }
      }, 1000)
    }
    return () => clearInterval(intervalRef.current)
  }, [isRunning, mode, workDuration, breakDuration, completeSession, secondsLeft])

  // Notificaciones
  useEffect(() => {
    if (isComplete && Notification.permission === 'granted') {
      new Notification('¡Sesión completada!', { 
        body: mode === 'work' 
          ? `Has ganado ${workDuration} puntos.` 
          : 'Tu descanso ha terminado.' 
      })
    }
  }, [isComplete, mode, workDuration])

  useEffect(() => {
    if (Notification.permission !== 'granted') Notification.requestPermission()
  }, [])

  const handleStart = () => { if (!isComplete) setIsRunning(true) }

  const handlePause = () => {
    setIsRunning(false)
    clearInterval(intervalRef.current)
    localStorage.removeItem('pomodoro_end_time')
  }

  const handleModeChange = (newMode) => {
    setMode(newMode)
    resetTimer(newMode)
  }

  const handleWorkDurationChange = (mins) => {
    setWorkDuration(mins)
    if (mode === 'work') { 
      setSecondsLeft(mins * 60) 
      setIsRunning(false) 
      setIsComplete(false) 
    }
  }

  const handleBreakDurationChange = (mins) => {
    setBreakDuration(mins)
    if (mode === 'break') { 
      setSecondsLeft(mins * 60) 
      setIsRunning(false) 
      setIsComplete(false) 
    }
  }

  const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, '0')
  const seconds = (secondsLeft % 60).toString().padStart(2, '0')
  const radius = 130
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (progress / 100) * circumference

  return (
    <div className="timer-container">
      {error && <div className="error-message">{error}</div>}
      {/* Botones de Modo */}
      <div className="mode-toggle">
        <button
          className={`mode-btn ${mode === 'work' ? 'active' : ''}`}
          onClick={() => handleModeChange('work')}
          aria-label="Cambiar a modo trabajo"
          role="tab"
          aria-selected={mode === 'work'}
        >
          Trabajo
        </button>
        <button
          className={`mode-btn ${mode === 'break' ? 'active' : ''}`}
          onClick={() => handleModeChange('break')}
          aria-label="Cambiar a modo descanso"
          role="tab"
          aria-selected={mode === 'break'}
        >
          Descanso
        </button>
      </div>
      {/* Selectores de Tiempo */}
      <div className="duration-selectors">
        <div className="selector-group">
          {(mode === 'work' ? WORK_SESSIONS : BREAK_SESSIONS).map(m => (
            <button
              key={m}
              className={`dur-btn ${(mode === 'work' ? workDuration : breakDuration) === m ? 'active' : ''}`}
              onClick={() => mode === 'work' ? handleWorkDurationChange(m) : handleBreakDurationChange(m)}
              disabled={isRunning}
              aria-label={`Seleccionar ${m} minutos para ${mode}`}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>
      {/* Círculo del Temporizador */}
      <div className="timer-circle-wrapper">
        <svg className="timer-svg" viewBox="0 0 300 300" aria-hidden="true">
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
        <div className="timer-display" aria-live="polite">
          {isComplete ? (
            <div className="complete-badge">✓</div>
          ) : (
            <>
              <span className="time-text">{minutes}:{seconds}</span>
              <span className="time-label">
                {mode === 'work' ? `+${workDuration} pts` : 'Descanso'}
              </span>
            </>
          )}
        </div>
      </div>
      {/* Controles */}
      <div className="timer-controls">
        {!isRunning && !isComplete && (
          <button className="btn-primary large" onClick={handleStart}>
            {secondsLeft < totalSeconds ? 'Reanudar' : 'Iniciar'}
          </button>
        )}
        {isRunning && (
          <button className="btn-secondary large" onClick={handlePause}>
            Pausar
          </button>
        )}
        {isComplete && (
          <button className="btn-primary large" onClick={() => resetTimer()}>
            Nueva sesión
          </button>
        )}
        {(isRunning || (!isComplete && secondsLeft < totalSeconds)) && (
          <button className="btn-ghost" onClick={() => resetTimer()}>
            Cancelar
          </button>
        )}
      </div>
      {/* Historial */}
      {sessionHistory.length > 0 && (
        <div className="session-history">
          <p className="history-title">Sesiones de hoy</p>
          {sessionHistory.map((s, i) => (
            <div key={i} className="history-item">
              <span>✓ {s.minutos} min {s.tipo}</span>
              <span className="history-time">{s.hora}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
