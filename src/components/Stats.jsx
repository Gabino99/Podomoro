import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORIAS } from '../lib/constants'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart, Area, Cell,
} from 'recharts'

const TZ = 'America/Costa_Rica'

// Convierte un timestamp UTC de Supabase a fecha local CR (YYYY-MM-DD)
function toLocalDate(utcStr) {
  return new Date(utcStr).toLocaleDateString('en-CA', { timeZone: TZ }) // en-CA = YYYY-MM-DD
}
// Hora local CR (0-23)
function toLocalHour(utcStr) {
  return parseInt(new Date(utcStr).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }))
}
const DAYS_ES   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function formatDay(dateStr) {
  const dayIdx = new Date(dateStr + 'T12:00:00').getDay()
  return DAYS_ES[dayIdx]
}
function formatDate(dateStr) {
  const [, m, d] = dateStr.split('-')
  return `${parseInt(d)} ${MONTHS_ES[parseInt(m) - 1]}`
}

function getLast7Days() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    d.setHours(0, 0, 0, 0)
    return d.toLocaleDateString('en-CA', { timeZone: TZ })
  })
}

const ORANGE = '#f59e0b'

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="stats-tooltip">
        <p className="stats-tooltip-label">{label}</p>
        {payload.map((p, i) => (
          <p key={i} className="stats-tooltip-value">{p.value} {p.name}</p>
        ))}
      </div>
    )
  }
  return null
}

function StatCard({ label, value, unit, sub, color = ORANGE }) {
  return (
    <div className="stat-card">
      <div className="stat-card-accent" style={{ background: `linear-gradient(90deg, ${color}88, transparent)` }} />
      <span className="stat-card-label">{label}</span>
      <div className="stat-card-value-row">
        <span className="stat-card-value" style={{ color }}>{value}</span>
        {unit && <span className="stat-card-unit">{unit}</span>}
      </div>
      {sub && <span className="stat-card-sub">{sub}</span>}
    </div>
  )
}

