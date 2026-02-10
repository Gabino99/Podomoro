-- ═══════════════════════════════════════════════════════
--  FOCVS — Esquema SQL para Supabase
--  Ejecutar en: Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════

-- ── 1. Tabla perfiles ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.perfiles (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  puntos_totales  INT  NOT NULL DEFAULT 0,
  creado_en       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ── 2. Tabla sesiones (historial de trabajo) ─────────
CREATE TABLE IF NOT EXISTS public.sesiones (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  duracion_minutos  INT  NOT NULL,
  tipo              TEXT NOT NULL DEFAULT 'trabajo',  -- 'trabajo' | 'descanso'
  completada        BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en         TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. Tabla canjes (historial de recompensas) ────────
CREATE TABLE IF NOT EXISTS public.canjes (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  premio_nombre TEXT NOT NULL,
  puntos_usados INT  NOT NULL,
  creado_en     TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
--  Row Level Security (RLS) — Cada usuario solo ve sus datos
-- ═══════════════════════════════════════════════════════

-- Habilitar RLS en todas las tablas
ALTER TABLE public.perfiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesiones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canjes    ENABLE ROW LEVEL SECURITY;

-- Políticas para 'perfiles'
CREATE POLICY "Usuario puede ver su perfil"
  ON public.perfiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Usuario puede crear su perfil"
  ON public.perfiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuario puede actualizar su perfil"
  ON public.perfiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Políticas para 'sesiones'
CREATE POLICY "Usuario ve sus sesiones"
  ON public.sesiones FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Usuario registra sus sesiones"
  ON public.sesiones FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Políticas para 'canjes'
CREATE POLICY "Usuario ve sus canjes"
  ON public.canjes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Usuario registra sus canjes"
  ON public.canjes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════
--  Función RPC opcional: canjear_puntos (segura del lado servidor)
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.canjear_puntos(
  p_user_id     UUID,
  p_costo       INT,
  p_premio      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_puntos_actuales INT;
  v_nuevos_puntos   INT;
BEGIN
  -- Obtener puntos actuales con lock para evitar race conditions
  SELECT puntos_totales INTO v_puntos_actuales
  FROM public.perfiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Validar saldo suficiente
  IF v_puntos_actuales < p_costo THEN
    RETURN json_build_object('exito', false, 'mensaje', 'Puntos insuficientes');
  END IF;

  v_nuevos_puntos := v_puntos_actuales - p_costo;

  -- Descontar puntos
  UPDATE public.perfiles
  SET puntos_totales = v_nuevos_puntos
  WHERE user_id = p_user_id;

  -- Registrar el canje
  INSERT INTO public.canjes (user_id, premio_nombre, puntos_usados)
  VALUES (p_user_id, p_premio, p_costo);

  RETURN json_build_object('exito', true, 'puntos_restantes', v_nuevos_puntos);
END;
$$;
