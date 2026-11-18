# ⚔️ Misiones de Todoist — Etapa 1

La pestaña **Misiones** muestra sus tareas de Todoist de hoy y las vencidas, y le deja
completarlas, posponerlas, saltarlas o eliminarlas. Cada misión completada suma puntos
en el mismo saldo que usa para canjear recompensas.

## Cómo suma puntos

| Prioridad | Base |
|-----------|------|
| P1 | 40 |
| P2 | 25 |
| P3 | 15 |
| P4 | 10 |

- Bono por duración: +1 por cada 5 minutos de duración (máximo +30). Sin duración: +5.
- 👹 **Jefe** (tarea vencida de días anteriores): todo x1.5.
- Los puntos los calcula el servidor. Una misma tarea, en una misma fecha, nunca suma dos veces
  (en un hábito repetitivo cada día cuenta aparte).

## Instalación (una sola vez)

### 1. Base de datos
Supabase → **SQL Editor** → New query → pegue todo `src/schema.sql` → **Run**.
Es repetible: no borra nada de lo que ya tiene.

### 2. Token de Todoist
Todoist → **Configuración → Integraciones → Desarrollador** → copie el **token de API**.
Es como una contraseña: no lo pegue en el código ni en ningún chat.

### 3. Secretos en Supabase
Supabase → **Edge Functions → Secrets** → agregue:

| Nombre | Valor |
|--------|-------|
| `TODOIST_TOKEN` | el token del paso 2 |
| `ALLOWED_EMAIL` | el correo con el que entra a FOCUS |

`ALLOWED_EMAIL` hace que solo su cuenta pueda usar su Todoist, aunque alguien más se registre en la app.

### 4. Desplegar la función `todoist`
**Opción A, desde el navegador:** Supabase → **Edge Functions → Deploy a new function → Via Editor**
→ nombre `todoist` → pegue el contenido de `supabase/functions/todoist/index.ts` → **Deploy**.

**Opción B, con la terminal:**
```bash
npx supabase login
npx supabase link --project-ref SU_PROJECT_REF
npx supabase functions deploy todoist
```

Si al abrir Misiones sale "Invalid JWT", vuelva a desplegar con `--no-verify-jwt`
(o desactive "Verify JWT" en la función): la función igual valida la sesión por su cuenta.

### 5. Publicar
Netlify publica sola cuando estos cambios entran a `main`. No hay variables nuevas en Netlify.

## Etapa 2: puntos por lo completado fuera de la app

Si completa una tarea en la app de Todoist, en el celular o con el coach, igual suma puntos
(misma fórmula). Un cron de Supabase revisa el registro de actividad de Todoist cada 10 minutos,
y la pestaña Misiones también lo revisa al abrirla.

- No suma dos veces: la llave es (tarea, fecha de vencimiento que se completó), la misma del botón Hecho.
- Las que completa el botón Hecho se saltan (ya tienen sus puntos).
- Solo cuenta desde el día en que se instaló, y nunca más de 3 días atrás.
- Las tareas de proyectos borrados no aparecen en el registro de Todoist y no suman.
- Todoist tarda alrededor de un minuto en reportar una completada.

### Instalación
1. SQL Editor: corra `src/schema.sql` (agrega la tabla `sync_todoist` y la columna `misiones.origen`).
2. Vuelva a desplegar la función `todoist` con el código nuevo.
3. SQL Editor: abra `supabase/cron_todoist.sql`, reemplace `SU_PROJECT_REF` y `SU_ANON_KEY` y córralo.
   Crea sola la clave del cron en Vault.

### Revisar que funciona
```sql
SELECT * FROM public.sync_todoist;                                     -- última sincronización y último error
SELECT status_code, content FROM net._http_response ORDER BY created DESC LIMIT 5;
SELECT origen, contenido, puntos, created_at FROM public.misiones ORDER BY created_at DESC LIMIT 10;
```

## Etapa 3: modo enfoque, contexto y tareas zombi

- **🎯 Modo enfoque (tecla F):** arranca un pomodoro con la misión actual. Usa la duración de la
  tarea si tiene entre 5 y 90 min; si no, la última duración usada. Al terminar pregunta
  "¿La terminó?": Sí la completa en Todoist (con sus puntos), Todavía no la deja amarrada para
  el siguiente pomodoro. El pomodoro suma sus puntos aparte (1 por minuto), como siempre.
- El Temporizador ya no se apaga al cambiar de pestaña: si termina mientras está en Misiones,
  la sesión igual se guarda.
- **🧠 Contexto:** caja en cada misión. Se guarda como comentario "🧠 Contexto: …" en Todoist
  (si ya existe, se actualiza; no se duplica). Ctrl+Enter también guarda.
- **🧟 Zombi:** tarea normal con 3 o más comentarios "🔁 Reprogramada". No se puede posponer
  otra vez hasta que se parta en pasos o se suelte. Si se termina con el botón Hecho o con el
  Modo enfoque, vale ×1.5 (se acumula con jefe: ×2.25). Los hábitos nunca son zombis.
  Nota: el bono zombi no aplica a lo completado fuera de la app.
