import React, { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root'))

const Pantalla = ({ titulo, detalle }) => (
  <div style={{ padding: 24, color: '#eee', fontFamily: 'sans-serif', maxWidth: 640, margin: '0 auto' }}>
    <h2>{titulo}</h2>
    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, background: '#1a1a1d', padding: 12, borderRadius: 8 }}>{detalle}</pre>
    <button onClick={() => location.reload()} style={{ padding: '8px 14px' }}>Recargar</button>
    <button
      onClick={() => { try { localStorage.clear(); sessionStorage.clear() } catch { /* nada */ } location.reload() }}
      style={{ padding: '8px 14px', marginLeft: 8 }}
    >Borrar datos locales y recargar</button>
  </div>
)

class Limite extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('La app falló al renderizar', error, info) }
  render() {
    if (this.state.error) {
      const e = this.state.error
      return <Pantalla titulo="La app tuvo un error" detalle={`${e?.message || e}\n\n${(e?.stack || '').split('\n').slice(0, 6).join('\n')}`} />
    }
    return this.props.children
  }
}

const mostrar = (titulo, e) => root.render(<Pantalla titulo={titulo} detalle={`${e?.message || e}`} />)

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  mostrar('Configuración incompleta', 'Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY en las variables de entorno de Netlify. Agréguelas y vuelva a desplegar.')
} else {
  import('./App.jsx')
    .then(({ default: App }) => {
      root.render(<StrictMode><Limite><App /></Limite></StrictMode>)
    })
    .catch(e => mostrar('No se pudo cargar la app', e))
}

window.addEventListener('unhandledrejection', ev => console.error('Promesa rechazada', ev.reason))
