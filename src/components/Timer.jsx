import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const WORK_SESSIONS = [20, 25, 30, 45, 60]
const BREAK_SESSIONS = [5, 10]

export default function Timer({ userId, puntos, setPuntos }) {
  const [mode, setMode] = useState('work') 
  const [workDuration, setWorkDuration] = useState(25)
  const [breakDuration, setBreakDuration] = useState(5)
  const [secondsLeft, setSecondsLeft] = useState(25 * 60)
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [sessionHistory, setSessionHistory] = useState([])
  const intervalRef = useRef(null)

  const totalSeconds = mode === 'work' ? workDuration * 60 : breakDuration * 60
  const progress = ((totalSeconds - secondsLeft) / totalSeconds) * 100

  // EFECTO LÁZARO: Recupera el tiempo si refrescas o cambias de pestaña
  useEffect(() => {
    const savedEndTime = localStorage.getItem('pomodoro_end_time');
    const savedMode = localStorage.getItem('pomodoro_mode');
    
    if (savedEndTime && savedMode) {
      const remaining = Math.round((parseInt(savedEndTime) - Date.now()) / 1000);
      if (remaining > 0) {
        setMode(savedMode);
        setSecondsLeft(remaining);
        setIsRunning(true);
      } else {
        localStorage.removeItem('pomodoro_end_time');
      }
    }
  }, []);

  const resetTimer = useCallback((newMode = mode, newWork = workDuration, newBreak = breakDuration) => {
    clearInterval(intervalRef.current)
    localStorage.removeItem('pomodoro_end_time')
    setIsRunning(false)
    setIsComplete(false)
    const duration = newMode === 'work' ? newWork * 60 : newBreak * 60
    setSecondsLeft(duration)
  }, [mode, workDuration, breakDuration])

  const acreditarPuntos = useCallback(async (minutosGanados) => {
    const nuevosPuntos = puntos + minutosGanados
    setPuntos(nuevosPuntos)
    
    await supabase
      .from('perfiles')
      .update({ puntos_totales: nuevosPuntos })
      .eq('user_id', userId)

    await supabase.from('sesiones').insert({
      user_id: userId,
      duracion_minutos: minutosGanados,
      tipo: mode === 'work' ? 'trabajo' : 'descanso',
      completada: true,
    })

    setSessionHistory(prev => [{ minutos: minutosGanados, hora: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)])
    localStorage.removeItem('pomodoro_end_time')
  }, [puntos, setPuntos, userId, mode])

  useEffect(() => {
    if (isRunning) {
      if (!localStorage.getItem('pomodoro_end_time')) {
        const endTime = Date.now() + (secondsLeft * 1000);
        localStorage.setItem('pomodoro_end_time', endTime.toString());
        localStorage.setItem('pomodoro_mode', mode);
      }

      intervalRef.current = setInterval(() => {
        const endTime = parseInt(localStorage.getItem('pomodoro_end_time'));
        const now = Date.now();
        const remaining = Math.round((endTime - now) / 1000);

        if (remaining <= 0) {
          clearInterval(intervalRef.current);
          setSecondsLeft(0);
          setIsRunning(false);
          setIsComplete(true);
          if (mode === 'work') acreditarPuntos(workDuration);
          localStorage.removeItem('pomodoro_end_time');
        } else {
          setSecondsLeft(remaining);
        }
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning, mode, workDuration, acreditarPuntos, secondsLeft]);

  const handleStart = () => { if (!isComplete) setIsRunning(true); };
  const handlePause = () => { 
    setIsRunning(false); 
    clearInterval(intervalRef.current); 
    localStorage.removeItem('pomodoro_end_time'); 
  };

  const handleModeChange = (newMode) => {
    setMode(newMode);
    resetTimer(newMode);
  };

  const handleWorkDurationChange = (mins) => {
    setWorkDuration(mins);
    if (mode === 'work') { setSecondsLeft(mins * 60); setIsRunning(false); setIsComplete(false); }
  };

  const handleBreakDurationChange = (mins) => {
    setBreakDuration(mins);
    if (mode === 'break') { setSecondsLeft(mins * 60); setIsRunning(false); setIsComplete(false); }
  };

  const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const seconds = (secondsLeft % 60).toString().padStart(2, '0');
  const radius = 130;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="timer-container">
      {/* Botones de Modo */}
      <div className="mode-toggle">
        <button 
          className={`mode-btn ${mode === 'work' ? 'active' : ''}`} 
          onClick={() => handleModeChange('work')}
        >
          Trabajo
        </button>
        <button 
          className={`mode-btn ${mode === 'break' ? 'active' : ''}`} 
          onClick={() => handleModeChange('break')}
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
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      {/* Círculo del Temporizador */}
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
              <span>✓ {s.minutos} min trabajo</span>
              <span className="history-time">{s.hora}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
