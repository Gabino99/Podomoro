import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rangoDe, ENERGIAS } from '../lib/juego'
import { horaCorta, textoEnMinutos } from '../lib/useAgenda'

// Cuenta regresiva del combo (mm:ss).
function useRestante(hasta) {
  const [ahora, setAhora] = useState(Date.now())
  useEffect(() => {
    if (!hasta) return
    const iv = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [hasta])
  if (!hasta) return null
  const s = Math.max(0, Math.round((new Date(hasta).getTime() - ahora) / 1000))
  return s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : null
}

// Panel de personaje: nivel, XP, misiones de hoy, combo, racha, escudos y energía.
export default function Hud({ juego, puntos, nombre, refrescar, agenda }) {
  const restante = useRestante(juego?.combo > 1 ? juego.combo_vence : null)
  const [eligiendo, setEligiendo] = useState(false)
  if (!juego) return null

  const r = rangoDe(juego.nivel)
  const pct = Math.min(100, Math.round((juego.xp_nivel / juego.xp_siguiente) * 100))
  const comboActivo = juego.combo > 1 && restante
  const energia = ENERGIAS.find(e => e.id === juego.energia)

  const ponerEnergia = async (id) => {
    setEligiendo(false)
    const { error } = await supabase.rpc('registrar_energia', { p_energia: id })
    if (!error) refrescar()
  }

  return (
    <div className="hud">
      <div className="hud-principal">
        <div className="hud-avatar" title={r.nombre}>
          <span>{r.avatar}</span>
          <b>NV {juego.nivel}</b>
        </div>
        <div className="hud-info">
          <div className="hud-nombre">{nombre}</div>
          <div className="hud-rango">{juego.rango}</div>
          <div className="hud-xp" title={`${juego.xp_total} XP en total`}>
            <div className="hud-xp-fill" style={{ width: `${pct}%` }} />
            <span>{juego.xp_nivel} / {juego.xp_siguiente} XP</span>
          </div>
        </div>
        <div className="hud-stats">
          <div className="hud-stat"><small>Hoy</small><b>{juego.hoy}</b></div>
          <div className={`hud-stat ${comboActivo ? 'caliente' : ''}`} title={comboActivo ? 'Complete otra misión antes de que se acabe el tiempo' : 'Complete misiones seguidas (menos de 45 min entre una y otra)'}>
            <small>Combo</small><b>×{comboActivo ? juego.combo : 1}</b>{comboActivo && <em>{restante}</em>}
          </div>
          <div className="hud-stat"><small>Racha</small><b>{juego.racha}{juego.racha > 0 ? ' 🔥' : ''}</b></div>
        </div>
      </div>

      <div className="hud-chips">
        {energia && !eligiendo
          ? <button className="hud-chip" onClick={() => setEligiendo(true)} title="Cambiar">{energia.emoji} {energia.nombre}</button>
          : (
            <div className="hud-energia">
              <span>¿Cómo está su energía ahora?</span>
              {ENERGIAS.map(e => <button key={e.id} onClick={() => ponerEnergia(e.id)}>{e.emoji} {e.id}</button>)}
            </div>
          )}
        {agenda?.enCurso && (
          <span className="hud-chip evento ahora" title="Evento en curso en su calendario">🔴 Ahora: {agenda.enCurso.titulo} (hasta {horaCorta(agenda.enCurso.fin)})</span>
        )}
        {agenda?.proximo && (
          <span className={`hud-chip evento ${agenda.ventana <= 15 ? 'pronto' : ''}`} title="Próximo evento de su Google Calendar">
            📅 {agenda.proximo.titulo} {agenda.ventana < 180
              ? `${textoEnMinutos(agenda.ventana)} (${horaCorta(agenda.proximo.inicio)})`
              : `a las ${horaCorta(agenda.proximo.inicio)}`}
          </span>
        )}
        <span className="hud-chip" title="Tapan días sin actividad para no perder la racha (máx. 3)">🛡️ {juego.escudos} escudo{juego.escudos === 1 ? '' : 's'}</span>
        {juego.dobles > 0 && <span className="hud-chip dorado">✨ Próxima misión ×2</span>}
        <span className="hud-chip">⬡ {Math.floor(puntos)} pts</span>
      </div>
    </div>
  )
}

export function Avisos({ avisos }) {
  if (!avisos.length) return null
  return (
    <div className="avisos">
      {avisos.map(a => <div key={a.id} className={`aviso aviso-${a.tipo}`}>{a.texto}</div>)}
    </div>
  )
}