// ── Export CSV ────────────────────────────────────────────
function exportCSV(sesiones) {
  const header = 'fecha,duracion_minutos,tipo,categoria,nota'
  const rows   = sesiones.map(s =>
    [s.created_at?.slice(0, 19), s.duracion_minutos, s.tipo, s.categoria ?? '', (s.nota ?? '').replace(/,/g, ';')].join(',')
  )
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `focvs-sesiones-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Componente principal ──────────────────────────────────
export default function Stats({ userId }) {
  const [sesiones, setSesiones]       = useState([])
  const [loading,  setLoading]        = useState(true)
  const [error,    setError]          = useState(null)
  const [tab,      setTab]            = useState('semana')
  const [catFilter, setCatFilter]     = useState('todas')
  const [allSesiones, setAllSesiones] = useState([]) // sin filtro de cat para export

  useEffect(() => {
    if (!userId) { setError('No se encontró el usuario.'); setLoading(false); return }

    const fetchSesiones = async () => {
      setLoading(true); setError(null)

      // FIX: la columna se llama created_at, no created_at
      const { data, error: fetchError } = await supabase
        .from('sesiones')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })

      if (fetchError) { setError(`Error al cargar: ${fetchError.message}`); setLoading(false); return }

      const hace30 = new Date()
      hace30.setDate(hace30.getDate() - 30)

      const filtradas = (data || []).filter(s =>
        s.completada === true &&
        s.tipo === 'trabajo' &&
        new Date(s.created_at) >= hace30
      )

      setAllSesiones(filtradas)
      setSesiones(filtradas)
      setLoading(false)
    }

    fetchSesiones()
  }, [userId])

  // Filtrar por categoría
  useEffect(() => {
    if (catFilter === 'todas') setSesiones(allSesiones)
    else setSesiones(allSesiones.filter(s => s.categoria === catFilter))
  }, [catFilter, allSesiones])

  const weekData = useMemo(() => {
    return getLast7Days().map(day => {
      const ds = sesiones.filter(s => toLocalDate(s.created_at) === day)
      return {
        dia: formatDay(day), fecha: formatDate(day),
        minutos: ds.reduce((a, s) => a + s.duracion_minutos, 0),
        sesiones: ds.length,
        isToday: day === new Date().toLocaleDateString('en-CA', { timeZone: TZ }),
      }
    })
  }, [sesiones])

  const hourData = useMemo(() => {
    const hours = Array.from({ length: 20 }, (_, h) => ({ hora: `${h + 4}h`, minutos: 0 }))
    sesiones.forEach(s => {
      const h = toLocalHour(s.created_at)
      if (h >= 4 && h < 24) hours[h - 4].minutos += s.duracion_minutos
    })
    return hours
  }, [sesiones])

  const last30Data = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (29 - i))
      const day = d.toLocaleDateString('en-CA', { timeZone: TZ })
      const [, m, dd] = day.split('-')
      return {
        dia: `${parseInt(dd)}/${parseInt(m)}`,
        minutos: sesiones.filter(s => toLocalDate(s.created_at) === day).reduce((a, s) => a + s.duracion_minutos, 0),
      }
    })
  }, [sesiones])

  const catData = useMemo(() => {
    const map = {}
    allSesiones.forEach(s => {
      const cat = s.categoria || 'general'
      map[cat] = (map[cat] || 0) + s.duracion_minutos
    })
    return Object.entries(map)
      .map(([cat, min]) => ({ cat, min, info: CATEGORIAS.find(c => c.id === cat) }))
      .sort((a, b) => b.min - a.min)
  }, [allSesiones])

  const stats = useMemo(() => {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
    const minutosHoy = sesiones.filter(s => toLocalDate(s.created_at) === hoy).reduce((a, s) => a + s.duracion_minutos, 0)
    const bestDay    = weekData.reduce((b, d) => d.minutos > b.minutos ? d : b, { minutos: 0, dia: '-' })
    let streak = 0
    for (let i = 0; i < 30; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const day = d.toLocaleDateString('en-CA', { timeZone: TZ })
      if (allSesiones.some(s => toLocalDate(s.created_at) === day)) streak++
      else if (i > 0) break
    }
    const peakHour = hourData.reduce((b, h) => h.minutos > b.minutos ? h : b, { minutos: 0, hora: '-' })
    const totalMin  = allSesiones.reduce((a, s) => a + s.duracion_minutos, 0)
    return { minutosHoy, bestDay, streak, peakHour, totalMin }
  }, [sesiones, allSesiones, weekData, hourData])

  if (loading) return (
    <div className="stats-loading">Cargando estadísticas...</div>
  )

  if (error) return (
    <div className="stats-error">{error}</div>
  )

  const CAT_COLORS = ['#f59e0b','#22d3ee','#a78bfa','#34d399','#f87171']

  return (
    <div className="stats-container">
      <div className="stats-header">
        <div>
          <h2 className="stats-title">Tu concentración</h2>
          <p className="stats-subtitle">Basado en tus sesiones completadas (últimos 30 días)</p>
        </div>
        <button className="stats-export-btn" onClick={() => exportCSV(allSesiones)} title="Descargar historial como CSV">
          ↓ Exportar CSV
        </button>
      </div>

      <div className="stats-cards-grid">
        <StatCard label="Hoy"         value={stats.minutosHoy}    unit="min"  sub="minutos de foco" />
        <StatCard label="Racha"       value={stats.streak}        unit="días" sub="días consecutivos" color="#22d3ee" />
        <StatCard label="Mejor día"   value={stats.bestDay.dia}              sub={`${stats.bestDay.minutos} min`} color="#a78bfa" />
        <StatCard label="Hora pico"   value={stats.peakHour.hora}            sub="más productivo"   color="#34d399" />
        <StatCard label="Total 30d"   value={Math.round(stats.totalMin / 60)} unit="h" sub={`${stats.totalMin} min totales`} color="#f87171" />
      </div>

      {catData.length > 0 && (
        <div className="stats-panel stats-cat-panel">
          <p className="stats-panel-title">Por categoría — últimos 30 días</p>
          {catData.map(({ cat, min, info }, i) => {
            const pct = Math.round((min / stats.totalMin) * 100) || 0
            return (
              <div key={cat} className="stats-cat-row">
                <div className="stats-cat-header">
                  <span className="stats-cat-name">{info?.emoji ?? '📌'} {info?.label ?? cat}</span>
                  <span className="stats-cat-value" style={{ color: CAT_COLORS[i % CAT_COLORS.length] }}>{min} min ({pct}%)</span>
                </div>
                <div className="stats-bar-track">
                  <div className="stats-bar-fill" style={{ width: `${pct}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="stats-filter-row">
        <button className={`stats-filter-btn ${catFilter === 'todas' ? 'active' : ''}`} onClick={() => setCatFilter('todas')}>Todas</button>
        {CATEGORIAS.map(c => (
          <button key={c.id} className={`stats-filter-btn ${catFilter === c.id ? 'active' : ''}`} onClick={() => setCatFilter(c.id)}>
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      <div className="stats-tab-row">
        {['semana','horas','racha'].map(t => (
          <button key={t} className={`stats-tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'semana' ? '7 días' : t === 'horas' ? 'Por hora' : '30 días'}
          </button>
        ))}
      </div>

      <div className="stats-panel">
        {tab === 'semana' && (
          <>
            <p className="stats-panel-title">Minutos de foco — últimos 7 días</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekData} barSize={28}>
                <XAxis dataKey="dia" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} formatter={v => [`${v} min`, 'Foco']} labelFormatter={(_, p) => p[0]?.payload?.fecha} />
                <Bar dataKey="minutos" radius={[6,6,0,0]}>
                  {weekData.map((e, i) => (
                    <Cell key={i}
                      fill={e.isToday ? ORANGE : e.minutos > 0 ? '#3a2a00' : '#1a1a1a'}
                      stroke={e.isToday ? ORANGE : 'transparent'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="stats-week-counts">
              {weekData.map((d, i) => (
                <span key={i} className={d.isToday ? 'today' : ''}>
                  {d.sesiones > 0 ? `${d.sesiones}×` : '—'}
                </span>
              ))}
            </div>
          </>
        )}

        {tab === 'horas' && (
          <>
            <p className="stats-panel-title">Distribución horaria — últimos 30 días</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourData} barSize={16}>
                <CartesianGrid vertical={false} stroke="#1a1a1a" />
                <XAxis dataKey="hora" tick={{ fill: '#555', fontSize: 10 }} axisLine={false} tickLine={false} interval={1} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} formatter={v => [`${v} min`, 'Foco']} />
                <Bar dataKey="minutos" radius={[4,4,0,0]}>
                  {hourData.map((e, i) => {
                    const intensity = Math.min(e.minutos / 120, 1)
                    return (
                      <Cell key={i}
                        fill={e.minutos > 0
                          ? `rgb(${Math.round(245*intensity)},${Math.round(158*intensity)},${Math.round(11*intensity)})`
                          : '#1a1a1a'}
                      />
                    )
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="stats-hint">Más brillante = más minutos concentrado</p>
          </>
        )}

        {tab === 'racha' && (
          <>
            <p className="stats-panel-title">Minutos de foco — últimos 30 días</p>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={last30Data}>
                <defs>
                  <linearGradient id="focusGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={ORANGE} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={ORANGE} stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#1a1a1a" />
                <XAxis dataKey="dia" tick={{ fill: '#555', fontSize: 9 }} axisLine={false} tickLine={false} interval={4} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} formatter={v => [`${v} min`, 'Foco']} />
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
        <p className="stats-empty">
          {catFilter !== 'todas' ? 'No hay sesiones en esta categoría aún.' : 'Completá tu primera sesión para ver tus gráficos 🎯'}
        </p>
      )}
    </div>
  )
}
