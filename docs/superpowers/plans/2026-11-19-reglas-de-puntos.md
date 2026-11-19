# Reglas de puntos configurables — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El minuto de enfoque es la moneda base; misiones, combo, cofres, retos y jefes dan bonos chicos, con tope diario, y todo se configura desde un panel en la app.

**Architecture:** Una columna `perfiles.reglas` (JSONB) guarda solo lo que el usuario cambió; el servidor mezcla eso con los valores por defecto y los rangos (`_reglas`). Todas las funciones que dan puntos leen esas reglas. El navegador nunca manda puntos: solo llama `guardar_reglas`, que valida rangos. `estado_juego()` devuelve las reglas vigentes para que la pantalla muestre los números correctos.

**Tech Stack:** PostgreSQL/Supabase (`src/schema.sql`, plpgsql), Edge Function Deno (`supabase/functions/todoist/index.ts`), React 18 + Vite (`src/`). No hay corredor de pruebas en el proyecto: el SQL se verifica con un script (`supabase/tests/reglas_puntos.sql`) que se pega en el SQL Editor de Supabase; el cliente con `npm run build` y revisión en el navegador.

**Spec:** `docs/superpowers/specs/2026-11-19-reglas-de-puntos-design.md`

## Global Constraints

- Valores por defecto (clave → valor, rango):
  `min_enfoque` 1 (0.5–5) · `mision_base` 5 (0–50) · `mision_vencida` 10 (0–100) · `mision_zombi` 10 (0–100) · `combo_max` 1.5 (1–3) · `cofre_mas` 5 (0–50) · `cofre_legendario` 20 (0–200) · `reto_misiones_3` 5 · `reto_jefe_1` 5 · `reto_enfoque_25` 5 · `reto_misiones_6` 10 (cada reto 0–100) · `jefe_proyecto` 25 (0–500) · `tope_bonos` 50 (0–1000; 0 = sin tope).
- "Vencida" y "zombi" son totales, no extras: una misión vencida vale `mision_vencida`, no `mision_base + mision_vencida`. Vencida y zombi a la vez: el mayor de los dos.
- Combo: escalones de 0.5 hasta `combo_max`, solo multiplica el bono de la misión. Cofre "doble": la siguiente misión vale ×2 (solo su bono).
- Tope diario de bonos: suma de todo lo ganado ese día (hora Costa Rica) con origen distinto de `sesion`. Los minutos de enfoque nunca tienen tope.
- Solo aplica a ganancias futuras: no tocar saldo, XP ni historial. No cambiar precios de recompensas. XP y puntos siguen sumando igual.
- El navegador no escribe puntos ni reglas directamente (`perfiles` sigue sin UPDATE); solo funciones `SECURITY DEFINER`.
- No hacer commits hasta que el usuario lo pida. Idioma de la interfaz: español, trato de "usted".
- `src/schema.sql` es el script completo e idempotente (se vuelve a correr entero en Supabase); editar las funciones en su lugar, no agregar versiones duplicadas.

## Review Focus

1. Misión que llega atrasada por sync con `p_momento` de otro día: el tope se cuenta en el día de `p_momento`, no en el de hoy.
2. `guardar_reglas` con clave desconocida, texto en vez de número o valor fuera de rango: la clave desconocida se ignora; lo demás se rechaza con error y no guarda nada.
3. Perfil sin reglas guardadas (usuarios nuevos y existentes): todas las funciones usan los valores por defecto.
4. `tope_bonos = 0` significa sin tope; un tope que corta un cofre legendario no debe quitar la insignia "Suertudo" (se calcula con `misiones.cofre`, no con la bitácora).
5. Restablecer reglas (`guardar_reglas('{}')`) vuelve a los valores por defecto sin tocar saldo.

---

### Task 1: Reglas en el servidor (almacenamiento, lectura y guardado)

**Files:**
- Modify: `src/schema.sql` (nueva sección "v7 — Reglas de puntos", después de la sección v6 y antes de los GRANT finales de v6; grants junto a los demás ~línea 896)
- Create: `supabase/tests/reglas_puntos.sql`

