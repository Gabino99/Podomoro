-- ═══════════════════════════════════════════════════════
--  FOCUS — Esquema SQL para Supabase (v7)
--  Ejecutar en: Supabase > SQL Editor > New Query
--  Es repetible: se puede correr en una base nueva o en
--  la ya existente sin perder datos.
--
--  Cambios v3:
--   · Tabla `recompensas`: el usuario crea sus propias metas.
--   · Los puntos SOLO cambian por funciones del servidor
--     (registrar_sesion / canjear_recompensa). El navegador
--     ya no puede escribirse puntos ni mandar el costo.
--   · sesiones usa `created_at` (como la base real).
--
--  Cambios v4 (al final del archivo):
--   · Tabla `misiones` y función `registrar_mision` para las
--     tareas de Todoist completadas desde la pestaña Misiones.
--
--  Cambios v5 (al final del archivo):
--   · Puntos por lo completado fuera de la app (tabla `sync_todoist`,
--     columna misiones.origen, registrar_mision con p_origen).
--
--  Cambios v6 (al final del archivo): gamificación completa.
--   · XP y niveles, combo, racha con escudos, cofres, retos diarios,
--     insignias, energía del día, jefe de proyecto y estadísticas.
--   · Todo lo calcula el servidor; el navegador no manda XP ni puntos.
-- ═══════════════════════════════════════════════════════

