import React, { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import Auth from './components/Auth'
import Timer from './components/Timer'
import Store from './components/Store'
import Stats from './components/Stats'

export default function App() {
  const [session,  setSession]  = useState(null)
  const [perfil,   setPerfil]   = useState(null)
  const [puntos,   setPuntos]   = useState(0)
  const [activeTab, setActiveTab] = useState('timer')
  const [loading,  setLoading]  = useState(true)
  const [pointsAnim, setPointsAnim] = useState(false)
  const prevPuntosRef = useRef(0)

  // Animar badge cuando suben puntos
  useEffect(() => {
    if (puntos > prevPuntosRef.current) {
      setPointsAnim(true)
      const t = setTimeout(() => setPointsAnim(false), 600)
      return () => clearTimeout(t)
    }
    prevPuntosRef.current = puntos
  }, [puntos])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchOrCreatePerfil(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchOrCreatePerfil(session.user.id)
      else {
        setPerfil(null)
        setPuntos(0)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchOrCreatePerfil = async (userId) => {
    setLoading(true)
    let { data, error } = await supabase
      .from('perfiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (!data && !error) {
      const { data: newPerfil, error: insertError } = await supabase
        .from('perfiles')
        .insert({ user_id: userId, puntos_totales: 0, meta_diaria_minutos: 120 })
        .select()
        .maybeSingle()
      if (!insertError) data = newPerfil
    }

    if (data) {
      setPerfil(data)
      setPuntos(data.puntos_totales)
      prevPuntosRef.current = data.puntos_totales
    }
    setLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner">
          <span className="logo-icon spin">⬡</span>
        </div>
      </div>
    )
  }

  if (!session) return <Auth />

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="logo-icon">⬡</span>
          <span className="logo-text">FOCVS</span>
        </div>

        <div className="header-center">
          <nav className="main-nav">
            {[
              { id: 'timer', label: 'Temporizador' },
              { id: 'store', label: 'Tienda'       },
              { id: 'stats', label: 'Estadísticas' },
            ].map(({ id, label }) => (
              <button
                key={id}
                className={`nav-btn ${activeTab === id ? 'active' : ''}`}
                onClick={() => setActiveTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="header-right">
          <div className={`points-badge ${pointsAnim ? 'points-pop' : ''}`}>
            <span className="points-icon">⬡</span>
            <span className="points-value">{puntos}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Cerrar sesión">↩</button>
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'timer' && (
          <Timer
            userId={session.user.id}
            puntos={puntos}
            setPuntos={setPuntos}
            metaDiaria={perfil?.meta_diaria_minutos ?? 120}
            onUpdateMeta={async (mins) => {
              setPerfil(p => ({ ...p, meta_diaria_minutos: mins }))
              await supabase.from('perfiles').update({ meta_diaria_minutos: mins }).eq('user_id', session.user.id)
            }}
          />
        )}
        {activeTab === 'store' && (
          <Store userId={session.user.id} puntos={puntos} setPuntos={setPuntos} />
        )}
        {activeTab === 'stats' && (
          <Stats userId={session.user.id} />
        )}
      </main>
    </div>
  )
}