**Interfaces:**
- Produces (SQL):
  - `perfiles.reglas JSONB NOT NULL DEFAULT '{}'`
  - `_reglas_defecto() RETURNS JSONB` y `_reglas_rangos() RETURNS JSONB` (`{clave: [min, max]}`), ambas `IMMUTABLE`
  - `_reglas(p_user UUID) RETURNS JSONB` (defectos mezclados con lo guardado, solo claves conocidas)
  - `_regla(p_user UUID, p_clave TEXT) RETURNS NUMERIC`
  - `reglas_juego() RETURNS JSON` → `{valores, defectos, rangos}` (usa `auth.uid()`)
  - `guardar_reglas(p_reglas JSONB) RETURNS JSON` → `{exito: true, valores}`; reemplaza lo guardado por el objeto validado
- Los tests de este y los siguientes tasks viven en un solo script que corre dentro de `BEGIN; … ROLLBACK;`, toma un usuario real con `SELECT user_id FROM public.perfiles LIMIT 1`, y simula sesión con `set_config('request.jwt.claims', json_build_object('sub', <uuid>)::text, true)`. Cada caso es un `DO $$ … ASSERT … $$` con mensaje.

- [ ] **Step 1: Escribir los tests de Task 1 en `supabase/tests/reglas_puntos.sql`.** Casos: (a) `_regla(u,'mision_base') = 5` y `_regla(u,'tope_bonos') = 50` sin nada guardado; (b) tras `guardar_reglas('{"mision_base": 8}')`, `_regla(u,'mision_base') = 8` y `_regla(u,'mision_vencida') = 10`; (c) `guardar_reglas('{"mision_base": 999}')` lanza excepción (usar bloque `BEGIN … EXCEPTION`) y el valor sigue en 8; (d) `guardar_reglas('{"mision_base": "x"}')` lanza excepción; (e) `guardar_reglas('{"inventada": 1}')` no falla y `_reglas(u) ? 'inventada'` es falso; (f) `guardar_reglas('{}')` devuelve `_regla(u,'mision_base') = 5`; (g) `reglas_juego()->'rangos'->'combo_max'` es `[1,3]`.
- [ ] **Step 2: Verificar que falla.** Pegar el script en el SQL Editor; esperado: error `function public._regla(uuid, text) does not exist`.
- [ ] **Step 3: Implementar en `src/schema.sql`** la columna y las siete funciones de la interfaz. `_reglas` mezcla `_reglas_defecto() || (reglas filtradas a claves conocidas)`; `_regla` lee de `_reglas`. `guardar_reglas`: exige `auth.uid()`, crea el perfil si no existe, valida cada clave conocida (número dentro de `_reglas_rangos()`), ignora las desconocidas, y hace `UPDATE perfiles SET reglas = <objeto validado>`. Mensaje de error: `Valor fuera de rango: <clave>`. `REVOKE … FROM PUBLIC, anon` y `GRANT EXECUTE … TO authenticated` para `reglas_juego()` y `guardar_reglas(JSONB)`; `REVOKE … FROM PUBLIC, anon, authenticated` para `_reglas(UUID)` y `_regla(UUID, TEXT)`.
- [ ] **Step 4: Correr `src/schema.sql` completo y luego el script de tests.** Esperado: sin errores y sin ningún `ASSERT` fallido.

### Task 2: Enfoque, misiones y tope diario usan las reglas

**Files:**
- Modify: `src/schema.sql` — `_ganar` (~l.448), `registrar_sesion` (~l.145), `registrar_mision` (~l.564), grants de `_ganar` (~l.877) y de `registrar_mision` (~l.883)
- Modify: `supabase/tests/reglas_puntos.sql`

