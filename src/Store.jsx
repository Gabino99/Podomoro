import { useState } from 'react'
import { supabase } from '../lib/supabase'

const PREMIOS = [
  { id: 1, nombre: 'Jugar Clash Royale', descripcion: '30 minutos de juego', costo: 240, emoji: '⚔️' },
  { id: 2, nombre: 'Salir a Ococa', descripcion: 'Una salida merecida', costo: 500, emoji: '🌿' },
  { id: 3, nombre: 'Una cerveza', descripcion: 'Bien fría y merecida', costo: 180, emoji: '🍺' },
  { id: 4, nombre: 'Jugar videojuegos', descripcion: 'Sesión libre de gaming', costo: 500, emoji: '🎮' },
  { id: 5, nombre: 'Redes sociales', descripcion: '30 minutos de scroll', costo: 240, emoji: '📱' },
  { id: 6, nombre: 'Premio Especial', descripcion: 'Cariño ❤️', costo: 500, emoji: '💝' },
]

export default function Store({ userId, puntos, setPuntos }) {
  const [confirmando, setConfirmando] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [mensaje, setMensaje] = useState(null)
  const [canjesHistory, setCanjesHistory] = useState([])

  const canjearPuntos = async (premio) => {
    if (puntos < premio.costo) {
      setMensaje({ tipo: 'error', texto: `Necesitas ${premio.costo - puntos} puntos más para este premio.` })
      setTimeout(() => setMensaje(null), 3000)
      setConfirmando(null)
      return
    }

    setCargando(true)
    try {
      const nuevosPuntos = puntos - premio.costo

      // Actualizar puntos en base de datos
      const { error: updateError } = await supabase
        .from('perfiles')
        .update({ puntos_totales: nuevosPuntos })
        .eq('user_id', userId)

      if (updateError) throw updateError

      // Registrar el canje
      await supabase.from('canjes').insert({
        user_id: userId,
        premio_nombre: premio.nombre,
        puntos_usados: premio.costo,
      })

      setPuntos(nuevosPuntos)
      setCanjesHistory(prev => [{ nombre: premio.nombre, costo: premio.costo, hora: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)])
      setMensaje({ tipo: 'exito', texto: `¡Disfrutá tu ${premio.nombre}! 🎉` })
      setTimeout(() => setMensaje(null), 4000)
    } catch (err) {
      setMensaje({ tipo: 'error', texto: 'Error al canjear. Intentá de nuevo.' })
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
            <div key={premio.id} className={`prize-card ${!puedeCanjear ? 'disabled' : ''} ${esConfirmando ? 'confirming' : ''}`}>
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
                    >
                      {cargando ? '...' : '✓'}
                    </button>
                    <button
                      className="btn-cancel-small"
                      onClick={() => setConfirmando(null)}
                      disabled={cargando}
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

      {canjesHistory.length > 0 && (
        <div className="canje-history">
          <p className="history-title">Canjes recientes</p>
          {canjesHistory.map((c, i) => (
            <div key={i} className="history-item">
              <span>✓ {c.nombre} (−{c.costo} pts)</span>
              <span className="history-time">{c.hora}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
