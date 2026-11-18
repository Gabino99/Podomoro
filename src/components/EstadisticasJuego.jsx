import React, { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { INSIGNIAS } from '../lib/juego'

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const fechaCorta = (d) => { const [, m, dia] = String(d).split('-'); return `${parseInt(dia)} ${MESES[parseInt(m) - 1]}` }
const hora12 = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`

function Pista({ active, payload, label, unidad = 'XP' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="stats-tooltip">
      <p className="stats-tooltip-label">{label}</p>
      <p className="stats-tooltip-value">{payload[0].value} {unidad}</p>
    </div>
  )
}

// Insignias, XP por día, mejores horas y proyectos (datos del servidor).
export default function EstadisticasJuego({ juego }) {
  const [datos, setDatos] = useState(null)

  useEffect(() => {
    let vivo = true
    supabase.rpc('estadisticas_juego', { p_dias: 30 }).then(({ data, error }) => { if (vivo && !error) setDatos(data) })
    return () => { vivo = false }
  }, [juego?.xp_total])

  if (!juego) return null
  const ganadas = new Map((juego.insignias ?? []).map(i => [i.id, i.fecha]))
  const xpDia = (datos?.xp_por_dia ?? []).map(d => ({ dia: fechaCorta(d.dia), xp: d.xp }))
  const horas = (datos?.por_hora ?? []).map(h => ({ hora: hora12(h.hora), xp: h.xp }))
  const mejorHora = [...(datos?.por_hora ?? [])].sort((a, b) => b.xp - a.xp)[0]
  const proyectos = datos?.por_proyecto ?? []
  const maxProy = Math.max(1, ...proyectos.map(p => p.puntos))

  return (
    <div className="juego-stats">
      <div className="stats-panel">
        <p className="stats-panel-title">🏅 Insignias — {ganadas.size} de {INSIGNIAS.length}</p>
        <div className="insignias">
          {INSIGNIAS.map(i => (
            <div key={i.id} className={`insignia ${ganadas.has(i.id) ? 'ganada' : ''}`}
              title={`${i.desc}${ganadas.has(i.id) ? ' · ganada el ' + new Date(ganadas.get(i.id)).toLocaleDateString('es-CR') : ''}`}>
              <span>{ganadas.has(i.id) ? i.emoji : '🔒'}</span>
              <b>{i.nombre}</b>
              <small>{i.desc}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="stats-panel">
        <p className="stats-panel-title">⭐ XP por día — últimos 30 días</p>
        {xpDia.length ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={xpDia} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="dia" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<Pista />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="xp" fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="juego-vacio">Todavía no hay XP en este periodo.</p>}
      </div>

      <div className="juego-dos">
        <div className="stats-panel">
          <p className="stats-panel-title">🕐 Sus mejores horas{mejorHora ? ` — pico: ${hora12(mejorHora.hora)}` : ''}</p>
          {horas.length ? (
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={horas} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="hora" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<Pista />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="xp" fill="#22d3ee" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="juego-vacio">Sin datos todavía.</p>}
        </div>

        <div className="stats-panel">
          <p className="stats-panel-title">🗺️ Proyectos donde más avanza</p>
          {proyectos.length ? proyectos.map(p => (
            <div key={p.proyecto} className="stats-cat-row">
              <div className="stats-cat-header">
                <span className="stats-cat-name">{p.proyecto}</span>
                <span className="stats-cat-value">{p.puntos} pts · {p.misiones} misiones</span>
              </div>
              <div className="stats-bar-track"><div className="stats-bar-fill" style={{ width: `${(p.puntos / maxProy) * 100}%`, background: '#f59e0b' }} /></div>
            </div>
          )) : <p className="juego-vacio">Complete misiones para ver sus proyectos.</p>}
        </div>
      </div>
    </div>
  )
}
