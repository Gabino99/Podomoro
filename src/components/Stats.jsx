import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart, Area, Cell
} from 'recharts'

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function formatDay(dateStr) {
  const d = new Date(dateStr)
  return DAYS_ES[d.getDay()]
}
function formatDate(dateStr) {
  const d = new Date(dateStr)
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]}`
}
function getLast7Days() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    d.setHours(0, 0, 0, 0)
    return d.toISOString().split('T')[0]
  })
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: '#1a1a1a', border: '1px solid #f59e0b44',
        borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#fff'
      }}>
        <p style={{ margin: 0, color: '#888', fontSize: 11, marginBottom: 4 }}>{label}</p>
        {payload.map((p, i) => (
          <p key={i} style={{ margin: 0, color: '#f59e0b', fontWeight: 600 }}>
            {p.value} {p.name}
          </p>
        ))}
      </div>
    )
  }
  return null
}

function StatCard({ label, value, unit, sub, color = '#f59e0b' }) {
  return (
    <div style={{
      background: '#111', border: '1px solid #222', borderRadius: 14,
      padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 4,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${color}88, transparent)`
      }} />
      <span style={{ fontSize: 11, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
        {unit && <span style={{ fontSize: 13, color: '#666' }}>{unit}</span>}
      </div>
      {sub && <span style={{ fontSize: 11, color: '#444', marginTop: 2 }}>{sub}</span>}
    </div>
  )
}

