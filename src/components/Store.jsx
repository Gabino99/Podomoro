import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { PREMIOS } from '../lib/constants'
import { diasHasta } from '../lib/fechas'

const EMOJIS = ['🎁', '✈️', '🏖️', '🍺', '🎮', '📱', '🍕', '🎬', '🛍️', '💝', '⚔️', '🌿']
const FORM_VACIO = { nombre: '', descripcion: '', emoji: '🎁', costo: '', fecha_limite: '', recurrente: true }

function Formulario({ inicial, onGuardar, onCancelar, guardando }) {
  const [f, setF] = useState(inicial)
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  const costo = parseInt(f.costo, 10)
  const valido = f.nombre.trim().length > 0 && costo >= 1 && costo <= 100000

  const enviar = (e) => {
    e.preventDefault()
    if (!valido) return
    onGuardar({
      nombre:       f.nombre.trim(),
      descripcion:  f.descripcion.trim() || null,
      emoji:        f.emoji,
      costo,
      fecha_limite: f.fecha_limite || null,
      recurrente:   f.recurrente,
    })
  }

  return (
    <form className="reward-form" onSubmit={enviar}>
      <div className="emoji-picker">
        {EMOJIS.map(e => (
          <button type="button" key={e}
            className={`emoji-opt ${f.emoji === e ? 'active' : ''}`}
            onClick={() => set('emoji', e)}>{e}</button>
        ))}
      </div>
      <input className="reward-input" placeholder="Nombre (ej. Viaje a la playa)" maxLength={60}
        value={f.nombre} onChange={e => set('nombre', e.target.value)} autoFocus />
      <input className="reward-input" placeholder="Descripción (opcional)" maxLength={140}
        value={f.descripcion} onChange={e => set('descripcion', e.target.value)} />
      <div className="reward-row">
        <label className="reward-label">Puntos necesarios
          <input className="reward-input" type="number" min="1" max="100000" placeholder="1000"
            value={f.costo} onChange={e => set('costo', e.target.value)} />
        </label>
        <label className="reward-label">Fecha límite (opcional)
          <input className="reward-input" type="date"
            value={f.fecha_limite || ''} onChange={e => set('fecha_limite', e.target.value)} />
        </label>
      </div>
      <label className="reward-check">
        <input type="checkbox" checked={f.recurrente} onChange={e => set('recurrente', e.target.checked)} />
        Se puede repetir (si no, se marca como cumplida al canjearla)
      </label>
      <div className="reward-actions">
        <button type="button" className="btn-secondary" onClick={onCancelar} disabled={guardando}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={!valido || guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

function Plazo({ fecha, falta }) {
  const dias = diasHasta(fecha)
  if (dias === null) return null
  if (dias < 0)  return <p className="prize-deadline vencida">⏰ Venció hace {-dias} día{dias === -1 ? '' : 's'}</p>
  if (dias === 0) return <p className="prize-deadline">⏰ Es hoy{falta > 0 ? ` · faltan ${falta} pts` : ''}</p>
  const porDia = falta > 0 ? Math.ceil(falta / dias) : 0
  return (
    <p className="prize-deadline">
      ⏰ {dias} día{dias === 1 ? '' : 's'}{porDia > 0 ? ` · ~${porDia} min/día` : ' · ¡ya alcanza!'}
    </p>
  )
}

export default function Store({ userId, puntos, setPuntos, recompensas, cargando, error, crear, actualizar, borrar, canjear }) {
  const [confirmando, setConfirmando] = useState(null)  // id a canjear
  const [borrando,    setBorrando]    = useState(null)  // id a borrar
  const [editando,    setEditando]    = useState(null)  // recompensa | 'nueva' | null
  const [ocupado,     setOcupado]     = useState(false)
  const [mensaje,     setMensaje]     = useState(null)
  const [historial,   setHistorial]   = useState([])

  const cargarHistorial = async () => {
    const { data } = await supabase
      .from('canjes')
      .select('premio_nombre, puntos_usados, creado_en')
      .eq('user_id', userId)
      .order('creado_en', { ascending: false })
      .limit(5)
    if (data) setHistorial(data)
  }
  useEffect(() => { cargarHistorial() }, [userId])

  const showMsg = (tipo, texto, ms = 4000) => {
    setMensaje({ tipo, texto })
    setTimeout(() => setMensaje(null), ms)
  }

  const guardar = async (campos) => {
    setOcupado(true)
    const r = editando === 'nueva' ? await crear(campos) : await actualizar(editando.id, campos)
    setOcupado(false)
    if (r.ok) { setEditando(null); showMsg('exito', editando === 'nueva' ? 'Recompensa creada ✨' : 'Cambios guardados') }
    else showMsg('error', r.mensaje)
  }

  const hacerCanje = async (rec) => {
    setOcupado(true)
    const r = await canjear(rec.id)
    setOcupado(false)
    setConfirmando(null)
    if (r.ok) {
      setPuntos(r.puntosRestantes)
      showMsg('exito', `¡Disfrute: ${r.nombre}! 🎉`)
      cargarHistorial()
    } else showMsg('error', r.mensaje)
  }

  const hacerBorrado = async (rec) => {
    setOcupado(true)
    const r = await borrar(rec.id)
    setOcupado(false)
    setBorrando(null)
    if (!r.ok) showMsg('error', r.mensaje)
  }

  const cargarEjemplos = async () => {
    setOcupado(true)
    const r = await crear(PREMIOS.map(p => ({
      nombre: p.nombre, descripcion: p.descripcion, emoji: p.emoji, costo: p.costo, recurrente: true,
    })))
    setOcupado(false)
    if (!r.ok) showMsg('error', r.mensaje)
  }

  return (
    <div className="store-container">
      <div className="store-header">
        <h2 className="store-title">Mis recompensas</h2>
        <div className="store-balance">
          <span className="balance-icon">⬡</span>
          <span className="balance-amount">{puntos}</span>
          <span className="balance-label">puntos</span>
        </div>
      </div>

      {mensaje && <div className={`store-message ${mensaje.tipo}`}>{mensaje.texto}</div>}
      {error && <div className="store-message error">{error}</div>}

      {editando ? (
        <Formulario
          inicial={editando === 'nueva' ? FORM_VACIO : {
            nombre: editando.nombre, descripcion: editando.descripcion || '', emoji: editando.emoji,
            costo: String(editando.costo), fecha_limite: editando.fecha_limite || '', recurrente: editando.recurrente,
          }}
          onGuardar={guardar} onCancelar={() => setEditando(null)} guardando={ocupado}
        />
      ) : (
        <button className="btn-primary reward-new" onClick={() => setEditando('nueva')}>+ Nueva recompensa</button>
      )}

      {cargando ? (
        <p className="store-empty">Cargando…</p>
      ) : recompensas.length === 0 && !editando ? (
        <div className="store-empty">
          <p>Aún no tiene recompensas. Cree la primera: un viaje, una salida, lo que lo motive.</p>
          <button className="btn-secondary" onClick={cargarEjemplos} disabled={ocupado}>
            O cargar las recompensas de ejemplo
          </button>
        </div>
      ) : (
        <div className="prizes-grid">
          {recompensas.map(rec => {
            const falta = rec.costo - puntos
            const puede = falta <= 0
            return (
              <div key={rec.id} className={`prize-card ${!puede ? 'disabled' : ''} ${confirmando === rec.id ? 'confirming' : ''}`}>
                <div className="prize-top">
                  <div className="prize-emoji">{rec.emoji}</div>
                  <div className="prize-tools">
                    <button className="btn-ghost small" title="Editar" onClick={() => setEditando(rec)}>✎</button>
                    <button className="btn-ghost small" title="Borrar" onClick={() => setBorrando(rec.id)}>🗑</button>
                  </div>
                </div>
                <div className="prize-info">
                  <h3 className="prize-name">{rec.nombre}</h3>
                  {rec.descripcion && <p className="prize-desc">{rec.descripcion}</p>}
                  {!rec.recurrente && <p className="prize-desc">🎯 Meta de una sola vez</p>}
                  <Plazo fecha={rec.fecha_limite} falta={falta} />
                </div>

                {borrando === rec.id ? (
                  <div className="prize-footer">
                    <span className="prize-desc">¿Borrar?</span>
                    <div className="confirm-actions">
                      <button className="btn-confirm" onClick={() => hacerBorrado(rec)} disabled={ocupado}>✓</button>
                      <button className="btn-cancel-small" onClick={() => setBorrando(null)} disabled={ocupado}>✕</button>
                    </div>
                  </div>
                ) : (
                  <div className="prize-footer">
                    <span className="prize-cost"><span className="cost-icon">⬡</span> {rec.costo}</span>
                    {confirmando === rec.id ? (
                      <div className="confirm-actions">
                        <button className="btn-confirm" onClick={() => hacerCanje(rec)} disabled={ocupado} title="Confirmar">
                          {ocupado ? <span className="btn-spinner" /> : '✓'}
                        </button>
                        <button className="btn-cancel-small" onClick={() => setConfirmando(null)} disabled={ocupado}>✕</button>
                      </div>
                    ) : (
                      <button className={`btn-canjear ${!puede ? 'locked' : ''}`} disabled={!puede}
                        onClick={() => setConfirmando(rec.id)}>
                        {puede ? 'Canjear' : `Faltan ${falta}`}
                      </button>
                    )}
                  </div>
                )}

                {!puede && (
                  <div className="prize-progress-bar">
                    <div className="prize-progress-fill" style={{ width: `${Math.min((puntos / rec.costo) * 100, 100)}%` }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {historial.length > 0 && (
        <div className="canje-history">
          <p className="history-title">Canjes recientes</p>
          {historial.map((c, i) => (
            <div key={i} className="history-item">
              <span>✓ {c.premio_nombre} (−{c.puntos_usados} pts)</span>
              <span className="history-time">
                {new Date(c.creado_en).toLocaleDateString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
