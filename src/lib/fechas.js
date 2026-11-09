// Fecha local de Costa Rica (YYYY-MM-DD), sin importar la zona del dispositivo.
// Evita el error de usar toISOString(), que da la fecha UTC y "salta" al día
// siguiente a partir de las 6 p. m. en Costa Rica.
const formato = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' })

export function fechaCR(fecha = new Date()) {
  return formato.format(typeof fecha === 'string' ? new Date(fecha) : fecha)
}

export function diasHasta(fechaISO) {
  if (!fechaISO) return null
  const hoy = new Date(fechaCR() + 'T00:00:00')
  const meta = new Date(fechaISO + 'T00:00:00')
  return Math.round((meta - hoy) / 86400000)
}