export default function Stats({ userId }) {
  const [sesiones, setSesiones] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('semana')

  useEffect(() => {
    if (!userId) {
      setError('No se encontró el usuario.')
      setLoading(false)
      return
    }

    const fetchSesiones = async () => {
      setLoading(true)
      setError(null)

      const since = new Date()
      since.setDate(since.getDate() - 30)
      const sinceStr = since.toISOString()

      const { data, error: fetchError } = await supabase
        .from('sesiones')
        .select('id, duracion_minutos, tipo, completada, creado_en')
        .eq('user_id', userId)
        .gte('creado_en', sinceStr)
        .order('creado_en', { ascending: true })

      if (fetchError) {
        setError(`Error al cargar: ${fetchError.message}`)
        setLoading(false)
        return
      }

      // Filtrar en el cliente para evitar problemas con filtros booleanos
      const sesionesFiltradas = (data || []).filter(
        s => s.completada === true && s.tipo === 'trabajo'
      )

      setSesiones(sesionesFiltradas)
      setLoading(false)
    }

    fetchSesiones()
  }, [userId])

  const weekData = useMemo(() => {
    const days = getLast7Days()
    return days.map(day => {
      const daySessions = sesiones.filter(s => s.creado_en.startsWith(day))
      const minutos = daySessions.reduce((acc, s) => acc + s.duracion_minutos, 0)
      return {
        dia: formatDay(day),
        fecha: formatDate(day),
        minutos,
        sesiones: daySessions.length,
        isToday: day === new Date().toISOString().split('T')[0]
      }
    })
  }, [sesiones])

  const hourData = useMemo(() => {
    const hours = Array.from({ length: 20 }, (_, h) => ({
      hora: `${h + 4}h`, minutos: 0
    }))
    sesiones.forEach(s => {
      const h = new Date(s.creado_en).getHours()
      if (h >= 4) hours[h - 4].minutos += s.duracion_minutos
    })
    return hours
  }, [sesiones])

  const last30Data = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (29 - i))
      const day = d.toISOString().split('T')[0]
      const minutos = sesiones
        .filter(s => s.creado_en.startsWith(day))
        .reduce((acc, s) => acc + s.duracion_minutos, 0)
      return { dia: `${d.getDate()}/${d.getMonth() + 1}`, minutos }
    })
  }, [sesiones])

  const stats = useMemo(() => {
    const hoy = new Date().toISOString().split('T')[0]
    const minutosHoy = sesiones
      .filter(s => s.creado_en.startsWith(hoy))
      .reduce((acc, s) => acc + s.duracion_minutos, 0)

    const bestDay = weekData.reduce(
      (best, d) => d.minutos > best.minutos ? d : best,
      { minutos: 0, dia: '-' }
    )

    let streak = 0
    for (let i = 0; i < 30; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const day = d.toISOString().split('T')[0]
      if (sesiones.some(s => s.creado_en.startsWith(day))) streak++
      else if (i > 0) break
    }

    const peakHour = hourData.reduce(
      (best, h) => h.minutos > best.minutos ? h : best,
      { minutos: 0, hora: '-' }
    )

    return { minutosHoy, bestDay, streak, peakHour }
  }, [sesiones, weekData, hourData])

  const ORANGE = '#f59e0b'

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#555', fontSize: 14 }}>
      Cargando estadísticas...
    </div>
  )

  if (error) return (
    <div style={{ color: '#ef4444', textAlign: 'center', padding: 40, fontSize: 14 }}>
      {error}
    </div>
  )

  return (
    <div style={{
      padding: '28px 24px', maxWidth: 860, margin: '0 auto',
      fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", color: '#fff',
    }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
          Tu concentración
        </h2>
        <p style={{ fontSize: 13, color: '#555', margin: '4px 0 0' }}>
          Basado en tus sesiones completadas
        </p>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12, marginBottom: 28,
      }}>
        <StatCard label="Hoy" value={stats.minutosHoy} unit="min" sub="minutos de foco" />
        <StatCard label="Racha actual" value={stats.streak} unit="días" sub="días consecutivos" color="#22d3ee" />
        <StatCard label="Mejor día" value={stats.bestDay.dia} sub={`${stats.bestDay.minutos} min`} color="#a78bfa" />
        <StatCard label="Hora pico" value={stats.peakHour.hora} sub="más productivo" color="#34d399" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['semana', 'horas', 'racha'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: tab === t ? ORANGE : 'transparent',
            color: tab === t ? '#000' : '#555',
            border: `1px solid ${tab === t ? ORANGE : '#2a2a2a'}`,
            borderRadius: 20, padding: '5px 16px', fontSize: 12,
            fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase',
            transition: 'all 0.2s',
          }}>
            {t === 'semana' ? '7 días' : t === 'horas' ? 'Por hora' : '30 días'}
          </button>
        ))}
      </div>

      <div style={{
        background: '#0d0d0d', border: '1px solid #1e1e1e',
        borderRadius: 16, padding: '24px 16px 12px',
      }}>
        {tab === 'semana' && (
          <>
            <p style={{ fontSize: 12, color: '#444', margin: '0 0 16px 8px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Minutos de foco — últimos 7 días
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekData} barSize={28}>
                <XAxis dataKey="dia" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} formatter={(v) => [`${v} min`, 'Foco']} labelFormatter={(_, p) => p[0]?.payload?.fecha} />
                <Bar dataKey="minutos" radius={[6, 6, 0, 0]}>
                  {weekData.map((entry, i) => (
                    <Cell key={i}
                      fill={entry.isToday ? ORANGE : entry.minutos > 0 ? '#3a2a00' : '#1a1a1a'}
                      stroke={entry.isToday ? ORANGE : 'transparent'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', justifyContent: 'space-around', padding: '12px 8px 0' }}>
              {weekData.map((d, i) => (
                <span key={i} style={{ fontSize: 10, color: d.isToday ? '#22d3ee' : '#444', textAlign: 'center' }}>
                  {d.sesiones > 0 ? `${d.sesiones}×` : '—'}
                </span>
              ))}
            </div>
          </>
        )}

        {tab === 'horas' && (
          <>
            <p style={{ fontSize: 12, color: '#444', margin: '0 0 16px 8px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Distribución horaria — últimos 30 días
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourData} barSize={16}>
                <CartesianGrid vertical={false} stroke="#1a1a1a" />
                <XAxis dataKey="hora" tick={{ fill: '#555', fontSize: 10 }} axisLine={false} tickLine={false} interval={1} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} formatter={(v) => [`${v} min`, 'Foco']} />
                <Bar dataKey="minutos" radius={[4, 4, 0, 0]}>
                  {hourData.map((entry, i) => {
                    const intensity = Math.min(entry.minutos / 120, 1)
                    return (
                      <Cell key={i}
                        fill={entry.minutos > 0
                          ? `rgb(${Math.round(245 * intensity)},${Math.round(158 * intensity)},${Math.round(11 * intensity)})`
                          : '#1a1a1a'}
                      />
                    )
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p style={{ fontSize: 11, color: '#333', textAlign: 'center', marginTop: 8 }}>
              Más brillante = más minutos concentrado
            </p>
          </>
        )}

        {tab === 'racha' && (
          <>
            <p style={{ fontSize: 12, color: '#444', margin: '0 0 16px 8px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Minutos de foco — últimos 30 días
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={last30Data}>
                <defs>
                  <linearGradient id="focusGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={ORANGE} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={ORANGE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#1a1a1a" />
                <XAxis dataKey="dia" tick={{ fill: '#555', fontSize: 9 }} axisLine={false} tickLine={false} interval={4} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} formatter={(v) => [`${v} min`, 'Foco']} />
                <Area type="monotone" dataKey="minutos" stroke={ORANGE} strokeWidth={2}
                  fill="url(#focusGrad)" dot={false}
                  activeDot={{ r: 4, fill: ORANGE, stroke: '#000', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {sesiones.length === 0 && (
        <p style={{ textAlign: 'center', color: '#333', fontSize: 13, marginTop: 24 }}>
          Completá tu primera sesión para ver tus gráficos 🎯
        </p>
      )}
    </div>
  )
}
