-- ═══════════════════════════════════════════════════════
--  FOCUS — Esquema SQL para Supabase (v4)
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
  FOR INSERT WITH CHECK (auth.uid() = user_id AND puntos_totales = 0);

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

-- Registra una sesión terminada y suma los puntos (1 min de trabajo = 1 punto).
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
  v_uid    UUID := auth.uid();
  v_puntos INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_tipo NOT IN ('trabajo','descanso') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF p_duracion IS NULL OR p_duracion < 1 OR p_duracion > 180 THEN
    RAISE EXCEPTION 'Duración inválida';
  END IF;

  INSERT INTO public.perfiles (user_id) VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.sesiones (user_id, duracion_minutos, tipo, completada, categoria, nota)
  VALUES (v_uid, p_duracion, p_tipo, TRUE,
          left(coalesce(p_categoria, 'general'), 30),
          left(p_nota, 500));

  IF p_tipo = 'trabajo' THEN
    UPDATE public.perfiles SET puntos_totales = puntos_totales + p_duracion
    WHERE user_id = v_uid;
  END IF;

  SELECT puntos_totales INTO v_puntos FROM public.perfiles WHERE user_id = v_uid;
  RETURN json_build_object('exito', true, 'puntos_totales', v_puntos);
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

CREATE OR REPLACE FUNCTION public.registrar_mision(
  p_user_id    UUID,
  p_task_id    TEXT,
  p_ocurrencia TEXT,
  p_contenido  TEXT,
  p_proyecto   TEXT,
  p_prioridad  INT,
  p_vencida    BOOLEAN,
  p_puntos     INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filas  INT := 0;
  v_nueva  BOOLEAN := FALSE;
  v_puntos INT;
BEGIN
  IF p_user_id IS NULL OR p_task_id IS NULL OR p_ocurrencia IS NULL THEN
    RAISE EXCEPTION 'Datos incompletos';
  END IF;
  IF p_puntos IS NULL OR p_puntos < 1 OR p_puntos > 150 THEN
    RAISE EXCEPTION 'Puntos inválidos';
  END IF;

  INSERT INTO public.perfiles (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.misiones (user_id, task_id, ocurrencia, contenido, proyecto, prioridad, vencida, puntos)
  VALUES (p_user_id, p_task_id, left(p_ocurrencia, 40), left(coalesce(p_contenido, 'Tarea'), 300),
          left(p_proyecto, 120), coalesce(p_prioridad, 4), coalesce(p_vencida, FALSE), p_puntos)
  ON CONFLICT (user_id, task_id, ocurrencia) DO NOTHING;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  v_nueva := v_filas > 0;

  IF v_nueva THEN
    UPDATE public.perfiles SET puntos_totales = puntos_totales + p_puntos
    WHERE user_id = p_user_id;
  END IF;

  SELECT puntos_totales INTO v_puntos FROM public.perfiles WHERE user_id = p_user_id;
  RETURN json_build_object('exito', true, 'nueva', v_nueva, 'puntos_totales', v_puntos,
                           'puntos_ganados', CASE WHEN v_nueva THEN p_puntos ELSE 0 END);
END;
$$;

-- Solo la Edge Function (service_role) puede sumar puntos de misión.
REVOKE ALL ON FUNCTION public.registrar_mision(UUID, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_mision(UUID, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN, INT)
  TO service_role;
