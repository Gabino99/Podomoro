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