**Interfaces:**
- Consumes: `_regla(UUID, TEXT) RETURNS NUMERIC`.
- Produces:
  - `_ganar(p_user UUID, p_puntos INT, p_origen TEXT, p_detalle TEXT, p_momento TIMESTAMPTZ DEFAULT NOW()) RETURNS INT` — devuelve lo realmente otorgado. Requiere `DROP FUNCTION IF EXISTS public._ganar(UUID, INT, TEXT, TEXT, TIMESTAMPTZ)` antes (cambia el tipo de retorno) y repetir su `REVOKE`.
  - `registrar_sesion` devuelve además `'puntos_ganados'`.
  - `registrar_mision`: misma firma, pero `p_puntos` pasa a `DEFAULT NULL` y se **ignora** (se quita la validación 1–150). El bono lo calcula el servidor. La respuesta mantiene `puntos_mision`, `puntos_ganados`, `cofre_puntos`, `combo`, `doble`, y esos números son los realmente otorgados tras el tope.

- [ ] **Step 1: Agregar tests** (usar un `p_momento` fijo de hace 2 días para no mezclarse con datos de hoy; todo dentro del `ROLLBACK`): (a) `registrar_sesion(25,'trabajo')` suma 25 con reglas por defecto y, con `min_enfoque = 2`, suma 50; (b) `registrar_mision` de una tarea normal otorga 5, vencida otorga 10, zombi otorga 10, vencida+zombi otorga 10, y pasar `p_puntos => 150` no cambia nada; (c) con `tope_bonos = 12`, tres misiones normales el mismo día otorgan 5, 5 y 2, y una cuarta otorga 0; (d) una sesión de enfoque del mismo día sigue sumando completa con el tope agotado; (e) con `tope_bonos = 0` no hay tope; (f) con `combo_max = 1.5`, la 3.ª misión seguida (≤45 min) otorga `round(5 × 1.5) = 8`, no más; (g) una misión con `p_momento` de otro día cuenta contra el tope de ese día, no el de hoy.
- [ ] **Step 2: Correr el script; esperado:** fallan (a)–(g) (los valores viejos siguen vigentes).
- [ ] **Step 3: Implementar.** `_ganar`: si `p_origen <> 'sesion'` y `tope_bonos > 0`, recorta `p_puntos` a `greatest(0, tope − ya_ganado_ese_día)` donde `ya_ganado_ese_día` suma `xp_eventos` del usuario con origen ≠ `'sesion'` y `_dia_cr(momento) = _dia_cr(p_momento)`; no escribe nada si queda en 0; devuelve lo otorgado. `registrar_sesion`: `_ganar(v_uid, round(p_duracion * _regla(v_uid,'min_enfoque'))::int, …)` y devolver su resultado como `puntos_ganados`. `registrar_mision`: base = `mision_base`; si vencida/zombi, `greatest` de `mision_vencida`/`mision_zombi` aplicables; `v_mult = least(_regla(…,'combo_max'), 1 + 0.5·greatest(v_n,0))`; `v_final = round(base × v_mult × (2 si doble))`; llamar a `_ganar` primero y guardar en `misiones.puntos` lo otorgado; cofre `mas25` y `escudo_lleno` otorgan `cofre_mas`, `legendario` otorga `cofre_legendario`, todos vía `_ganar`; `misiones.puntos_base` guarda la base calculada.
- [ ] **Step 4: Correr `schema.sql` y el script; esperado:** todos los `ASSERT` de Tasks 1 y 2 pasan.

### Task 3: Retos, jefe, estado del juego e insignias usan las reglas

**Files:**
- Modify: `src/schema.sql` — `_retos` (~l.540), `cobrar_reto` (~l.685), `derrotar_jefe` (~l.814), `estado_juego` (~l.726), `_revisar_insignias` (~l.497), comentario de reglas v6 (~l.343-357)
- Modify: `supabase/tests/reglas_puntos.sql`

**Interfaces:**
- Consumes: `_regla`, `_reglas`, `_ganar(...) RETURNS INT`.
- Produces: `_retos(p_user UUID) RETURNS TABLE (id TEXT, nombre TEXT, meta INT, premio INT)` (reemplaza a `_retos()`; hacer `DROP FUNCTION IF EXISTS public._retos()`). `cobrar_reto` y `derrotar_jefe` devuelven `premio` = lo realmente otorgado. `estado_juego()` agrega las claves `reglas` (objeto de `_reglas(uid)`), `bonos_hoy` (suma de bonos de hoy) y usa `combo_max` de las reglas en `combo` y `combo_siguiente`.

