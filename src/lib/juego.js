// Textos e íconos del juego. Las reglas y los puntos viven en el servidor
// (schema.sql v6); aquí solo está lo que se muestra.

export const RANGOS = [
  { desde: 15, nombre: 'Leyenda',   avatar: '👑' },
  { desde: 10, nombre: 'Paladín',   avatar: '🦁' },
  { desde: 6,  nombre: 'Caballero', avatar: '⚔️' },
  { desde: 3,  nombre: 'Escudero',  avatar: '🛡️' },
  { desde: 1,  nombre: 'Aprendiz',  avatar: '🧑‍🎓' },
]
export const rangoDe = (nivel = 1) => RANGOS.find(r => nivel >= r.desde) ?? RANGOS.at(-1)

export const INSIGNIAS = [
  { id: 'primer_paso',  emoji: '👣', nombre: 'Primer paso',   desc: 'Complete su primera misión' },
  { id: 'misiones_25',  emoji: '🥉', nombre: '25 misiones',   desc: 'Complete 25 misiones' },
  { id: 'misiones_100', emoji: '🥇', nombre: '100 misiones',  desc: 'Complete 100 misiones' },
  { id: 'racha_3',      emoji: '🔥', nombre: 'Racha de 3',    desc: '3 días seguidos con actividad' },
  { id: 'racha_7',      emoji: '🌋', nombre: 'Racha de 7',    desc: '7 días seguidos con actividad' },
  { id: 'racha_30',     emoji: '☄️', nombre: 'Racha de 30',   desc: '30 días seguidos con actividad' },
  { id: 'jefes_10',     emoji: '👹', nombre: 'Cazajefes',     desc: 'Derrote 10 jefes vencidos' },
  { id: 'combo_x3',     emoji: '⚡', nombre: 'Combo ×3',      desc: 'Llegue al combo máximo' },
  { id: 'enfoque_300',  emoji: '🧘', nombre: '300 min de enfoque', desc: 'Acumule 300 minutos de pomodoro' },
  { id: 'vaciados_5',   emoji: '🌴', nombre: '5 vaciados',    desc: 'Deje el tablero de hoy en cero 5 días' },
  { id: 'cazazombis',   emoji: '🧟', nombre: 'Cazazombis',    desc: 'Termine una tarea zombi' },
  { id: 'matadragones', emoji: '🐉', nombre: 'Matadragones',  desc: 'Derrote a un jefe de proyecto' },
  { id: 'madrugador',   emoji: '🌅', nombre: 'Madrugador',    desc: 'Complete una misión antes de las 7:30 am' },
  { id: 'dia_perfecto', emoji: '💎', nombre: 'Día perfecto',  desc: 'Cobre los 4 retos de un mismo día' },
  { id: 'suertudo',     emoji: '🍀', nombre: 'Suertudo',      desc: 'Abra un cofre legendario' },
  { id: 'hiperfoco_10', emoji: '🎯', nombre: '10 de Hiperfoco', desc: 'Complete 10 misiones con 🎯 Hiperfoco' },
  { id: 'nivel_10',     emoji: '🏰', nombre: 'Nivel 10',      desc: 'Llegue al nivel 10 (Paladín)' },
]
export const insignia = (id) => INSIGNIAS.find(i => i.id === id) ?? { id, emoji: '🏅', nombre: id, desc: '' }

export const COFRES = {
  legendario: { emoji: '🌟', texto: '¡Cofre legendario! +100' },
  doble:      { emoji: '✨', texto: 'Cofre: la próxima misión vale doble' },
  mas25:      { emoji: '🎁', texto: 'Cofre: +25 puntos' },
  escudo:     { emoji: '🛡️', texto: 'Cofre: +1 escudo de racha' },
  combo:      { emoji: '⚡', texto: 'Cofre: carga de combo (+1 escalón)' },
}

export const ENERGIAS = [
  { id: 'alta',  emoji: '🔋', nombre: 'Energía alta' },
  { id: 'media', emoji: '🪫', nombre: 'Energía media' },
  { id: 'baja',  emoji: '🥱', nombre: 'Energía baja' },
]

// Etiquetas de Todoist que prefiere cada nivel de energía.
const PREFIERE = {
  alta: ['🎯_Hiperfoco', '🔬_Acetilcolina', '⭐_Propósito'],
  baja: ['🧠_Baja_Atención', '🟣_Dopamina'],
}

// Puntaje de afinidad de una tarea con la energía del momento (más alto = mejor).
export function afinidad(t, energia) {
  if (!energia || energia === 'media') return 0
  const etiquetas = t.etiquetas ?? []
  let s = etiquetas.filter(e => PREFIERE[energia].includes(e)).length * 2
  if (energia === 'baja' && t.duracion && t.duracion <= 15) s += 2
  if (energia === 'baja' && t.duracion && t.duracion >= 60) s -= 2
  if (energia === 'alta' && t.duracion && t.duracion <= 10) s -= 1
  return s
}

// La misión recomendada: la de mejor afinidad; en empate, la primera del orden normal
// (jefes vencidos primero, luego por hora). Con energía media, la primera.
export function recomendar(lista, energia) {
  if (!lista.length) return null
  if (!energia || energia === 'media') return lista[0]
  let mejor = lista[0], top = afinidad(lista[0], energia)
  for (const t of lista) { const a = afinidad(t, energia); if (a > top) { top = a; mejor = t } }
  return mejor
}
