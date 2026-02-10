import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase' // Cambio de ruta: antes estaba en la raíz
import Auth from './components/Auth'     // Cambio de ruta: ahora está en src/components
import Timer from './components/Timer'   // Cambio de ruta
import Store from './components/Store'   // Cambio de ruta

export default function App() {
  const [session, setSession] = useState(null)
  const [perfil, setPerfil] = useState(null)
  const [puntos, setPuntos] = useState(0)
  const [activeTab, setActiveTab] = useState('timer')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Obtener sesión inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchOrCreatePerfil(session.user.id)
      else setLoading(false)
    })

    // Escuchar cambios de autenticación
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
      .single()

    if (error && error.code === 'PGRST116') {
      const { data: newPerfil, error: insertError } = await supabase
        .from('perfiles')
        .insert({ user_id: userId, puntos_totales: 0 })
        .select()
        .single()

      if (!insertError) {
        data = newPerfil
      }
    }

    if (data) {
      setPerfil(data)
      setPuntos(data.puntos_totales)
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

  if (!session) {
    return <Auth />
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="logo-icon">⬡</span>
          <span className="logo-text">FOCVS</span>
        </div>
        <div className="header-center">
          <nav className="main-nav">
            <button
              className={`nav-btn ${activeTab === 'timer' ? 'active' : ''}`}
              onClick={() => setActiveTab('timer')}
            >
              Temporizador
            </button>
            <button
              className={`nav-btn ${activeTab === 'store' ? 'active' : ''}`}
              onClick={() => setActiveTab('store')}
            >
              Tienda
            </button>
          </nav>
        </div>
        <div className="header-right">
          <div className="points-badge">
            <span className="points-icon">⬡</span>
            <span className="points-value">{puntos}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Cerrar sesión">
            ↩
          </button>
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'timer' && (
          <Timer
            userId={session.user.id}
            puntos={puntos}
            setPuntos={setPuntos}
          />
        )}
        {activeTab === 'store' && (
          <Store
            userId={session.user.id}
            puntos={puntos}
            setPuntos={setPuntos}
          />
        )}
      </main>
    </div>
  )
}