- [ ] **Step 1: Agregar tests:** (a) `_retos(u)` devuelve premios 5, 5, 5, 10 por defecto y 9 para `misiones_3` tras `guardar_reglas('{"reto_misiones_3": 9}')`; (b) `estado_juego()->'reglas'->>'jefe_proyecto'` es `25` y `estado_juego()->>'bonos_hoy'` es numérico; (c) `derrotar_jefe` (con un jefe y una misión de ese proyecto creados dentro del test) devuelve `premio = 25`; (d) con `combo_max = 3` el combo de `estado_juego` puede pasar de 1.5; (e) una misión con cofre `legendario` forzado vía `UPDATE misiones SET cofre = 'legendario'` hace que `_revisar_insignias` otorgue `suertudo` aunque `xp_eventos` no tenga el evento.
- [ ] **Step 2: Correr; esperado:** fallan.
- [ ] **Step 3: Implementar** lo descrito. `_revisar_insignias`: `suertudo` pasa a `EXISTS (SELECT 1 FROM misiones WHERE user_id = p_user AND cofre = 'legendario')`; `combo_x3` pasa a `p.combo_max >= _regla(p_user,'combo_max')`. Actualizar el comentario "Reglas" de la sección v6 con los nuevos números y la mención a las reglas configurables.
- [ ] **Step 4: Correr `schema.sql` y el script completo; esperado:** todos los `ASSERT` pasan.

### Task 4: Función Edge de Todoist sin fórmula de puntos

**Files:**
- Modify: `supabase/functions/todoist/index.ts` — `calcularPuntos` y `puntosDe` (~l.103-116), `misionDeEvento` (~l.242), llamadas a `registrar_mision` (~l.279 y ~l.554)

**Interfaces:**
- Consumes: `registrar_mision` con `p_puntos` opcional.
- Produces: `puntosDe(t, zombi)` desaparece; se conserva el cálculo de `vencida` en una función `esVencida(t): boolean`. Ninguna llamada a `registrar_mision` envía `p_puntos`; `misionDeEvento` ya no devuelve `puntos`.

- [ ] **Step 1: Eliminar** `calcularPuntos`, el cálculo de puntos en `puntosDe` y el campo `puntos` de `misionDeEvento`; reemplazar por `esVencida` y ajustar las dos llamadas.
- [ ] **Step 2: Verificar:** `Grep` de `calcularPuntos|p_puntos|puntos:` en `supabase/functions/todoist/index.ts` no encuentra nada (salvo los `puntos_*` de las respuestas), y `npx deno check` o, si no hay Deno, revisión manual de que no quedan referencias.
- [ ] **Step 3: Avisar al usuario** que debe volver a desplegar la función `todoist` y correr `schema.sql`, en ese orden (la función vieja sigue funcionando con la base nueva, porque `p_puntos` se ignora).

### Task 5: Pantalla muestra los puntos de las reglas

**Files:**
- Modify: `src/lib/todoist.js` (`puntosDe`), `src/lib/juego.js` (`COFRES`), `src/lib/useJuego.js`, `src/components/Misiones.jsx` (l.214, 352, 385, 519), `src/components/SelectorMision.jsx` (l.61), `src/components/Timer.jsx` (l.236, 331, 476), `src/App.jsx` (props de `SelectorMision`/`Timer`), `src/lib/juego.js` (`INSIGNIAS.combo_x3`)

**Interfaces:**
- Consumes: `juego.reglas` (de `estado_juego`) y `puntos_ganados` de `registrar_sesion`.
- Produces: `puntosDe(t, hoy, zombi, reglas)` en `src/lib/todoist.js` → entero: `reglas.mision_vencida` / `reglas.mision_zombi` (el mayor si aplican ambas) o `reglas.mision_base`; si `reglas` es `null` usa 5/10/10 (constante local `REGLAS_ESPERA`). `COFRES` pasa de objeto con textos fijos a `textoCofre(id, reglas) → { emoji, texto }`.

