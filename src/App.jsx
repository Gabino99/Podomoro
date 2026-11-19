import React, { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import Auth from './components/Auth'
import Timer from './components/Timer'
import Store from './components/Store'
import Stats from './components/Stats'
import Misiones from './components/Misiones'
import { useRecompensas } from './lib/useRecompensas'
import { llamarTodoist } from './lib/todoist'
import { useJuego } from './lib/useJuego'
import './juego.css'
import Hud, { Avisos } from './components/Hud'
import { useAgenda } from './lib/useAgenda'

// Misión amarrada al pomodoro (Modo enfoque). Se guarda para que sobreviva a recargar.
const leerMisionFoco = () => {
  try { return JSON.parse(localStorage.getItem('focus_mision') || 'null') } catch { return null }
}

export default function App() {
  const [session,  setSession]  = useState(null)
  const [perfil,   setPerfil]   = useState(null)
  const [puntos,   setPuntos]   = useState(0)
  const [activeTab, setActiveTab] = useState('misiones')
  const [loading,  setLoading]  = useState(true)
  const [pointsAnim, setPointsAnim] = useState(false)
  const [errorMeta, setErrorMeta] = useState(null)
  const prevPuntosRef = useRef(0)
  const usuarioRef = useRef(null) // usuario cuyo perfil ya se cargó
  const [misionFoco, setMisionFoco] = useState(leerMisionFoco)
  const [inicioFoco, setInicioFoco] = useState(0)

  useEffect(() => {
    try {
      if (misionFoco) localStorage.setItem('focus_mision', JSON.stringify(misionFoco))
      else localStorage.removeItem('focus_mision')
    } catch { /* sin almacenamiento */ }
  }, [misionFoco])

  const datosMision = ({ id, contenido, proyecto, proyecto_id, prioridad, duracion, due, zombi }) =>
    ({ id, contenido, proyecto, proyecto_id, prioridad, duracion, due, zombi: !!zombi })

  // Desde el Temporizador: amarra la misión pero no arranca (usted le da Iniciar).
  const elegirMision = (t) => setMisionFoco(datosMision(t))

  const enfocar = (t) => {
    setMisionFoco(datosMision(t))
    setInicioFoco(n => n + 1)
    setActiveTab('timer')
  }

  // "¿La terminó?" → Sí: se completa en Todoist y el servidor suma los puntos.
  const terminarMision = async (m) => {
    const r = await llamarTodoist('complete', { id: m.id, esperado: m.due?.date || null })
    if (typeof r?.puntos_totales === 'number') setPuntos(r.puntos_totales)
    celebrarResultado(r)
    refrescarJuego()
    return r
  }
  const recompensasApi = useRecompensas(session?.user?.id)
  const { juego, refrescar: refrescarJuego, celebrar, celebrarResultado, avisos } = useJuego(session?.user?.id)
  const agenda = useAgenda(!!session)

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

    // Supabase avisa SIGNED_IN / TOKEN_REFRESHED cada vez que la pestaña vuelve
    // a tener foco. Solo se recarga el perfil si cambió el usuario; si no, la
    // pantalla de carga desmontaba Misiones y el Temporizador a media acción.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        if (session.user.id !== usuarioRef.current) fetchOrCreatePerfil(session.user.id)
      } else {
        usuarioRef.current = null
        setPerfil(null)
        setPuntos(0)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchOrCreatePerfil = async (userId) => {
    usuarioRef.current = userId
    setLoading(true)
    let { data, error } = await supabase
      .from('perfiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    let fallo = error
    if (!data && !error) {
      const { data: newPerfil, error: insertError } = await supabase
        .from('perfiles')
        .insert({ user_id: userId, puntos_totales: 0, meta_diaria_minutos: 120 })
        .select()
        .maybeSingle()
      if (insertError) fallo = insertError
      else data = newPerfil
    }

    if (data) {
      setPerfil(data)
      setPuntos(data.puntos_totales)
      prevPuntosRef.current = data.puntos_totales
    } else if (fallo) {
      console.error('No se pudo cargar el perfil', fallo)
      setErrorMeta('No se pudo cargar su perfil. Revise la conexión y recargue la página.')
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
          <span className="logo-text">FOCUS</span>
        </div>

        <div className="header-center">
          <nav className="main-nav">
            {[
              { id: 'misiones', label: 'Misiones' },
              { id: 'timer', label: 'Temporizador' },
              { id: 'store', label: 'Recompensas'  },
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
            <span className="points-value">{Math.floor(puntos)}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Cerrar sesión">Salir</button>
        </div>
      </header>

      <main className="app-main">
        <Hud juego={juego} puntos={puntos} refrescar={refrescarJuego} agenda={agenda}
          nombre={(session.user.user_metadata?.nombre || session.user.email || '').split('@')[0]} />
        <Avisos avisos={avisos} />
        {errorMeta && (
          <div className="error-message">{errorMeta}
            <button className="btn-ghost small" onClick={() => setErrorMeta(null)}>✕</button>
          </div>
        )}
        {activeTab === 'misiones' && (
          <Misiones puntos={puntos} setPuntos={setPuntos} onEnfocar={enfocar}
            juego={juego} refrescarJuego={refrescarJuego} celebrar={celebrar} celebrarResultado={celebrarResultado} agenda={agenda} />
        )}
        {/* El Temporizador nunca se desmonta: si termina mientras está en otra
            pestaña, la sesión igual se guarda y suma sus puntos. */}
        <div style={{ display: activeTab === 'timer' ? 'contents' : 'none' }}>
          <Timer
            activo={activeTab === 'timer'}
            mision={misionFoco}
            inicioFoco={inicioFoco}
            onTerminarMision={terminarMision}
            onSoltarMision={() => setMisionFoco(null)}
            onElegirMision={elegirMision}
            onSesionGuardada={(r) => { celebrarResultado(r); refrescarJuego() }}
            proximoEvento={agenda.proximo}
            ventana={agenda.ventana}
            userId={session.user.id}
            puntos={puntos}
            setPuntos={setPuntos}
            recompensas={recompensasApi.recompensas}
            reglas={juego?.reglas}
            metaDiaria={perfil?.meta_diaria_minutos ?? 120}
            onUpdateMeta={async (mins) => {
              const { error } = await supabase.rpc('actualizar_meta_diaria', {
                p_user_id: session.user.id, p_meta: mins,
              })
              if (error) { setErrorMeta('No se pudo guardar la meta diaria.'); return }
              setPerfil(p => ({ ...p, meta_diaria_minutos: mins }))
            }}
          />
        </div>
        {activeTab === 'store' && (
          <Store userId={session.user.id} puntos={puntos} setPuntos={setPuntos} refrescarJuego={refrescarJuego} {...recompensasApi} />
        )}
        {activeTab === 'stats' && (
          <Stats userId={session.user.id} juego={juego} />
        )}
      </main>
    </div>
  )
}
