import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { PREMIOS } from '../lib/constants'

export default function Store({ userId, puntos, setPuntos }) {
  const [confirmando,    setConfirmando]    = useState(null)
  const [cargando,       setCargando]       = useState(false)
  const [mensaje,        setMensaje]        = useState(null)
  const [canjesHistory,  setCanjesHistory]  = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  // Cargar historial reciente de canjes al montar
  useEffect(() => {
    const fetchHistory = async () => {
      setLoadingHistory(true)
      const { data } = await supabase
        .from('canjes')
        .select('premio_nombre, puntos_usados, creado_en')
        .eq('user_id', userId)
        .order('creado_en', { ascending: false })
        .limit(5)

      if (data) {
        setCanjesHistory(data.map(c => ({
          nombre: c.premio_nombre,
          costo: c.puntos_usados,
          hora: new Date(c.creado_en).toLocaleDateString('es', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
          }),
        })))
      }
      setLoadingHistory(false)
    }
    fetchHistory()
  }, [userId])

  const showMsg = (tipo, texto, duracion = 4000) => {
    setMensaje({ tipo, texto })
    setTimeout(() => setMensaje(null), duracion)
  }

  const canjearPuntos = async (premio) => {
    if (puntos < premio.costo) {
      showMsg('error', `Necesitás ${premio.costo - puntos} puntos más para este premio.`, 3000)
      setConfirmando(null)
      return
    }

    setCargando(true)
    try {
      // Usar la función RPC atómica para evitar race conditions
      const { data, error } = await supabase.rpc('canjear_puntos', {
        p_user_id: userId,
        p_costo:   premio.costo,
        p_premio:  premio.nombre,
      })

      if (error) throw error

      if (!data.exito) {
        showMsg('error', data.mensaje || 'Puntos insuficientes.')
        setCargando(false)
        setConfirmando(null)
        return
      }

      const nuevosPuntos = data.puntos_restantes
      setPuntos(nuevosPuntos)

      const hora = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
      setCanjesHistory(prev => [
        { nombre: premio.nombre, costo: premio.costo, hora },
        ...prev.slice(0, 4),
      ])

      showMsg('exito', `¡Disfrutá tu ${premio.nombre}! 🎉`)
    } catch (err) {
      showMsg('error', 'Error al canjear. Intentá de nuevo.')
      console.error(err)
    } finally {
      setCargando(false)
      setConfirmando(null)
    }
  }

  return (
    <div className="store-container">
      <div className="store-header">
        <h2 className="store-title">Tienda de Recompensas</h2>
        <div className="store-balance">
          <span className="balance-icon">⬡</span>
          <span className="balance-amount">{puntos}</span>
          <span className="balance-label">puntos</span>
        </div>
      </div>

      {mensaje && (
        <div className={`store-message ${mensaje.tipo}`}>
          {mensaje.texto}
        </div>
      )}

      <div className="prizes-grid">
        {PREMIOS.map(premio => {
          const puedeCanjear = puntos >= premio.costo
          const esConfirmando = confirmando?.id === premio.id

          return (
            <div
              key={premio.id}
              className={`prize-card ${!puedeCanjear ? 'disabled' : ''} ${esConfirmando ? 'confirming' : ''}`}
            >
              <div className="prize-emoji">{premio.emoji}</div>
              <div className="prize-info">
                <h3 className="prize-name">{premio.nombre}</h3>
                <p className="prize-desc">{premio.descripcion}</p>
              </div>
              <div className="prize-footer">
                <span className="prize-cost">
                  <span className="cost-icon">⬡</span> {premio.costo}
                </span>

                {esConfirmando ? (
                  <div className="confirm-actions">
                    <button
                      className="btn-confirm"
                      onClick={() => canjearPuntos(premio)}
                      disabled={cargando}
                      title="Confirmar canje"
                    >
                      {cargando ? <span className="btn-spinner" /> : '✓'}
                    </button>
                    <button
                      className="btn-cancel-small"
                      onClick={() => setConfirmando(null)}
                      disabled={cargando}
                      title="Cancelar"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    className={`btn-canjear ${!puedeCanjear ? 'locked' : ''}`}
                    onClick={() => puedeCanjear && setConfirmando(premio)}
                    disabled={!puedeCanjear}
                  >
                    {puedeCanjear ? 'Canjear' : `Faltan ${premio.costo - puntos}`}
                  </button>
                )}
              </div>

              {!puedeCanjear && (
                <div className="prize-progress-bar">
                  <div
                    className="prize-progress-fill"
                    style={{ width: `${Math.min((puntos / premio.costo) * 100, 100)}%` }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Historial */}
      {(canjesHistory.length > 0 || loadingHistory) && (
        <div className="canje-history">
          <p className="history-title">Canjes recientes</p>
          {loadingHistory ? (
            <p style={{ color: '#444', fontSize: 13 }}>Cargando...</p>
          ) : (
            canjesHistory.map((c, i) => (
              <div key={i} className="history-item">
                <span>✓ {c.nombre} (−{c.costo} pts)</span>
                <span className="history-time">{c.hora}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