- [ ] **Step 1: Cambiar `puntosDe`** y todos sus usos para pasar `juego?.reglas`. `Misiones` ya recibe `juego`; `SelectorMision` y `Timer` reciben `reglas` como prop nueva desde `App.jsx` (`juego?.reglas`).
- [ ] **Step 2: Textos con números de las reglas:** "Vacíe el proyecto para derrotarlo: +{reglas.jefe_proyecto}" (Misiones l.352); `textoCofre` para legendario (`+cofre_legendario`) y `mas25` (`+cofre_mas`), y usarlo en `useJuego.celebrarResultado`; aviso del Timer l.331 sin "×1.5" fijo ("zombi"); etiqueta del Timer l.476 `+{Math.round(workDuration * (reglas?.min_enfoque ?? 1))} pts`; aviso l.236 usa `data.puntos_ganados`; tooltip de zombi en Misiones l.385 sin "x1.5"; insignia `combo_x3` renombrada a "Combo máximo", desc "Llegue al combo máximo" (el id no cambia).
- [ ] **Step 3: Verificar:** `npm run build` termina sin errores; `Grep` de `x1.5|×1.5|+200|+100|+25` en `src/**/*.jsx` y `src/lib/*.js` no deja textos de puntos fijos.

### Task 6: Panel "Reglas de puntos"

**Files:**
- Create: `src/components/ReglasPuntos.jsx`
- Modify: `src/components/Store.jsx` (renderizar el panel debajo de "Canjes recientes", plegable), `src/App.jsx` (pasar `refrescarJuego` a `Store`), `src/juego.css` (estilos del panel)

**Interfaces:**
- Consumes: RPC `reglas_juego()` → `{valores, defectos, rangos}`; RPC `guardar_reglas(p_reglas)`.
- Produces: `export default function ReglasPuntos({ onCambio })` — `onCambio` se llama tras guardar o restablecer con éxito (App lo conecta a `refrescarJuego`).

- [ ] **Step 1: Escribir el componente** con una lista fija `CAMPOS = [{ clave, etiqueta, grupo, paso }]` agrupada en: Enfoque (`min_enfoque`, "Puntos por minuto"), Misiones (`mision_base`, `mision_vencida`, `mision_zombi`), Bonos (`combo_max`, `cofre_mas`, `cofre_legendario`, `jefe_proyecto`, `tope_bonos` con ayuda "0 = sin tope"), Retos del día (los cuatro). Cada fila es un `<input type="number">` con `min`/`max` tomados de `rangos`, y muestra el valor por defecto como pista. Botones "Guardar" (deshabilitado si hay valores fuera de rango o sin cambios) y "Valores recomendados" (llama `guardar_reglas('{}')` tras confirmar). Mensajes de éxito/error con el estilo `store-message` ya existente. Mostrar arriba: "Los cambios aplican a lo que gane de ahora en adelante."
- [ ] **Step 2: Integrar en `Store`** como sección plegable ("⚙️ Reglas de puntos"), cerrada por defecto.
- [ ] **Step 3: Verificar con `preview_start` (`focus-dev`)** y el navegador integrado: abrir la pestaña de recompensas, abrir el panel, cambiar `mision_base` a 8, guardar, recargar y confirmar que persiste y que la misión muestra "+8"; probar `combo_max` fuera de rango (deshabilita Guardar); probar "Valores recomendados". Revisar consola sin errores. (Requiere haber corrido `schema.sql` en Supabase.)

### Task 7: Documentación

**Files:**
- Modify: `TODOIST.md` (secciones "Cómo suma puntos" l.7-18 y "Etapa 4" l.104-120, y la línea de instalación l.122)

- [ ] **Step 1: Reescribir** la tabla de prioridades por la regla nueva (bono fijo de misión, vencida, zombi), los números de combo, cofres, retos y jefe, y el tope diario; indicar que todo se configura en Recompensas → "Reglas de puntos" y que el pomodoro da 1 punto por minuto.
- [ ] **Step 2: Actualizar la línea de instalación:** correr `src/schema.sql` completo y volver a desplegar la función `todoist`.
- [ ] **Step 3: Verificación final:** `npm run build` sin errores; correr `supabase/tests/reglas_puntos.sql` completo una vez más; confirmar con el usuario si quiere que se haga commit.
