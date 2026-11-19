import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root'))

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  root.render(
    <div style={{ padding: 24, color: '#eee', fontFamily: 'sans-serif' }}>
      <h2>Configuración incompleta</h2>
      <p>Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY en las variables de entorno de Netlify. Agréguelas y vuelva a desplegar.</p>
    </div>,
  )
} else {
  import('./App.jsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}
