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
  }, [isRunning, mode, workDuration, acreditarPuntos]);

  const handleStart = () => { if (!isComplete) setIsRunning(true); };
  const handlePause = () => { setIsRunning(false); clearInterval(intervalRef.current); localStorage.removeItem('pomodoro_end_time'); };
  const handleCancel = () => resetTimer();
  const handleModeChange = (newMode) => { setMode(newMode); resetTimer(newMode); };

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
    <div className="flex flex-col items-center w-full max-w-md mx-auto p-4">
      {/* Selectores de Modo Centrados */}
      <div className="flex justify-center gap-4 mb-8 w-full">
        <button 
          className={`px-6 py-2 rounded-full font-medium transition-all ${mode === 'work' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}
          onClick={() => handleModeChange('work')}
        >
          Trabajo
        </button>
        <button 
          className={`px-6 py-2 rounded-full font-medium transition-all ${mode === 'break' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}
          onClick={() => handleModeChange('break')}
        >
          Descanso
        </button>
      </div>

      {/* Selectores de Tiempo Centrados */}
      <div className="flex justify-center flex-wrap gap-2 mb-10 w-full">
        {(mode === 'work' ? WORK_SESSIONS : BREAK_SESSIONS).map(m => (
          <button 
            key={m} 
            className={`w-14 h-10 rounded-xl border transition-all ${
              (mode === 'work' ? workDuration : breakDuration) === m 
              ? 'border-orange-500 bg-orange-500/10 text-orange-500' 
              : 'border-slate-800 text-slate-500 hover:border-slate-700'
            }`}
            onClick={() => mode === 'work' ? handleWorkDurationChange(m) : handleBreakDurationChange(m)}
            disabled={isRunning}
          >
            {m}m
          </button>
        ))}
      </div>

      {/* Círculo del Timer */}
      <div className="relative flex items-center justify-center mb-10">
        <svg className="w-64 h-64 transform -rotate-90">
          <circle cx="128" cy="128" r={radius - 10} fill="none" stroke="#1e293b" strokeWidth="6" />
          <circle
            cx="128" cy="128" r={radius - 10} fill="none" stroke={mode === 'work' ? '#ea580c' : '#2563eb'}
            strokeWidth="6" strokeLinecap="round" strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset} className="transition-all duration-1000"
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          {isComplete ? (
            <span className="text-5xl text-green-500">✓</span>
          ) : (
            <>
              <span className="text-5xl font-bold text-white tracking-tighter">{minutes}:{seconds}</span>
              <span className="text-xs text-slate-500 mt-2 uppercase tracking-widest">
                {mode === 'work' ? `+${workDuration} pts` : 'Relax'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Controles */}
      <div className="flex flex-col gap-3 w-full px-8">
        {!isRunning && !isComplete && (
          <button className="bg-white text-black py-4 rounded-2xl font-bold text-lg hover:bg-slate-200 transition-colors" onClick={handleStart}>
            {secondsLeft < totalSeconds ? 'REANUDAR' : 'INICIAR'}
          </button>
        )}
        {isRunning && (