- **🧩 Partir en pasos:** un paso por línea; se crean como subtareas para hoy con la misma prioridad.
- **🗑️ Soltar:** P4, etiqueta 🗑️_Superflua y fecha a +30 días, con comentario para el coach.

Instalación: solo volver a desplegar la función `todoist` (no hay SQL nuevo).

## Etapa 4: gamificación

Todo lo calcula el servidor (`src/schema.sql`, sección v6); el navegador nunca manda XP ni puntos.

- **XP y niveles:** XP = todo lo ganado (nunca baja); los puntos son el saldo para recompensas.
  Nivel n → n+1 pide 100 + (n-1)·50 XP. Rangos: Aprendiz (1), Escudero (3), Caballero (6),
  Paladín (10), Leyenda (15). Al instalar v6 se sumó el XP de todo el historial; el 2026-11-18
  Gabriel eligió empezar en nivel 1, así que su XP se puso en 0 (`update perfiles set xp_total = 0`).
  Los puntos, la racha, las insignias y las estadísticas (bitácora `xp_eventos`) no cambiaron.
- **Combo:** otra misión antes de 45 min → ×1, ×1.5, ×2, ×2.5, ×3. Arriba se ve la cuenta regresiva.
- **Racha:** días con al menos una misión o un pomodoro. Los escudos (máx. 3) tapan días perdidos.
- **Cofres (32 % por misión):** legendario 4 % (+100), XP doble 8 % (la siguiente misión ×2),
  +25 8 %, escudo 6 % (si ya tiene 3, +25), carga de combo 6 %.
- **Retos de hoy:** 3 misiones +30 · 1 jefe vencido +25 · 25 min de enfoque +25 · 6 misiones +50.
  Se cobran con el botón "¡Cobrar!"; el servidor revisa que se cumplieron.
- **Energía:** alta prefiere 🎯_Hiperfoco, 🔬_Acetilcolina y ⭐_Propósito; baja prefiere
  🧠_Baja_Atención, 🟣_Dopamina y tareas de 15 min o menos. Esa misión sale primero (⭐ RECOMENDADA).
- **Jefe de proyecto:** el proyecto con más tareas pendientes (no repetitivas) es el monstruo.
  Vaciarlo da +200, pero solo si completó al menos una de sus tareas (borrarlas no cuenta).
- **17 insignias** y estadísticas (XP por día, mejores horas, proyectos) en la pestaña Estadísticas.
- "5 vaciados" = 5 días dejando en cero el tablero de hoy + vencidas.

Instalación: correr `src/schema.sql` (o solo el cambio v5→v6) y volver a desplegar la función `todoist`.

## Etapa 5: Google Calendar y Spotify

**📅 Calendario** (solo lectura, gratis, sin Google Cloud):
- Arriba se ve el próximo evento ("📅 Almuerzo en 30 min (12:00 pm)") o el que está en curso.
- Si la misión actual dura más que el tiempo libre antes del próximo evento, avisa; y la misión
  recomendada prefiere las que sí caben.
- En el Temporizador avisa si el pomodoro se cruza con un evento y ofrece acortarlo.
- No cuentan los eventos de todo el día, los cancelados ni las reuniones que usted rechazó.
- Configuración: secreto `GOOGLE_ICS_URL` en Supabase (Edge Functions → Secrets) con la
  "Dirección secreta en formato iCal" de cada calendario (Google Calendar → Configuración →
  su calendario → Integrar el calendario). Varios calendarios: separados por un espacio.
  Es como una contraseña: quien la tenga ve su calendario. Si se filtra, en esa misma pantalla
  se puede "Restablecer" y poner la nueva.

**🎵 Spotify** (reproductor incrustado; sirve con cuenta gratis o Premium):
- En el Temporizador, "Música de enfoque": pegue el enlace de una playlist y Guardar
  (en Spotify: ⋯ → Compartir → Copiar enlace). Se guarda en su perfil (`guardar_spotify`).
- El Temporizador no se apaga al cambiar de pestaña, así que la música sigue sonando.
- "Abrir en la app de Spotify" y la opción "Abrirla sola en Modo enfoque".
- Para escuchar canciones completas en el reproductor, inicie sesión en Spotify en ese navegador.

Instalación: correr la sección v7 de `src/schema.sql` y volver a desplegar la función `todoist`.

## Atajos de teclado (en la pestaña Misiones)
`C` completar · `P` posponer · `S` saltar · `D` eliminar · `F` modo enfoque · `Esc` cerrar menú

## Etapas
2. ✅ Puntos por lo que complete fuera de la app (app de Todoist, coach).
3. ✅ Pomodoro amarrado a la misión, contexto por tarea y tareas zombi.
4. ✅ Gamificación completa: combo, cofres, retos, insignias, jefe de proyecto y estadísticas.
5. ✅ Google Calendar y Spotify.
