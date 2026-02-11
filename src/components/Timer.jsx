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
  const expectedEndTimeRef = useRef(null) // NUEVO: Para guardar la hora exacta de fin

  const totalSeconds = mode === 'work' ? workDuration * 60 : breakDuration * 60
  const progress = ((totalSeconds - secondsLeft) / totalSeconds) * 100

  const resetTimer = useCallback((newMode = mode, newWork = workDuration, newBreak = breakDuration) => {
    clearInterval(intervalRef.current)
    setIsRunning(false)
    setIsComplete(false)
    const duration = newMode === 'work' ? newWork * 60 : newBreak * 60
    setSecondsLeft(duration)
  }, [mode, workDuration, breakDuration])

  const acreditarPuntos = useCallback(async (minutosGanados) => {
    const nuevosPuntos = puntos + minutosGanados
    setPuntos(nuevosPuntos)
    
    // Actualizar perfil
    await supabase
      .from('perfiles')
      .update({ puntos_totales: nuevosPuntos })
      .eq('user_id', userId)

    // Registrar sesión
    await supabase.from('sesiones').insert({
      user_id: userId,
      duracion_minutos: minutosGanados,
      tipo: 'trabajo',
      completada: true,
    })

    setSessionHistory(prev => [{ minutos: minutosGanados, hora: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)])
  }, [puntos, setPuntos, userId])

  // Lógica mejorada del Temporizador
  useEffect(() => {
    if (isRunning) {
      // Calculamos cuándo debería terminar la sesión basado en el reloj real
      expectedEndTimeRef.current = Date.now() + (secondsLeft * 1000);

      intervalRef.current = setInterval(() => {
        const now = Date.now();
        const remaining = Math.round((expectedEndTimeRef.current - now) / 1000);

        if (remaining <= 0) {
          clearInterval(intervalRef.current);
          setSecondsLeft(0);
          setIsRunning(false);
          setIsComplete(true);
          if (mode === 'work') acreditarPuntos(workDuration);
        } else {
          setSecondsLeft(remaining);
        }
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning, mode, workDuration, acreditarPuntos]);

  // Funciones de control
  const handleStart = () => {
    if (isComplete) return;
    setIsRunning(true);
  };

  const handlePause = () => {
    setIsRunning(false);
    clearInterval(intervalRef.current);
  };

  const handleCancel = () => resetTimer();

  const handleModeChange = (newMode) => {
    setMode(newMode);
    resetTimer(newMode);
  };

  // ... (El resto de tus funciones de cambio de duración y el renderizado se mantienen igual)
  
  const handleWorkDurationChange = (mins) => {
    setWorkDuration(mins);
    if (mode === 'work') {
      setSecondsLeft(mins * 60);
      setIsRunning(false);
      setIsComplete(false);
    }
  };

  const handleBreakDurationChange = (mins) => {
    setBreakDuration(mins);
    if (mode === 'break') {
      setSecondsLeft(mins * 60);
      setIsRunning(false);
      setIsComplete(false);
    }
  };

  const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const seconds = (secondsLeft % 60).toString().padStart(2, '0');

  const radius = 130;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="timer-container">
      {/* Mode Toggle */}
      <div className="mode-toggle">
        <button className={`mode-btn ${mode === 'work' ? 'active' : ''}`} onClick={() => handleModeChange('work')}>Trabajo</button>
        <button className={`mode-btn ${mode === 'break' ? 'active' : ''}`} onClick={() => handleModeChange('break')}>Descanso</button>
      </div>

      {/* Duration Selectors */}
      <div className="duration-selectors">
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

      {/* Timer Circle */}
      <div className="timer-circle-wrapper">
        <svg className="timer-svg" viewBox="0 0 300 300">
          <circle className="circle-bg" cx="150" cy="150" r={radius} fill="none" strokeWidth="6" />
          <circle
            className={`circle-progress ${isComplete ? 'complete' : ''}`}
            cx="150" cy="150" r={radius} fill="none" strokeWidth="6" strokeLinecap="round"
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
              <span className="time-label">{mode === 'work' ? `+${workDuration} pts al finalizar` : 'Descanso'}</span>
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="timer-controls">
        {!isRunning && !isComplete && (
          <button className="btn-primary large" onClick={handleStart}>
            {secondsLeft < totalSeconds ? 'Reanudar' : 'Iniciar'}
          </button>
        )}
        {isRunning && <button className="btn-secondary large" onClick={handlePause}>Pausar</button>}
        {isComplete && <button className="btn-primary large" onClick={() => resetTimer()}>Nueva sesión</button>}
        {(isRunning || (!isComplete && secondsLeft < totalSeconds)) && (
          <button className="btn-ghost" onClick={handleCancel}>Cancelar</button>
        )}
      </div>

      {/* Points History */}
      {isComplete && mode === 'work' && (
        <div className="points-earned">
          <span className="points-earned-icon">⬡</span>
          <span>+{workDuration} puntos acreditados</span>
        </div>
      )}

      {sessionHistory.length > 0 && (
        <div className="session-history">
          <p className="history-title">Sesiones de hoy</p>
          {sessionHistory.map((s, i) => (
            <div key={i} className="history-item">
              <span>✓ {s.minutos} min completados</span>
              <span className="history-time">{s.hora}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
