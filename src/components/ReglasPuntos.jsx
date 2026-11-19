import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Qué se configura y cómo se llama en pantalla. Los rangos y los valores
// recomendados vienen del servidor (reglas_juego), que también valida al guardar.
const GRUPOS = [
  { titulo: 'Enfoque', campos: [
    { clave: 'min_enfoque', etiqueta: 'Puntos por minuto concentrado', paso: 0.5 },
  ] },
  { titulo: 'Misiones', campos: [
    { clave: 'mision_base',    etiqueta: 'Misión completada', paso: 1 },
    { clave: 'mision_vencida', etiqueta: 'Jefe vencido (total)', paso: 1 },
    { clave: 'mision_zombi',   etiqueta: 'Tarea zombi (total)', paso: 1 },
  ] },
  { titulo: 'Bonos', campos: [
    { clave: 'combo_max',        etiqueta: 'Combo máximo (×)', paso: 0.5 },
    { clave: 'cofre_mas',        etiqueta: 'Cofre de puntos', paso: 1 },
    { clave: 'cofre_legendario', etiqueta: 'Cofre legendario', paso: 1 },
    { clave: 'jefe_proyecto',    etiqueta: 'Derrotar jefe de proyecto', paso: 1 },
    { clave: 'tope_bonos',       etiqueta: 'Tope diario de bonos', paso: 1, ayuda: '0 = sin tope. No aplica al enfoque.' },
  ] },
  { titulo: 'Retos del día', campos: [
    { clave: 'reto_misiones_3', etiqueta: '3 misiones', paso: 1 },
    { clave: 'reto_jefe_1',     etiqueta: '1 jefe vencido', paso: 1 },
    { clave: 'reto_enfoque_25', etiqueta: '25 min de enfoque', paso: 1 },
    { clave: 'reto_misiones_6', etiqueta: '6 misiones', paso: 1 },
  ] },
]
const CAMPOS = GRUPOS.flatMap(g => g.campos)

export default function ReglasPuntos({ onCambio }) {
  const [abierto, setAbierto]   = useState(false)
  const [cfg, setCfg]           = useState(null)      // { valores, defectos, rangos }
  const [texto, setTexto]       = useState({})        // lo que se escribe, por clave
  const [ocupado, setOcupado]   = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [mensaje, setMensaje]   = useState(null)

  const aplicar = (c) => {
    setCfg(c)
    setTexto(Object.fromEntries(CAMPOS.map(f => [f.clave, String(c.valores[f.clave])])))
  }

  useEffect(() => {
    if (!abierto || cfg) return
    supabase.rpc('reglas_juego').then(({ data, error }) => {
      if (error || !data) setMensaje({ tipo: 'error', texto: 'No se pudieron cargar las reglas. ¿Ya corrió el schema.sql nuevo?' })
      else aplicar(data)
    })
  }, [abierto, cfg])

  const numero = (clave) => (texto[clave] === '' || texto[clave] == null ? NaN : Number(texto[clave]))
  const fueraDeRango = (clave) => {
    const [min, max] = cfg.rangos[clave]
    const n = numero(clave)
    return !(n >= min && n <= max)
  }
  const hayError = cfg && CAMPOS.some(f => fueraDeRango(f.clave))
  const sinCambios = cfg && CAMPOS.every(f => numero(f.clave) === Number(cfg.valores[f.clave]))

  const avisar = (tipo, t) => { setMensaje({ tipo, texto: t }); setTimeout(() => setMensaje(null), 4000) }

  const enviar = async (reglas, okTexto) => {
    setOcupado(true)
    const { data, error } = await supabase.rpc('guardar_reglas', { p_reglas: reglas })
    setOcupado(false)
    if (error || !data?.exito) { avisar('error', error?.message || 'No se pudo guardar.'); return }
    aplicar({ ...cfg, valores: data.valores })
    avisar('exito', okTexto)
    onCambio?.()
  }

  const guardar = () => enviar(Object.fromEntries(CAMPOS.map(f => [f.clave, numero(f.clave)])), 'Reglas guardadas ✨')
  const restablecer = async () => { setConfirmar(false); await enviar({}, 'Volvió a los valores recomendados') }

  return (
    <div className="reglas-panel">
      <button className="reglas-toggle" onClick={() => setAbierto(a => !a)} aria-expanded={abierto}>
        ⚙️ Reglas de puntos <span>{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div className="reglas-cuerpo">
          {mensaje && <div className={`store-message ${mensaje.tipo}`}>{mensaje.texto}</div>}
          {!cfg && !mensaje && <p className="store-empty">Cargando…</p>}
          {cfg && (
            <>
              <p className="reglas-nota">
                Cada minuto concentrado vale lo que ponga abajo; el resto son bonos. Los cambios aplican
                a lo que gane de ahora en adelante: su saldo y su historial no se tocan.
              </p>
              {GRUPOS.map(g => (
                <fieldset key={g.titulo} className="reglas-grupo">
                  <legend>{g.titulo}</legend>
                  {g.campos.map(f => {
                    const [min, max] = cfg.rangos[f.clave]
                    const mal = fueraDeRango(f.clave)
                    return (
                      <label key={f.clave} className="reglas-fila">
                        <span className="reglas-etq">
                          {f.etiqueta}
                          <small>recomendado: {cfg.defectos[f.clave]}{f.ayuda ? ` · ${f.ayuda}` : ''}</small>
                        </span>
                        <input className={`reward-input reglas-input ${mal ? 'mal' : ''}`} type="number"
                          inputMode="decimal" min={min} max={max} step={f.paso}
                          value={texto[f.clave] ?? ''} aria-invalid={mal}
                          title={`Entre ${min} y ${max}`}
                          onChange={e => setTexto(t => ({ ...t, [f.clave]: e.target.value }))} />
                      </label>
                    )
                  })}
                </fieldset>
              ))}
              <div className="reward-actions">
                {confirmar ? (
                  <>
                    <span className="prize-desc">¿Volver a los valores recomendados?</span>
                    <button className="btn-secondary" onClick={() => setConfirmar(false)} disabled={ocupado}>No</button>
                    <button className="btn-primary" onClick={restablecer} disabled={ocupado}>Sí, restablecer</button>
                  </>
                ) : (
                  <>
                    <button className="btn-secondary" onClick={() => setConfirmar(true)} disabled={ocupado}>Valores recomendados</button>
                    <button className="btn-primary" onClick={guardar} disabled={ocupado || hayError || sinCambios}>
                      {ocupado ? 'Guardando…' : 'Guardar'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
