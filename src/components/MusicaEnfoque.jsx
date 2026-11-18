import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// "https://open.spotify.com/playlist/ID" → { tipo, id }. Solo enlaces que ya validó el servidor.
export function partesSpotify(url) {
  const m = String(url ?? '').match(/^https:\/\/open\.spotify\.com\/(playlist|album|artist|show)\/([A-Za-z0-9]{10,40})$/)
  return m ? { tipo: m[1], id: m[2] } : null
}

export const AUTO_SPOTIFY = 'focus_spotify_auto'
export const leerAutoSpotify = () => { try { return localStorage.getItem(AUTO_SPOTIFY) === 'true' } catch { return false } }

// Abre la playlist en la app de Spotify (escritorio o celular). Debe llamarse desde un clic o una tecla.
export function abrirEnSpotify(url) {
  const p = partesSpotify(url)
  if (!p) return
  const a = document.createElement('a')
  a.href = `spotify:${p.tipo}:${p.id}`
  a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
}

// Música de enfoque: reproductor de Spotify incrustado (sirve con cuenta gratis o Premium).
// Vive dentro del Temporizador, que nunca se desmonta: la música sigue aunque cambie de pestaña.
export default function MusicaEnfoque({ url, onGuardada }) {
  const [editando, setEditando] = useState(!url)
  const [texto, setTexto] = useState(url ?? '')
  const [error, setError] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [auto, setAuto] = useState(leerAutoSpotify)
  const p = partesSpotify(url)
  // Si la playlist llega después (el perfil carga más tarde), mostrar el reproductor.
  useEffect(() => { if (url) { setTexto(url); setEditando(false) } }, [url])

  const guardar = async () => {
    setGuardando(true); setError(null)
    const { data, error: e } = await supabase.rpc('guardar_spotify', { p_url: texto.trim() })
    setGuardando(false)
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    if (!data?.exito) { setError(data?.mensaje || 'Ese enlace no sirve.'); return }
    onGuardada?.(data.spotify_url)
    setEditando(!data.spotify_url)
  }

  const cambiarAuto = (v) => { setAuto(v); try { localStorage.setItem(AUTO_SPOTIFY, String(v)) } catch { /* sin almacenamiento */ } }

  return (
    <div className="musica">
      <div className="musica-titulo">🎵 Música de enfoque</div>
      {p && !editando ? (
        <>
          <iframe
            title="Spotify"
            className="musica-player"
            src={`https://open.spotify.com/embed/${p.tipo}/${p.id}?utm_source=generator&theme=0`}
            height="152"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
          />
          <div className="musica-fila">
            <button onClick={() => abrirEnSpotify(url)}>▶ Abrir en la app de Spotify</button>
            <label><input type="checkbox" checked={auto} onChange={e => cambiarAuto(e.target.checked)} /> Abrirla sola en Modo enfoque</label>
            <button className="musica-cambiar" onClick={() => { setTexto(url); setEditando(true) }}>Cambiar</button>
          </div>
        </>
      ) : (
        <div className="musica-editar">
          <p>Pegue el enlace de una playlist de Spotify (en Spotify: ⋯ → Compartir → Copiar enlace).</p>
          <div className="musica-fila">
            <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="https://open.spotify.com/playlist/…"
              onKeyDown={e => e.key === 'Enter' && guardar()} />
            <button onClick={guardar} disabled={guardando || !texto.trim()}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            {url && <button className="musica-cambiar" onClick={() => setEditando(false)}>Cancelar</button>}
          </div>
          {error && <div className="musica-error">{error}</div>}
        </div>
      )}
    </div>
  )
}
