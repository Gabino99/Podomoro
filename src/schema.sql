-- ═══════════════════════════════════════════════════════
--  FOCVS — Esquema SQL para Supabase (v2)
--  Ejecutar en: Supabase > SQL Editor > New Query
--  Las sentencias usan IF NOT EXISTS / IF NOT EXISTS
--  para que sea seguro correrlo en una DB ya existente.
-- ═══════════════════════════════════════════════════════

-- ── 1. Tabla perfiles ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.perfiles (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  puntos_totales        INT  NOT NULL DEFAULT 0,
  meta_diaria_minutos   INT  NOT NULL DEFAULT 120,
  creado_en             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Migración segura: agregar columna si no existe
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS meta_diaria_minutos INT NOT NULL DEFAULT 120;

-- ── 2. Tabla sesiones ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sesiones (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  duracion_minutos  INT  NOT NULL,
  tipo              TEXT NOT NULL DEFAULT 'trabajo',
  completada        BOOLEAN NOT NULL DEFAULT FALSE,
  categoria         TEXT NOT NULL DEFAULT 'general',
  nota              TEXT,
  creado_en         TIMESTAMPTZ DEFAULT NOW()
);

-- Migración segura
ALTER TABLE public.sesiones
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'general';
ALTER TABLE public.sesiones
  ADD COLUMN IF NOT EXISTS nota TEXT;

-- ── 3. Tabla canjes ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.canjes (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  premio_nombre TEXT NOT NULL,
  puntos_usados INT  NOT NULL,
  creado_en     TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
--  Row Level Security
-- ═══════════════════════════════════════════════════════
ALTER TABLE public.perfiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesiones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canjes    ENABLE ROW LEVEL SECURITY;

-- Perfiles
CREATE POLICY IF NOT EXISTS "Usuario puede ver su perfil"
  ON public.perfiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Usuario puede crear su perfil"
  ON public.perfiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Usuario puede actualizar su perfil"
  ON public.perfiles FOR UPDATE USING (auth.uid() = user_id);

-- Sesiones
CREATE POLICY IF NOT EXISTS "Usuario ve sus sesiones"
  ON public.sesiones FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Usuario registra sus sesiones"
  ON public.sesiones FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Canjes
CREATE POLICY IF NOT EXISTS "Usuario ve sus canjes"
  ON public.canjes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Usuario registra sus canjes"
  ON public.canjes FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════
--  Función RPC: canjear_puntos (atómica, evita race conditions)
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
  SELECT puntos_totales INTO v_puntos_actuales
  FROM public.perfiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_puntos_actuales < p_costo THEN
    RETURN json_build_object('exito', false, 'mensaje', 'Puntos insuficientes');
  END IF;

  v_nuevos_puntos := v_puntos_actuales - p_costo;

  UPDATE public.perfiles
    SET puntos_totales = v_nuevos_puntos
  WHERE user_id = p_user_id;

  INSERT INTO public.canjes (user_id, premio_nombre, puntos_usados)
  VALUES (p_user_id, p_premio, p_costo);

  RETURN json_build_object('exito', true, 'puntos_restantes', v_nuevos_puntos);
END;
$$;

-- ═══════════════════════════════════════════════════════
--  Función RPC: actualizar_meta_diaria
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.actualizar_meta_diaria(
  p_user_id UUID,
  p_meta    INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.perfiles
    SET meta_diaria_minutos = p_meta
  WHERE user_id = p_user_id;
END;
$$;