-- ── 1. Tablas ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.perfiles (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  puntos_totales        INT  NOT NULL DEFAULT 0,
  meta_diaria_minutos   INT  NOT NULL DEFAULT 120,
  creado_en             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS meta_diaria_minutos INT NOT NULL DEFAULT 120;
-- v6: gamificación (solo la cambian funciones del servidor)
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS xp_total     INT NOT NULL DEFAULT 0,      -- todo lo ganado; nunca baja
  ADD COLUMN IF NOT EXISTS racha        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS racha_max    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_dia   DATE,                         -- último día con actividad (hora CR)
  ADD COLUMN IF NOT EXISTS escudos      INT NOT NULL DEFAULT 0,      -- protegen la racha (máx. 3)
  ADD COLUMN IF NOT EXISTS combo_n      INT NOT NULL DEFAULT 0,      -- misiones seguidas en la cadena
  ADD COLUMN IF NOT EXISTS combo_en     TIMESTAMPTZ,                  -- última misión de la cadena
  ADD COLUMN IF NOT EXISTS combo_max    NUMERIC(3,1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dobles       INT NOT NULL DEFAULT 0,      -- cofres "XP doble" sin usar
  ADD COLUMN IF NOT EXISTS energia      TEXT,
  ADD COLUMN IF NOT EXISTS energia_dia  DATE,
  ADD COLUMN IF NOT EXISTS gamificacion_v6 BOOLEAN NOT NULL DEFAULT FALSE;
-- Los perfiles que ya existían quedan en FALSE (se les calcula el XP histórico una vez);
-- los nuevos nacen en TRUE.
ALTER TABLE public.perfiles ALTER COLUMN gamificacion_v6 SET DEFAULT TRUE;
-- v7: reglas de puntos (solo lo que el usuario cambió; el resto sale de _reglas_defecto())
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS reglas JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.sesiones (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  duracion_minutos  INT  NOT NULL,
  tipo              TEXT NOT NULL DEFAULT 'trabajo',
  completada        BOOLEAN NOT NULL DEFAULT FALSE,
  categoria         TEXT NOT NULL DEFAULT 'general',
  nota              TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.sesiones ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'general';
ALTER TABLE public.sesiones ADD COLUMN IF NOT EXISTS nota TEXT;

CREATE TABLE IF NOT EXISTS public.recompensas (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 60),
  descripcion   TEXT CHECK (descripcion IS NULL OR char_length(descripcion) <= 140),
  emoji         TEXT NOT NULL DEFAULT '🎁',
  costo         INT  NOT NULL CHECK (costo BETWEEN 1 AND 100000),
  fecha_limite  DATE,
  recurrente    BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = meta de una sola vez
  archivada     BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE = ya cumplida / oculta
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.canjes (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  premio_nombre TEXT NOT NULL,
  puntos_usados INT  NOT NULL,
  creado_en     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.canjes
  ADD COLUMN IF NOT EXISTS recompensa_id UUID REFERENCES public.recompensas(id) ON DELETE SET NULL;

-- ── 2. Row Level Security ────────────────────────────
ALTER TABLE public.perfiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesiones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canjes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recompensas  ENABLE ROW LEVEL SECURITY;

-- Borra TODAS las políticas anteriores (sea cual sea su nombre)
-- y deja solo las de abajo.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN ('perfiles','sesiones','canjes','recompensas')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Perfiles: leer el suyo; crearlo solo con 0 puntos. NO hay UPDATE.
CREATE POLICY "perfiles_select" ON public.perfiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "perfiles_insert" ON public.perfiles
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND puntos_totales = 0 AND xp_total = 0
    AND racha = 0 AND racha_max = 0 AND escudos = 0 AND combo_n = 0 AND dobles = 0
    AND combo_max = 1 AND ultimo_dia IS NULL AND combo_en IS NULL AND gamificacion_v6
  );

-- Sesiones y canjes: solo lectura (se escriben por funciones).
CREATE POLICY "sesiones_select" ON public.sesiones
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "canjes_select" ON public.canjes
  FOR SELECT USING (auth.uid() = user_id);

-- Recompensas: el usuario las administra libremente.
CREATE POLICY "recompensas_select" ON public.recompensas
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "recompensas_insert" ON public.recompensas
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "recompensas_update" ON public.recompensas
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "recompensas_delete" ON public.recompensas
  FOR DELETE USING (auth.uid() = user_id);

-- ── 3. Funciones (el servidor lleva las cuentas) ─────

-- Funciones viejas e inseguras
DROP FUNCTION IF EXISTS public.canjear_puntos(UUID, INT, TEXT);

-- Registra una sesión terminada y suma los puntos (1 min de trabajo = 1 punto = 1 XP).
-- Los ayudantes (_ganar, _marcar_actividad, _revisar_insignias) están en la sección v6.
CREATE OR REPLACE FUNCTION public.registrar_sesion(
  p_duracion  INT,
  p_tipo      TEXT,
  p_categoria TEXT DEFAULT 'general',
  p_nota      TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_ins  TEXT[] := '{}';
  v_p    public.perfiles%ROWTYPE;
  v_gan  INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_tipo NOT IN ('trabajo','descanso') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF p_duracion IS NULL OR p_duracion < 1 OR p_duracion > 240 THEN   -- el cronómetro cuenta hasta 4 h
    RAISE EXCEPTION 'Duración inválida';
  END IF;

  INSERT INTO public.perfiles (user_id) VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.sesiones (user_id, duracion_minutos, tipo, completada, categoria, nota)
  VALUES (v_uid, p_duracion, p_tipo, TRUE,
          left(coalesce(p_categoria, 'general'), 30),
          left(p_nota, 500));

  IF p_tipo = 'trabajo' THEN
    v_gan := public._ganar(v_uid, round(p_duracion * public._regla(v_uid, 'min_enfoque'))::int,
                           'sesion', coalesce(left(p_nota, 120), p_categoria), now());
    PERFORM public._marcar_actividad(v_uid, public._dia_cr(now()));
    v_ins := public._revisar_insignias(v_uid);
  END IF;

  SELECT * INTO v_p FROM public.perfiles WHERE user_id = v_uid;
  RETURN json_build_object('exito', true, 'puntos_ganados', v_gan, 'puntos_totales', v_p.puntos_totales,
                           'xp_total', v_p.xp_total, 'insignias', to_json(v_ins));
END;
$$;

-- Canjea una recompensa: el costo sale de la tabla, no del navegador.
CREATE OR REPLACE FUNCTION public.canjear_recompensa(p_recompensa_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_rec    public.recompensas%ROWTYPE;
  v_puntos INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;

  SELECT * INTO v_rec FROM public.recompensas
  WHERE id = p_recompensa_id AND user_id = v_uid AND NOT archivada
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('exito', false, 'mensaje', 'La recompensa ya no está disponible');
  END IF;

  SELECT puntos_totales INTO v_puntos FROM public.perfiles
  WHERE user_id = v_uid FOR UPDATE;
  IF v_puntos IS NULL OR v_puntos < v_rec.costo THEN
    RETURN json_build_object('exito', false, 'mensaje', 'Puntos insuficientes');
  END IF;

  v_puntos := v_puntos - v_rec.costo;
  UPDATE public.perfiles SET puntos_totales = v_puntos WHERE user_id = v_uid;

  INSERT INTO public.canjes (user_id, premio_nombre, puntos_usados, recompensa_id)
  VALUES (v_uid, v_rec.nombre, v_rec.costo, v_rec.id);

  IF NOT v_rec.recurrente THEN
    UPDATE public.recompensas SET archivada = TRUE WHERE id = v_rec.id;
  END IF;

  RETURN json_build_object('exito', true, 'puntos_restantes', v_puntos,
                           'nombre', v_rec.nombre);
END;
$$;

CREATE OR REPLACE FUNCTION public.actualizar_meta_diaria(p_user_id UUID, p_meta INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_meta IS NULL OR p_meta < 10 OR p_meta > 480 THEN
    RAISE EXCEPTION 'Meta inválida';
  END IF;
  UPDATE public.perfiles SET meta_diaria_minutos = p_meta WHERE user_id = p_user_id;
END;
$$;

-- Solo usuarios con sesión pueden llamarlas
REVOKE ALL ON FUNCTION public.registrar_sesion(INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.canjear_recompensa(UUID)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.actualizar_meta_diaria(UUID, INT)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_sesion(INT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.canjear_recompensa(UUID)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_meta_diaria(UUID, INT)      TO authenticated;

-- ═══════════════════════════════════════════════════════
--  v4 — Misiones de Todoist
--  · Tabla `misiones`: cada tarea de Todoist completada desde la app.
--  · Los puntos de misión los suma SOLO la función del servidor
--    `registrar_mision`, que únicamente puede llamar la Edge Function
--    `todoist` (rol service_role). El navegador no puede llamarla.
--  · Una misma ocurrencia de una tarea nunca suma dos veces
--    (en los hábitos repetitivos cada día cuenta como ocurrencia aparte).
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.misiones (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id     TEXT NOT NULL,
  ocurrencia  TEXT NOT NULL,              -- fecha de vencimiento que se completó
  contenido   TEXT NOT NULL,
  proyecto    TEXT,
  prioridad   INT  NOT NULL DEFAULT 4,    -- 1 = p1 (la más alta) … 4 = p4
  vencida     BOOLEAN NOT NULL DEFAULT FALSE,
  puntos      INT  NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, task_id, ocurrencia)
);

ALTER TABLE public.misiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "misiones_select" ON public.misiones;
CREATE POLICY "misiones_select" ON public.misiones
  FOR SELECT USING (auth.uid() = user_id);

-- v5: de dónde vino la misión ('app' = botón Hecho, 'todoist' = completada fuera de la app)
ALTER TABLE public.misiones ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'app';
-- v6: datos para combo, cofres, insignias y estadísticas
ALTER TABLE public.misiones
  ADD COLUMN IF NOT EXISTS momento     TIMESTAMPTZ,              -- cuándo se completó de verdad
  ADD COLUMN IF NOT EXISTS zombi       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS etiquetas   TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS proyecto_id TEXT,
  ADD COLUMN IF NOT EXISTS puntos_base INT,
  ADD COLUMN IF NOT EXISTS combo       NUMERIC(3,1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cofre       TEXT;
UPDATE public.misiones SET momento = created_at WHERE momento IS NULL;
ALTER TABLE public.misiones ALTER COLUMN momento SET DEFAULT NOW();

-- Firmas viejas (v4: 8 parámetros, v5: 9). Se borran para que no queden
-- varias versiones y la API no sepa cuál llamar. La v6 está en la sección v6.
DROP FUNCTION IF EXISTS public.registrar_mision(UUID, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN, INT);
DROP FUNCTION IF EXISTS public.registrar_mision(UUID, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN, INT, TEXT);

-- ═══════════════════════════════════════════════════════
--  v5 — Puntos por lo completado FUERA de la app
--  (app de Todoist, el coach, el celular…)
--  · Cada 10 min un cron llama a la Edge Function `todoist` con
--    { action: "sync" }; también corre al abrir la pestaña Misiones.
--  · La función lee el registro de actividad de Todoist y suma cada
--    completada con `registrar_mision` (origen 'todoist'). La llave
--    (tarea, fecha de vencimiento) es la misma que usa el botón Hecho,
--    así que nada suma dos veces.
--  · El cron se programa aparte: supabase/cron_todoist.sql
-- ═══════════════════════════════════════════════════════

-- Estado de la sincronización por usuario. Solo la escribe la Edge Function.
CREATE TABLE IF NOT EXISTS public.sync_todoist (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  desde         TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- no se cuenta nada anterior a esto
  ultima        TIMESTAMPTZ,
  ultimo_error  TEXT
);
ALTER TABLE public.sync_todoist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sync_todoist_select" ON public.sync_todoist;
CREATE POLICY "sync_todoist_select" ON public.sync_todoist
  FOR SELECT USING (auth.uid() = user_id);

-- Clave compartida entre el cron y la Edge Function (vive en Supabase Vault).
-- Solo la Edge Function (service_role) puede leerla.
CREATE OR REPLACE FUNCTION public.todoist_cron_secreto()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'todoist_cron_secret' LIMIT 1);
END;
$$;
REVOKE ALL ON FUNCTION public.todoist_cron_secreto() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.todoist_cron_secreto() TO service_role;

-- ═══════════════════════════════════════════════════════
--  v6 — Gamificación
--  Reglas (todas en el servidor):
--   · XP = todo lo ganado (nunca baja). Puntos = saldo para recompensas.
--     Cada punto ganado suma igual a los dos.
--   · Nivel n → n+1 necesita 100 + (n-1)·50 XP.
--     Rangos: Aprendiz (1), Escudero (3), Caballero (6), Paladín (10), Leyenda (15).
--   · v7: los números de abajo son los valores INICIALES; cada usuario los cambia con
--     guardar_reglas() (ver _reglas_defecto). El enfoque da 1 punto por minuto; misión +5
--     (vencida/zombi +10), combo hasta ×1.5, cofres +5/+20, retos +5/+5/+5/+10, jefe +25,
--     tope diario de bonos 50. Lo que dicen las líneas siguientes era el esquema v6.
--   · Combo: otra misión antes de 45 min → ×1, ×1.5, ×2, ×2.5, ×3 (tope).
--   · Racha: días con al menos una misión o un pomodoro. Los escudos (máx. 3)
--     tapan días perdidos.
--   · Cofre al completar una misión (32 %): legendario 4 % (+100), XP doble 8 %
--     (la siguiente misión vale doble), +25 8 %, escudo 6 %, carga de combo 6 %.
--   · Retos de hoy (se cobran con botón): 3 misiones +30, 1 jefe vencido +25,
--     25 min de enfoque +25, 6 misiones +50.
--   · Jefe de proyecto: derrotarlo (vaciar el proyecto) da +200.
-- ═══════════════════════════════════════════════════════

-- Bitácora de todo lo ganado (para estadísticas y auditoría).
CREATE TABLE IF NOT EXISTS public.xp_eventos (
  id       BIGSERIAL PRIMARY KEY,
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  origen   TEXT NOT NULL,          -- mision · sesion · reto · cofre · jefe
  puntos   INT  NOT NULL,
  detalle  TEXT,
  momento  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS xp_eventos_user_momento ON public.xp_eventos (user_id, momento);

CREATE TABLE IF NOT EXISTS public.retos_cobrados (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dia        DATE NOT NULL,
  reto       TEXT NOT NULL,
  cobrado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, dia, reto)
);

CREATE TABLE IF NOT EXISTS public.insignias (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insignia    TEXT NOT NULL,
  obtenida_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, insignia)
);

-- Días en que vació el tablero de Todoist (hoy + vencidas en cero).
CREATE TABLE IF NOT EXISTS public.dias_vaciados (
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dia      DATE NOT NULL,
  PRIMARY KEY (user_id, dia)
);

CREATE TABLE IF NOT EXISTS public.jefes_proyecto (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proyecto_id  TEXT NOT NULL,
  nombre       TEXT NOT NULL,
  hp_max       INT  NOT NULL DEFAULT 1,
  elegido_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  derrotado_en TIMESTAMPTZ
);
-- Un solo jefe activo por usuario.
CREATE UNIQUE INDEX IF NOT EXISTS jefes_proyecto_activo ON public.jefes_proyecto (user_id) WHERE derrotado_en IS NULL;

ALTER TABLE public.xp_eventos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retos_cobrados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insignias      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dias_vaciados  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jefes_proyecto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "xp_eventos_select"     ON public.xp_eventos;
DROP POLICY IF EXISTS "retos_cobrados_select" ON public.retos_cobrados;
DROP POLICY IF EXISTS "insignias_select"      ON public.insignias;
DROP POLICY IF EXISTS "dias_vaciados_select"  ON public.dias_vaciados;
DROP POLICY IF EXISTS "jefes_proyecto_select" ON public.jefes_proyecto;
CREATE POLICY "xp_eventos_select"     ON public.xp_eventos     FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "retos_cobrados_select" ON public.retos_cobrados FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insignias_select"      ON public.insignias      FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "dias_vaciados_select"  ON public.dias_vaciados  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "jefes_proyecto_select" ON public.jefes_proyecto FOR SELECT USING (auth.uid() = user_id);

-- ── Ayudantes internos (nadie de afuera los puede llamar) ──

CREATE OR REPLACE FUNCTION public._dia_cr(p TIMESTAMPTZ)
RETURNS DATE LANGUAGE sql STABLE
AS $$ SELECT (p AT TIME ZONE 'America/Costa_Rica')::date $$;

-- XP total necesario para llegar al nivel n.
CREATE OR REPLACE FUNCTION public._xp_para_nivel(p_nivel INT)
RETURNS INT LANGUAGE sql IMMUTABLE
AS $$ SELECT 100 * (p_nivel - 1) + 25 * (p_nivel - 1) * (p_nivel - 2) $$;

CREATE OR REPLACE FUNCTION public._nivel(p_xp INT)
RETURNS INT LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE n INT := 1;
BEGIN
  WHILE n < 999 AND public._xp_para_nivel(n + 1) <= coalesce(p_xp, 0) LOOP n := n + 1; END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public._rango(p_nivel INT)
RETURNS TEXT LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN p_nivel >= 15 THEN 'Leyenda' WHEN p_nivel >= 10 THEN 'Paladín'
                  WHEN p_nivel >= 6 THEN 'Caballero' WHEN p_nivel >= 3 THEN 'Escudero'
                  ELSE 'Aprendiz' END $$;

-- ── v7: reglas de puntos configurables ──
-- El minuto de enfoque es la moneda base; lo demás son bonos chicos con tope diario.
-- "vencida" y "zombi" son totales (no se suman a la base). tope_bonos = 0 → sin tope.
CREATE OR REPLACE FUNCTION public._reglas_defecto()
RETURNS JSONB LANGUAGE sql IMMUTABLE
AS $$ SELECT '{"min_enfoque": 1, "mision_base": 5, "mision_vencida": 10, "mision_zombi": 10,
               "combo_max": 1.5, "cofre_mas": 5, "cofre_legendario": 20,
               "reto_misiones_3": 5, "reto_jefe_1": 5, "reto_enfoque_25": 5, "reto_misiones_6": 10,
               "jefe_proyecto": 25, "tope_bonos": 50}'::jsonb $$;

CREATE OR REPLACE FUNCTION public._reglas_rangos()
RETURNS JSONB LANGUAGE sql IMMUTABLE
AS $$ SELECT '{"min_enfoque": [0.5, 5], "mision_base": [0, 50], "mision_vencida": [0, 100], "mision_zombi": [0, 100],
               "combo_max": [1, 3], "cofre_mas": [0, 50], "cofre_legendario": [0, 200],
               "reto_misiones_3": [0, 100], "reto_jefe_1": [0, 100], "reto_enfoque_25": [0, 100], "reto_misiones_6": [0, 100],
               "jefe_proyecto": [0, 500], "tope_bonos": [0, 1000]}'::jsonb $$;

-- Defectos + lo guardado (solo claves conocidas con valor numérico).
CREATE OR REPLACE FUNCTION public._reglas(p_user UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT public._reglas_defecto() || coalesce((
    SELECT jsonb_object_agg(e.k, e.v)
      FROM public.perfiles p, jsonb_each(p.reglas) AS e(k, v)
     WHERE p.user_id = p_user AND public._reglas_defecto() ? e.k AND jsonb_typeof(e.v) = 'number'
  ), '{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION public._regla(p_user UUID, p_clave TEXT)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT (public._reglas(p_user) ->> p_clave)::numeric $$;

CREATE OR REPLACE FUNCTION public.reglas_juego()
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  RETURN json_build_object('valores', public._reglas(v_uid),
                           'defectos', public._reglas_defecto(),
                           'rangos',   public._reglas_rangos());
END;
$$;

-- Reemplaza las reglas guardadas por las enviadas (validadas). '{}' = valores recomendados.
CREATE OR REPLACE FUNCTION public.guardar_reglas(p_reglas JSONB)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rangos JSONB := public._reglas_rangos();
  v_nuevo JSONB := '{}'::jsonb;
  k TEXT; v JSONB; n NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_reglas IS NULL OR jsonb_typeof(p_reglas) <> 'object' THEN RAISE EXCEPTION 'Reglas inválidas'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(p_reglas) LOOP
    IF NOT (v_rangos ? k) THEN CONTINUE; END IF;                 -- clave desconocida: se ignora
    IF jsonb_typeof(v) <> 'number' THEN RAISE EXCEPTION 'Valor fuera de rango: %', k; END IF;
    n := (v #>> '{}')::numeric;
    IF n < (v_rangos -> k ->> 0)::numeric OR n > (v_rangos -> k ->> 1)::numeric THEN
      RAISE EXCEPTION 'Valor fuera de rango: %', k;
    END IF;
    v_nuevo := v_nuevo || jsonb_build_object(k, n);
  END LOOP;
  INSERT INTO public.perfiles (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.perfiles SET reglas = v_nuevo WHERE user_id = v_uid;
  RETURN json_build_object('exito', true, 'valores', public._reglas(v_uid));
END;
$$;

-- Suma puntos y XP y lo anota en la bitácora. Devuelve lo realmente otorgado:
-- todo lo que no sea enfoque ('sesion') respeta el tope diario de bonos (regla tope_bonos,
-- día de Costa Rica del momento; 0 = sin tope).
DROP FUNCTION IF EXISTS public._ganar(UUID, INT, TEXT, TEXT, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public._ganar(p_user UUID, p_puntos INT, p_origen TEXT, p_detalle TEXT, p_momento TIMESTAMPTZ DEFAULT NOW())
RETURNS INT LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_pts  INT := coalesce(p_puntos, 0);
  v_mom  TIMESTAMPTZ := coalesce(p_momento, NOW());
  v_tope INT;
  v_ya   INT;
BEGIN
  IF v_pts <= 0 THEN RETURN 0; END IF;
  IF p_origen <> 'sesion' THEN
    v_tope := public._regla(p_user, 'tope_bonos')::int;
    IF v_tope > 0 THEN
      SELECT coalesce(sum(puntos), 0) INTO v_ya FROM public.xp_eventos
       WHERE user_id = p_user AND origen <> 'sesion' AND public._dia_cr(momento) = public._dia_cr(v_mom);
      v_pts := least(v_pts, greatest(0, v_tope - v_ya));
      IF v_pts <= 0 THEN RETURN 0; END IF;
    END IF;
  END IF;
  UPDATE public.perfiles
     SET puntos_totales = puntos_totales + v_pts, xp_total = xp_total + v_pts
   WHERE user_id = p_user;
  INSERT INTO public.xp_eventos (user_id, origen, puntos, detalle, momento)
  VALUES (p_user, p_origen, v_pts, left(p_detalle, 200), v_mom);
  RETURN v_pts;
END;
$$;

-- Racha: un día con actividad. Si faltaron días, los escudos los tapan.
CREATE OR REPLACE FUNCTION public._marcar_actividad(p_user UUID, p_dia DATE)
RETURNS VOID LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE p public.perfiles%ROWTYPE; v_hueco INT;
BEGIN
  SELECT * INTO p FROM public.perfiles WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p.ultimo_dia IS NOT NULL AND p_dia <= p.ultimo_dia THEN RETURN; END IF;  -- ya contado (o atrasado)
  IF p.ultimo_dia IS NULL THEN
    p.racha := 1;
  ELSE
    v_hueco := p_dia - p.ultimo_dia - 1;
    IF v_hueco = 0 THEN p.racha := p.racha + 1;
    ELSIF v_hueco <= p.escudos THEN p.escudos := p.escudos - v_hueco; p.racha := p.racha + 1;
    ELSE p.racha := 1;
    END IF;
  END IF;
  UPDATE public.perfiles
     SET racha = p.racha, racha_max = greatest(racha_max, p.racha), escudos = p.escudos, ultimo_dia = p_dia
   WHERE user_id = p_user;
END;
$$;

CREATE OR REPLACE FUNCTION public._insignia(p_user UUID, p_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE n INT;
BEGIN
  INSERT INTO public.insignias (user_id, insignia) VALUES (p_user, p_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

-- Revisa las 17 insignias y devuelve las recién ganadas.
CREATE OR REPLACE FUNCTION public._revisar_insignias(p_user UUID)
RETURNS TEXT[] LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  p public.perfiles%ROWTYPE;
  v_mis INT; v_jef INT; v_zom INT; v_hip INT; v_mad BOOLEAN; v_enf INT;
  cand TEXT[] := '{}'; nuevas TEXT[] := '{}'; i TEXT;
BEGIN
  SELECT * INTO p FROM public.perfiles WHERE user_id = p_user;
  SELECT count(*), count(*) FILTER (WHERE vencida), count(*) FILTER (WHERE zombi),
         count(*) FILTER (WHERE etiquetas @> ARRAY['🎯_Hiperfoco']),
         coalesce(bool_or((momento AT TIME ZONE 'America/Costa_Rica')::time < '07:30'), FALSE)
    INTO v_mis, v_jef, v_zom, v_hip, v_mad
    FROM public.misiones WHERE user_id = p_user;
  SELECT coalesce(sum(duracion_minutos), 0) INTO v_enf
    FROM public.sesiones WHERE user_id = p_user AND tipo = 'trabajo' AND completada;

  IF v_mis >= 1   THEN cand := cand || 'primer_paso'::text; END IF;
  IF v_mis >= 25  THEN cand := cand || 'misiones_25'::text; END IF;
  IF v_mis >= 100 THEN cand := cand || 'misiones_100'::text; END IF;
  IF p.racha_max >= 3  THEN cand := cand || 'racha_3'::text; END IF;
  IF p.racha_max >= 7  THEN cand := cand || 'racha_7'::text; END IF;
  IF p.racha_max >= 30 THEN cand := cand || 'racha_30'::text; END IF;
  IF v_jef >= 10 THEN cand := cand || 'jefes_10'::text; END IF;
  IF p.combo_max >= public._regla(p_user, 'combo_max') AND public._regla(p_user, 'combo_max') > 1 THEN
    cand := cand || 'combo_x3'::text;   -- "Combo máximo": el tope que tenga configurado
  END IF;
  IF v_enf >= 300 THEN cand := cand || 'enfoque_300'::text; END IF;
  IF (SELECT count(*) FROM public.dias_vaciados WHERE user_id = p_user) >= 5 THEN cand := cand || 'vaciados_5'::text; END IF;
  IF v_zom >= 1 THEN cand := cand || 'cazazombis'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.jefes_proyecto WHERE user_id = p_user AND derrotado_en IS NOT NULL) THEN cand := cand || 'matadragones'::text; END IF;
  IF v_mad THEN cand := cand || 'madrugador'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.retos_cobrados WHERE user_id = p_user GROUP BY dia HAVING count(*) >= 4) THEN cand := cand || 'dia_perfecto'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.misiones WHERE user_id = p_user AND cofre = 'legendario') THEN cand := cand || 'suertudo'::text; END IF;
  IF v_hip >= 10 THEN cand := cand || 'hiperfoco_10'::text; END IF;
  IF public._nivel(p.xp_total) >= 10 THEN cand := cand || 'nivel_10'::text; END IF;

  FOREACH i IN ARRAY cand LOOP
    IF public._insignia(p_user, i) THEN nuevas := nuevas || i; END IF;
  END LOOP;
  RETURN nuevas;
END;
$$;

-- Retos del día: (id, nombre, meta, premio). El premio sale de las reglas del usuario.
DROP FUNCTION IF EXISTS public._retos();
CREATE OR REPLACE FUNCTION public._retos(p_user UUID)
RETURNS TABLE (id TEXT, nombre TEXT, meta INT, premio INT) LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT * FROM (VALUES
        ('misiones_3'::text, 'Complete 3 misiones'::text, 3, public._regla(p_user, 'reto_misiones_3')::int),
        ('jefe_1',          'Derrote 1 jefe vencido',     1, public._regla(p_user, 'reto_jefe_1')::int),
        ('enfoque_25',      'Haga 25 min de enfoque',    25, public._regla(p_user, 'reto_enfoque_25')::int),
        ('misiones_6',      'Complete 6 misiones',        6, public._regla(p_user, 'reto_misiones_6')::int)
      ) AS t(id, nombre, meta, premio) $$;

CREATE OR REPLACE FUNCTION public._progreso_reto(p_user UUID, p_reto TEXT, p_dia DATE)
RETURNS INT LANGUAGE plpgsql STABLE SET search_path = public
AS $$
BEGIN
  IF p_reto IN ('misiones_3', 'misiones_6') THEN
    RETURN (SELECT count(*) FROM public.misiones WHERE user_id = p_user AND public._dia_cr(momento) = p_dia);
  ELSIF p_reto = 'jefe_1' THEN
    RETURN (SELECT count(*) FROM public.misiones WHERE user_id = p_user AND vencida AND public._dia_cr(momento) = p_dia);
  ELSIF p_reto = 'enfoque_25' THEN
    RETURN (SELECT coalesce(sum(duracion_minutos), 0) FROM public.sesiones
             WHERE user_id = p_user AND tipo = 'trabajo' AND completada AND public._dia_cr(created_at) = p_dia);
  END IF;
  RETURN 0;
END;
$$;

-- ── Misiones (v6): combo, XP doble, cofres, racha e insignias ──
CREATE OR REPLACE FUNCTION public.registrar_mision(
  p_user_id     UUID,
  p_task_id     TEXT,
  p_ocurrencia  TEXT,
  p_contenido   TEXT,
  p_proyecto    TEXT,
  p_prioridad   INT,
  p_vencida     BOOLEAN,
  p_puntos      INT DEFAULT NULL,         -- obsoleto: se ignora; el bono sale de las reglas del usuario
  p_origen      TEXT DEFAULT 'app',
  p_momento     TIMESTAMPTZ DEFAULT NULL, -- cuándo se completó (sync: hora real en Todoist)
  p_zombi       BOOLEAN DEFAULT FALSE,
  p_etiquetas   TEXT[] DEFAULT NULL,
  p_proyecto_id TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filas   INT := 0;
  v_mom     TIMESTAMPTZ := least(coalesce(p_momento, NOW()), NOW());
  p         public.perfiles%ROWTYPE;
  v_n       INT;
  v_mult    NUMERIC(3,1) := 1;
  v_doble   BOOLEAN := FALSE;
  v_final   INT;
  v_base    INT;
  v_gan     INT;
  v_r       FLOAT8;
  v_cofre   TEXT;
  v_cofre_p INT := 0;
  v_ins     TEXT[];
BEGIN
  IF p_user_id IS NULL OR p_task_id IS NULL OR p_ocurrencia IS NULL THEN
    RAISE EXCEPTION 'Datos incompletos';
  END IF;
  IF coalesce(p_origen, 'app') NOT IN ('app', 'todoist') THEN
    RAISE EXCEPTION 'Origen inválido';
  END IF;

  INSERT INTO public.perfiles (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO p FROM public.perfiles WHERE user_id = p_user_id FOR UPDATE;

  -- Bono base de la misión (reglas del usuario). Vencida y zombi son totales, no extras;
  -- si aplican las dos, vale el mayor; nunca menos que la base.
  v_base := greatest(
    public._regla(p_user_id, 'mision_base'),
    CASE WHEN coalesce(p_vencida, FALSE) THEN public._regla(p_user_id, 'mision_vencida') ELSE 0 END,
    CASE WHEN coalesce(p_zombi, FALSE)   THEN public._regla(p_user_id, 'mision_zombi')   ELSE 0 END
  )::int;

  INSERT INTO public.misiones (user_id, task_id, ocurrencia, contenido, proyecto, prioridad, vencida, puntos,
                               origen, momento, zombi, etiquetas, proyecto_id, puntos_base)
  VALUES (p_user_id, p_task_id, left(p_ocurrencia, 40), left(coalesce(p_contenido, 'Tarea'), 300),
          left(p_proyecto, 120), coalesce(p_prioridad, 4), coalesce(p_vencida, FALSE), v_base,
          coalesce(p_origen, 'app'), v_mom, coalesce(p_zombi, FALSE), coalesce(p_etiquetas, '{}'),
          left(p_proyecto_id, 60), v_base)
  ON CONFLICT (user_id, task_id, ocurrencia) DO NOTHING;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas = 0 THEN
    RETURN json_build_object('exito', true, 'nueva', false, 'puntos_totales', p.puntos_totales, 'puntos_ganados', 0);
  END IF;

  -- Combo: a 45 min o menos de la anterior, la cadena sigue.
  IF p.combo_en IS NOT NULL AND v_mom < p.combo_en THEN
    v_n := -1;                                   -- llegó atrasada (sync): sin combo y sin tocar la cadena
  ELSIF p.combo_en IS NOT NULL AND v_mom - p.combo_en <= INTERVAL '45 minutes' THEN
    v_n := p.combo_n + 1;
  ELSE
    v_n := 0;
  END IF;
  v_mult := least(public._regla(p_user_id, 'combo_max'), 1 + 0.5 * greatest(v_n, 0));
  IF p.dobles > 0 THEN v_doble := TRUE; END IF;
  v_final := round(v_base * v_mult * (CASE WHEN v_doble THEN 2 ELSE 1 END));

  -- Cofre (32 %)
  v_r := random();
  v_cofre := CASE WHEN v_r < 0.04 THEN 'legendario' WHEN v_r < 0.12 THEN 'doble'
                  WHEN v_r < 0.20 THEN 'mas25' WHEN v_r < 0.26 THEN 'escudo'
                  WHEN v_r < 0.32 THEN 'combo' ELSE NULL END;

  UPDATE public.perfiles
     SET combo_n   = CASE WHEN v_n >= 0 THEN v_n ELSE combo_n END,
         combo_en  = CASE WHEN v_n >= 0 THEN v_mom ELSE combo_en END,
         combo_max = greatest(combo_max, v_mult),
         dobles    = dobles - (CASE WHEN v_doble THEN 1 ELSE 0 END)
   WHERE user_id = p_user_id;
  -- Lo otorgado puede ser menor que v_final si el tope diario de bonos lo recorta.
  v_gan := public._ganar(p_user_id, v_final, 'mision', p_contenido, v_mom);
  UPDATE public.misiones SET puntos = v_gan, combo = v_mult, cofre = v_cofre
   WHERE user_id = p_user_id AND task_id = p_task_id AND ocurrencia = left(p_ocurrencia, 40);

  IF v_cofre = 'legendario' THEN
    v_cofre_p := public._ganar(p_user_id, public._regla(p_user_id, 'cofre_legendario')::int, 'cofre', 'legendario', v_mom);
  ELSIF v_cofre = 'mas25' THEN
    v_cofre_p := public._ganar(p_user_id, public._regla(p_user_id, 'cofre_mas')::int, 'cofre', 'mas25', v_mom);
  ELSIF v_cofre = 'doble' THEN
    UPDATE public.perfiles SET dobles = dobles + 1 WHERE user_id = p_user_id;
  ELSIF v_cofre = 'escudo' THEN
    IF p.escudos >= 3 THEN   -- ya tiene 3: se cambia por puntos
      v_cofre_p := public._ganar(p_user_id, public._regla(p_user_id, 'cofre_mas')::int, 'cofre', 'escudo_lleno', v_mom);
    ELSE
      UPDATE public.perfiles SET escudos = least(3, escudos + 1) WHERE user_id = p_user_id;
    END IF;
  ELSIF v_cofre = 'combo' THEN   -- la siguiente misión sube un escalón más de combo
    UPDATE public.perfiles SET combo_n = combo_n + 1, combo_en = greatest(coalesce(combo_en, v_mom), v_mom)
     WHERE user_id = p_user_id;
  END IF;

  PERFORM public._marcar_actividad(p_user_id, public._dia_cr(v_mom));
  v_ins := public._revisar_insignias(p_user_id);

  SELECT * INTO p FROM public.perfiles WHERE user_id = p_user_id;
  RETURN json_build_object(
    'exito', true, 'nueva', true,
    'puntos_base', v_base, 'combo', v_mult, 'doble', v_doble,
    'puntos_mision', v_gan, 'cofre', v_cofre, 'cofre_puntos', v_cofre_p,
    'puntos_ganados', v_gan + v_cofre_p,
    'puntos_totales', p.puntos_totales, 'xp_total', p.xp_total,
    'nivel', public._nivel(p.xp_total), 'racha', p.racha, 'insignias', to_json(v_ins));
END;
$$;

-- ── Lo que el navegador sí puede llamar ──

-- Cobra un reto de hoy, si de verdad lo cumplió.
CREATE OR REPLACE FUNCTION public.cobrar_reto(p_reto TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_dia DATE := public._dia_cr(NOW());
  r RECORD; v_prog INT; v_filas INT; v_ins TEXT[]; v_pts INT; v_gan INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT * INTO r FROM public._retos(v_uid) t WHERE t.id = p_reto;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reto desconocido'; END IF;
  v_prog := public._progreso_reto(v_uid, p_reto, v_dia);
  IF v_prog < r.meta THEN
    RETURN json_build_object('exito', false, 'mensaje', 'Todavía no lo cumple', 'progreso', v_prog, 'meta', r.meta);
  END IF;
  INSERT INTO public.perfiles (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.retos_cobrados (user_id, dia, reto) VALUES (v_uid, v_dia, p_reto) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas = 0 THEN RETURN json_build_object('exito', false, 'mensaje', 'Ya lo cobró hoy'); END IF;
  v_gan := public._ganar(v_uid, r.premio, 'reto', r.nombre, NOW());
  v_ins := public._revisar_insignias(v_uid);
  SELECT puntos_totales INTO v_pts FROM public.perfiles WHERE user_id = v_uid;
  RETURN json_build_object('exito', true, 'premio', v_gan, 'puntos_totales', v_pts, 'insignias', to_json(v_ins));
END;
$$;

-- Check-in de energía del día (alta · media · baja). No da puntos.
CREATE OR REPLACE FUNCTION public.registrar_energia(p_energia TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_energia NOT IN ('alta', 'media', 'baja') THEN RAISE EXCEPTION 'Energía inválida'; END IF;
  INSERT INTO public.perfiles (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.perfiles SET energia = p_energia, energia_dia = public._dia_cr(NOW()) WHERE user_id = v_uid;
  RETURN json_build_object('exito', true, 'energia', p_energia);
END;
$$;

-- Todo lo que la pantalla necesita: nivel, racha, combo, retos, insignias, energía y jefe.
CREATE OR REPLACE FUNCTION public.estado_juego()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_hoy DATE := public._dia_cr(NOW());
  p public.perfiles%ROWTYPE;
  v_nivel INT; v_racha INT; v_hueco INT; v_combo NUMERIC(3,1) := 1; v_vence TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT * INTO p FROM public.perfiles WHERE user_id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('exito', false); END IF;
  v_nivel := public._nivel(p.xp_total);

  -- Racha que se ve hoy: se pierde si faltan más días de los que tapan los escudos.
  IF p.ultimo_dia IS NULL THEN v_racha := 0;
  ELSE
    v_hueco := v_hoy - p.ultimo_dia - 1;
    v_racha := CASE WHEN v_hueco <= 0 OR v_hueco <= p.escudos THEN p.racha ELSE 0 END;
  END IF;
  IF p.combo_en IS NOT NULL AND NOW() - p.combo_en <= INTERVAL '45 minutes' THEN
    v_combo := least(public._regla(v_uid, 'combo_max'), 1 + 0.5 * p.combo_n);
    v_vence := p.combo_en + INTERVAL '45 minutes';
  END IF;

  RETURN json_build_object(
    'exito', true,
    'xp_total', p.xp_total, 'puntos', p.puntos_totales,
    'reglas', public._reglas(v_uid),
    'bonos_hoy', (SELECT coalesce(sum(puntos), 0) FROM public.xp_eventos
                   WHERE user_id = v_uid AND origen <> 'sesion' AND public._dia_cr(momento) = v_hoy),
    'nivel', v_nivel, 'rango', public._rango(v_nivel),
    'xp_nivel', p.xp_total - public._xp_para_nivel(v_nivel),
    'xp_siguiente', 100 + (v_nivel - 1) * 50,
    'racha', v_racha, 'racha_max', p.racha_max, 'escudos', p.escudos,
    'combo', v_combo, 'combo_siguiente', CASE WHEN v_vence IS NULL THEN 1 ELSE least(public._regla(v_uid, 'combo_max'), v_combo + 0.5) END,
    'combo_vence', v_vence, 'dobles', p.dobles,
    'energia', CASE WHEN p.energia_dia = v_hoy THEN p.energia END,
    'hoy', (SELECT count(*) FROM public.misiones WHERE user_id = v_uid AND public._dia_cr(momento) = v_hoy),
    'retos', (SELECT json_agg(json_build_object(
                'id', t.id, 'nombre', t.nombre, 'meta', t.meta, 'premio', t.premio,
                'progreso', least(t.meta, public._progreso_reto(v_uid, t.id, v_hoy)),
                'cobrado', EXISTS (SELECT 1 FROM public.retos_cobrados c WHERE c.user_id = v_uid AND c.dia = v_hoy AND c.reto = t.id)))
              FROM public._retos(v_uid) t),
    'insignias', (SELECT coalesce(json_agg(json_build_object('id', insignia, 'fecha', obtenida_en) ORDER BY obtenida_en), '[]'::json)
                    FROM public.insignias WHERE user_id = v_uid),
    'jefe', (SELECT json_build_object('proyecto_id', proyecto_id, 'nombre', nombre, 'hp_max', hp_max)
               FROM public.jefes_proyecto WHERE user_id = v_uid AND derrotado_en IS NULL LIMIT 1));
END;
$$;

-- Estadísticas: XP por día, mejores horas y proyectos donde más avanza.
CREATE OR REPLACE FUNCTION public.estadisticas_juego(p_dias INT DEFAULT 30)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid UUID := auth.uid(); v_desde TIMESTAMPTZ := NOW() - make_interval(days => least(greatest(p_dias, 1), 365));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  RETURN json_build_object(
    'xp_por_dia', (SELECT coalesce(json_agg(json_build_object('dia', dia, 'xp', xp) ORDER BY dia), '[]'::json) FROM (
        SELECT public._dia_cr(momento) AS dia, sum(puntos) AS xp FROM public.xp_eventos
         WHERE user_id = v_uid AND momento >= v_desde GROUP BY 1) x),
    'por_hora', (SELECT coalesce(json_agg(json_build_object('hora', hora, 'xp', xp, 'veces', veces) ORDER BY hora), '[]'::json) FROM (
        SELECT extract(hour FROM momento AT TIME ZONE 'America/Costa_Rica')::int AS hora, sum(puntos) AS xp, count(*) AS veces
          FROM public.xp_eventos WHERE user_id = v_uid AND momento >= v_desde AND origen IN ('mision', 'sesion') GROUP BY 1) h),
    'por_proyecto', (SELECT coalesce(json_agg(json_build_object('proyecto', proyecto, 'puntos', pts, 'misiones', n) ORDER BY pts DESC), '[]'::json) FROM (
        SELECT coalesce(proyecto, 'Sin proyecto') AS proyecto, sum(puntos) AS pts, count(*) AS n
          FROM public.misiones WHERE user_id = v_uid AND momento >= v_desde GROUP BY 1 ORDER BY 2 DESC LIMIT 8) q));
END;
$$;

-- ── Solo la Edge Function (service_role) ──

CREATE OR REPLACE FUNCTION public.elegir_jefe(p_user UUID, p_proyecto_id TEXT, p_nombre TEXT, p_hp INT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM public.jefes_proyecto WHERE user_id = p_user AND derrotado_en IS NULL;  -- se abandona el anterior
  INSERT INTO public.jefes_proyecto (user_id, proyecto_id, nombre, hp_max)
  VALUES (p_user, p_proyecto_id, left(p_nombre, 120), greatest(1, coalesce(p_hp, 1)));
  RETURN json_build_object('exito', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.actualizar_hp_jefe(p_user UUID, p_hp INT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ UPDATE public.jefes_proyecto SET hp_max = greatest(hp_max, coalesce(p_hp, 0))
       WHERE user_id = p_user AND derrotado_en IS NULL $$;

-- El proyecto quedó sin tareas: +200. Exige al menos una misión de ese proyecto
-- desde que se eligió (borrar todo no cuenta como derrotarlo).
CREATE OR REPLACE FUNCTION public.derrotar_jefe(p_user UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.jefes_proyecto%ROWTYPE; v_ins TEXT[]; v_pts INT; v_gan INT;
BEGIN
  SELECT * INTO j FROM public.jefes_proyecto WHERE user_id = p_user AND derrotado_en IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('exito', false, 'motivo', 'sin_jefe'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.misiones WHERE user_id = p_user AND proyecto_id = j.proyecto_id AND momento >= j.elegido_en) THEN
    RETURN json_build_object('exito', false, 'motivo', 'sin_misiones');
  END IF;
  UPDATE public.jefes_proyecto SET derrotado_en = NOW() WHERE id = j.id;
  v_gan := public._ganar(p_user, public._regla(p_user, 'jefe_proyecto')::int, 'jefe', j.nombre, NOW());
  v_ins := public._revisar_insignias(p_user);
  SELECT puntos_totales INTO v_pts FROM public.perfiles WHERE user_id = p_user;
  RETURN json_build_object('exito', true, 'premio', v_gan, 'nombre', j.nombre, 'puntos_totales', v_pts, 'insignias', to_json(v_ins));
END;
$$;

-- Tablero vacío hoy (cuenta solo si completó al menos una misión hoy).
CREATE OR REPLACE FUNCTION public.registrar_vaciado(p_user UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_hoy DATE := public._dia_cr(NOW()); v_n INT; v_ins TEXT[] := '{}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.misiones WHERE user_id = p_user AND public._dia_cr(momento) = v_hoy) THEN
    RETURN json_build_object('exito', false);
  END IF;
  INSERT INTO public.dias_vaciados (user_id, dia) VALUES (p_user, v_hoy) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_ins := public._revisar_insignias(p_user); END IF;
  RETURN json_build_object('exito', true, 'nuevo', v_n > 0, 'insignias', to_json(v_ins));
END;
$$;

-- ── XP histórico (una sola vez por perfil existente) ──
-- Lo ganado antes de v6 (pomodoros y misiones) entra a la bitácora y al XP,
-- y la racha se calcula con los días que ya tenía actividad.
DO $$
DECLARE
  r RECORD; d DATE; v_prev DATE; v_run INT; v_max INT;
BEGIN
  FOR r IN SELECT user_id FROM public.perfiles WHERE NOT gamificacion_v6 LOOP
    INSERT INTO public.xp_eventos (user_id, origen, puntos, detalle, momento)
    SELECT user_id, 'sesion', duracion_minutos, left(coalesce(nota, categoria), 120), created_at
      FROM public.sesiones WHERE user_id = r.user_id AND tipo = 'trabajo' AND completada AND created_at IS NOT NULL;
    INSERT INTO public.xp_eventos (user_id, origen, puntos, detalle, momento)
    SELECT user_id, 'mision', puntos, left(contenido, 200), momento
      FROM public.misiones WHERE user_id = r.user_id;

    v_prev := NULL; v_run := 0; v_max := 0;
    FOR d IN SELECT DISTINCT public._dia_cr(momento) FROM public.xp_eventos WHERE user_id = r.user_id ORDER BY 1 LOOP
      IF v_prev IS NOT NULL AND d = v_prev + 1 THEN v_run := v_run + 1; ELSE v_run := 1; END IF;
      v_max := greatest(v_max, v_run); v_prev := d;
    END LOOP;

    UPDATE public.perfiles
       SET xp_total = (SELECT coalesce(sum(puntos), 0) FROM public.xp_eventos WHERE user_id = r.user_id),
           racha = v_run, racha_max = v_max, ultimo_dia = v_prev, gamificacion_v6 = TRUE
     WHERE user_id = r.user_id;
  END LOOP;
END $$;

-- ── Permisos ──
REVOKE ALL ON FUNCTION public._ganar(UUID, INT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._marcar_actividad(UUID, DATE)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._insignia(UUID, TEXT)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._revisar_insignias(UUID)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._progreso_reto(UUID, TEXT, DATE)           FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.registrar_mision(UUID, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN, INT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT[], TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_mision(UUID, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN, INT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT[], TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.elegir_jefe(UUID, TEXT, TEXT, INT)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.actualizar_hp_jefe(UUID, INT)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.derrotar_jefe(UUID)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_vaciado(UUID)             FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.elegir_jefe(UUID, TEXT, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_hp_jefe(UUID, INT)      TO service_role;
GRANT EXECUTE ON FUNCTION public.derrotar_jefe(UUID)                TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_vaciado(UUID)            TO service_role;

REVOKE ALL ON FUNCTION public.cobrar_reto(TEXT)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_energia(TEXT)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.estado_juego()              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.estadisticas_juego(INT)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobrar_reto(TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_energia(TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.estado_juego()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.estadisticas_juego(INT)  TO authenticated;

-- v7: reglas de puntos
REVOKE ALL ON FUNCTION public._reglas_defecto()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reglas_rangos()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reglas(UUID)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._regla(UUID, TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._retos(UUID)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reglas_juego()               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guardar_reglas(JSONB)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reglas_juego()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_reglas(JSONB)     TO authenticated;

-- ═══════════════════════════════════════════════════════
--  v7 — Música de enfoque (Spotify)
--  · perfiles.spotify_url: playlist (o álbum) para el modo enfoque.
--  · Se guarda con guardar_spotify(), que solo acepta enlaces de Spotify
--    y los deja en forma limpia: https://open.spotify.com/<tipo>/<id>
-- ═══════════════════════════════════════════════════════
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS spotify_url TEXT;

CREATE OR REPLACE FUNCTION public.guardar_spotify(p_url TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid UUID := auth.uid(); m TEXT[]; v_limpia TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF coalesce(trim(p_url), '') <> '' THEN
    m := regexp_match(trim(p_url), '^https://open\.spotify\.com/(?:intl-[a-z]{2}(?:-[a-z]{2})?/)?(playlist|album|artist|show)/([A-Za-z0-9]{10,40})');
    IF m IS NULL THEN
      m := regexp_match(trim(p_url), '^spotify:(playlist|album|artist|show):([A-Za-z0-9]{10,40})$');
    END IF;
    IF m IS NULL THEN
      RETURN json_build_object('exito', false, 'mensaje', 'Ese no parece un enlace de Spotify (playlist, álbum, artista o pódcast).');
    END IF;
    v_limpia := 'https://open.spotify.com/' || m[1] || '/' || m[2];
  END IF;
  INSERT INTO public.perfiles (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.perfiles SET spotify_url = v_limpia WHERE user_id = v_uid;
  RETURN json_build_object('exito', true, 'spotify_url', v_limpia);
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_spotify(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_spotify(TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════
--  v8 — Endurecimiento de seguridad y rendimiento
--  (aplicado en Supabase como la migración `focus_v8_seguridad`)
--  · search_path fijo en las funciones auxiliares.
--  · Permisos mínimos: `anon` no ve nada; `authenticated` solo lo que usa la app.
--  · RLS con (select auth.uid()) para evaluarlo una vez por consulta.
--  · Índices en claves foráneas.
-- ═══════════════════════════════════════════════════════
ALTER FUNCTION public._dia_cr(timestamptz)      SET search_path = public;
ALTER FUNCTION public._xp_para_nivel(int)       SET search_path = public;
ALTER FUNCTION public._nivel(int)               SET search_path = public;
ALTER FUNCTION public._rango(int)               SET search_path = public;
ALTER FUNCTION public._reglas_defecto()         SET search_path = public;
ALTER FUNCTION public._reglas_rangos()          SET search_path = public;

REVOKE ALL ON public.canjes, public.dias_vaciados, public.insignias, public.jefes_proyecto,
  public.misiones, public.perfiles, public.recompensas, public.retos_cobrados,
  public.sesiones, public.sync_todoist, public.xp_eventos FROM anon, authenticated;
GRANT SELECT ON public.canjes, public.dias_vaciados, public.insignias, public.jefes_proyecto,
  public.misiones, public.perfiles, public.recompensas, public.retos_cobrados,
  public.sesiones, public.sync_todoist, public.xp_eventos TO authenticated;
GRANT INSERT ON public.perfiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.recompensas TO authenticated;

ALTER POLICY canjes_select         ON public.canjes         USING ((select auth.uid()) = user_id);
ALTER POLICY dias_vaciados_select  ON public.dias_vaciados  USING ((select auth.uid()) = user_id);
ALTER POLICY insignias_select      ON public.insignias      USING ((select auth.uid()) = user_id);
ALTER POLICY jefes_proyecto_select ON public.jefes_proyecto USING ((select auth.uid()) = user_id);
ALTER POLICY misiones_select       ON public.misiones       USING ((select auth.uid()) = user_id);
ALTER POLICY perfiles_select       ON public.perfiles       USING ((select auth.uid()) = user_id);
ALTER POLICY retos_cobrados_select ON public.retos_cobrados USING ((select auth.uid()) = user_id);
ALTER POLICY sesiones_select       ON public.sesiones       USING ((select auth.uid()) = user_id);
ALTER POLICY sync_todoist_select   ON public.sync_todoist   USING ((select auth.uid()) = user_id);
ALTER POLICY xp_eventos_select     ON public.xp_eventos     USING ((select auth.uid()) = user_id);
ALTER POLICY recompensas_select    ON public.recompensas    USING ((select auth.uid()) = user_id);
ALTER POLICY recompensas_delete    ON public.recompensas    USING ((select auth.uid()) = user_id);
ALTER POLICY recompensas_insert    ON public.recompensas    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY recompensas_update    ON public.recompensas    USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY perfiles_insert       ON public.perfiles WITH CHECK (
  (select auth.uid()) = user_id AND puntos_totales = 0 AND xp_total = 0
  AND racha = 0 AND racha_max = 0 AND escudos = 0 AND combo_n = 0 AND dobles = 0
  AND combo_max = 1 AND ultimo_dia IS NULL AND combo_en IS NULL AND gamificacion_v6);

CREATE INDEX IF NOT EXISTS sesiones_user_created ON public.sesiones (user_id, created_at);
CREATE INDEX IF NOT EXISTS canjes_user_id        ON public.canjes (user_id, creado_en);
CREATE INDEX IF NOT EXISTS canjes_recompensa_id  ON public.canjes (recompensa_id);
CREATE INDEX IF NOT EXISTS recompensas_user_id   ON public.recompensas (user_id);

-- ═══ v9 — Tiempo por misión (ver supabase/v9_tiempo_por_mision.sql) ═══
-- v9: cada sesión de trabajo guarda a qué misión (tarea de Todoist) se le dedicó.
-- Solo aplica a sesiones nuevas; las anteriores quedan sin misión.
ALTER TABLE public.sesiones
  ADD COLUMN IF NOT EXISTS task_id     TEXT,
  ADD COLUMN IF NOT EXISTS proyecto_id TEXT,
  ADD COLUMN IF NOT EXISTS mision      TEXT,
  ADD COLUMN IF NOT EXISTS proyecto    TEXT;

CREATE INDEX IF NOT EXISTS sesiones_user_task ON public.sesiones (user_id, task_id) WHERE task_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.registrar_sesion(INT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.registrar_sesion(
  p_duracion    INT,
  p_tipo        TEXT,
  p_categoria   TEXT DEFAULT 'general',
  p_nota        TEXT DEFAULT NULL,
  p_task_id     TEXT DEFAULT NULL,
  p_proyecto_id TEXT DEFAULT NULL,
  p_mision      TEXT DEFAULT NULL,
  p_proyecto    TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_ins  TEXT[] := '{}';
  v_p    public.perfiles%ROWTYPE;
  v_gan  INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_tipo NOT IN ('trabajo','descanso') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF p_duracion IS NULL OR p_duracion < 1 OR p_duracion > 240 THEN   -- el cronómetro cuenta hasta 4 h
    RAISE EXCEPTION 'Duración inválida';
  END IF;

  INSERT INTO public.perfiles (user_id) VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.sesiones (user_id, duracion_minutos, tipo, completada, categoria, nota,
                               task_id, proyecto_id, mision, proyecto)
  VALUES (v_uid, p_duracion, p_tipo, TRUE,
          left(coalesce(p_categoria, 'general'), 30),
          left(p_nota, 500),
          CASE WHEN p_tipo = 'trabajo' THEN left(p_task_id, 64) END,
          CASE WHEN p_tipo = 'trabajo' THEN left(p_proyecto_id, 64) END,
          CASE WHEN p_tipo = 'trabajo' THEN left(p_mision, 200) END,
          CASE WHEN p_tipo = 'trabajo' THEN left(p_proyecto, 120) END);

  IF p_tipo = 'trabajo' THEN
    v_gan := public._ganar(v_uid, round(p_duracion * public._regla(v_uid, 'min_enfoque'))::int,
                           'sesion', coalesce(left(p_nota, 120), p_categoria), now());
    PERFORM public._marcar_actividad(v_uid, public._dia_cr(now()));
    v_ins := public._revisar_insignias(v_uid);
  END IF;

  SELECT * INTO v_p FROM public.perfiles WHERE user_id = v_uid;
  RETURN json_build_object('exito', true, 'puntos_ganados', v_gan, 'puntos_totales', v_p.puntos_totales,
                           'xp_total', v_p.xp_total, 'insignias', to_json(v_ins));
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_sesion(INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_sesion(INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
