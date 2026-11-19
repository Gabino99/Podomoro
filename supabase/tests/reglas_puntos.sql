-- Pruebas de las reglas de puntos (v7).
-- Cómo correrlas: primero src/schema.sql completo, luego este archivo, en el
-- SQL Editor de Supabase. Todo va dentro de una transacción que se revierte
-- (ROLLBACK) al final: no deja datos. Si algún ASSERT falla, el editor muestra
-- su mensaje y se detiene.
-- Usa el primer perfil existente y simula su sesión con set_config.

BEGIN;

CREATE TEMP TABLE _t (u UUID);
INSERT INTO _t SELECT user_id FROM public.perfiles LIMIT 1;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT u FROM _t), 'role', 'authenticated')::text, true);

-- Estado limpio para las pruebas (se revierte al final).
UPDATE public.perfiles SET reglas = '{}'::jsonb, combo_n = 0, combo_en = NULL, dobles = 0
 WHERE user_id = (SELECT u FROM _t);

-- Fija la semilla de random() en una donde las próximas 12 misiones NO abren cofre
-- (registrar_mision llama random() una vez por misión nueva y cofre < 0.32).
CREATE FUNCTION pg_temp.sin_cofre() RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE s INT := 0; ok BOOLEAN;
BEGIN
  LOOP
    s := s + 1;
    PERFORM setseed(s / 1000.0);
    ok := TRUE;
    FOR i IN 1..12 LOOP IF random() < 0.32 THEN ok := FALSE; END IF; END LOOP;
    IF ok THEN PERFORM setseed(s / 1000.0); RETURN; END IF;
    IF s > 900 THEN RAISE EXCEPTION 'sin semilla sin cofre'; END IF;
  END LOOP;
END $$;

-- Registra una misión de prueba. Siempre manda p_puntos = 150 (el servidor debe ignorarlo).
CREATE FUNCTION pg_temp.mision(p_momento TIMESTAMPTZ, p_vencida BOOLEAN DEFAULT FALSE, p_zombi BOOLEAN DEFAULT FALSE)
RETURNS JSON LANGUAGE sql AS $$
  SELECT public.registrar_mision(
    p_user_id => (SELECT u FROM _t), p_task_id => 'test-' || gen_random_uuid()::text,
    p_ocurrencia => 'sin-fecha', p_contenido => 'prueba', p_proyecto => NULL, p_prioridad => 1,
    p_vencida => p_vencida, p_puntos => 150, p_origen => 'app', p_momento => p_momento,
    p_zombi => p_zombi, p_etiquetas => NULL, p_proyecto_id => NULL)
$$;

-- ══ Tarea 1: almacenamiento y validación ══
DO $$
DECLARE u UUID := (SELECT u FROM _t); j JSON;
BEGIN
  ASSERT public._regla(u, 'mision_base') = 5, '1a: mision_base por defecto = 5';
  ASSERT public._regla(u, 'tope_bonos') = 50, '1a: tope_bonos por defecto = 50';

  PERFORM public.guardar_reglas('{"mision_base": 8}'::jsonb);
  ASSERT public._regla(u, 'mision_base') = 8, '1b: mision_base guardada = 8';
  ASSERT public._regla(u, 'mision_vencida') = 10, '1b: lo no guardado sigue en su defecto';

  BEGIN
    PERFORM public.guardar_reglas('{"mision_base": 999}'::jsonb);
    RAISE EXCEPTION 'debió fallar 1c';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE 'Valor fuera de rango%', '1c: mensaje de rango: ' || SQLERRM;
  END;
  ASSERT public._regla(u, 'mision_base') = 8, '1c: un guardado rechazado no cambia nada';

  BEGIN
    PERFORM public.guardar_reglas('{"mision_base": "x"}'::jsonb);
    RAISE EXCEPTION 'debió fallar 1d';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE 'Valor fuera de rango%', '1d: texto en vez de número: ' || SQLERRM;
  END;

  PERFORM public.guardar_reglas('{"inventada": 1}'::jsonb);
  ASSERT NOT (public._reglas(u) ? 'inventada'), '1e: clave desconocida se ignora';

  PERFORM public.guardar_reglas('{}'::jsonb);
  ASSERT public._regla(u, 'mision_base') = 5, '1f: restablecer vuelve al defecto';

  j := public.reglas_juego();
  ASSERT (j->'rangos'->'combo_max')::text = '[1, 3]', '1g: rango de combo_max = ' || (j->'rangos'->'combo_max')::text;
END $$;

-- ══ Tarea 2: enfoque, misiones y tope diario ══
DO $$
-- d = las 8:00 (hora Costa Rica) de hace 400 días: las horas que se le suman no cruzan de día.
DECLARE u UUID := (SELECT u FROM _t); j JSON;
  d TIMESTAMPTZ := (date_trunc('day', (now() - interval '400 days') AT TIME ZONE 'America/Costa_Rica')
                    + interval '8 hours') AT TIME ZONE 'America/Costa_Rica';
BEGIN
  -- 2a: minutos de enfoque
  j := public.registrar_sesion(25, 'trabajo', 'general', NULL);
  ASSERT (j->>'puntos_ganados')::int = 25, '2a: 25 min = 25 pts, fue ' || (j->>'puntos_ganados');
  PERFORM public.guardar_reglas('{"min_enfoque": 2}'::jsonb);
  j := public.registrar_sesion(25, 'trabajo', 'general', NULL);
  ASSERT (j->>'puntos_ganados')::int = 50, '2a: con min_enfoque 2, 25 min = 50 pts';

  -- 2b: valor de la misión (días distintos para que el tope no estorbe)
  PERFORM public.guardar_reglas('{"tope_bonos": 0}'::jsonb);
  PERFORM pg_temp.sin_cofre();
  j := pg_temp.mision(d - interval '10 days');
  ASSERT (j->>'puntos_mision')::int = 5, '2b: normal = 5, fue ' || (j->>'puntos_mision');
  j := pg_temp.mision(d - interval '11 days', TRUE);
  ASSERT (j->>'puntos_mision')::int = 10, '2b: vencida = 10, fue ' || (j->>'puntos_mision');
  j := pg_temp.mision(d - interval '12 days', FALSE, TRUE);
  ASSERT (j->>'puntos_mision')::int = 10, '2b: zombi = 10, fue ' || (j->>'puntos_mision');
  j := pg_temp.mision(d - interval '13 days', TRUE, TRUE);
  ASSERT (j->>'puntos_mision')::int = 10, '2b: vencida y zombi = 10 (el mayor), fue ' || (j->>'puntos_mision');

  -- 2c/2d: tope diario (misiones separadas más de 45 min para que no haya combo)
  PERFORM public.guardar_reglas('{"tope_bonos": 12}'::jsonb);
  PERFORM pg_temp.sin_cofre();
  ASSERT (pg_temp.mision(d)->>'puntos_ganados')::int = 5, '2c: 1.a = 5';
  ASSERT (pg_temp.mision(d + interval '1 hour')->>'puntos_ganados')::int = 5, '2c: 2.a = 5';
  ASSERT (pg_temp.mision(d + interval '2 hours')->>'puntos_ganados')::int = 2, '2c: 3.a = 2 (el tope corta)';
  ASSERT (pg_temp.mision(d + interval '3 hours')->>'puntos_ganados')::int = 0, '2c: 4.a = 0';
  -- 2g: otro día, otro tope
  ASSERT (pg_temp.mision(d - interval '1 day')->>'puntos_ganados')::int = 5, '2g: el tope es por día de la misión';
  -- 2d: el enfoque no tiene tope
  PERFORM public.guardar_reglas('{"tope_bonos": 1}'::jsonb);
  j := public.registrar_sesion(25, 'trabajo', 'general', NULL);
  ASSERT (j->>'puntos_ganados')::int = 25, '2d: el enfoque ignora el tope';

  -- 2e: tope 0 = sin tope
  PERFORM public.guardar_reglas('{"tope_bonos": 0}'::jsonb);
  PERFORM pg_temp.sin_cofre();
  FOR i IN 1..4 LOOP
    j := pg_temp.mision(d - interval '30 days' + i * interval '1 hour');
    ASSERT (j->>'puntos_ganados')::int = 5, '2e: sin tope, misión ' || i || ' = 5';
  END LOOP;

  -- 2f: combo limitado por combo_max (1.5)
  PERFORM public.guardar_reglas('{"tope_bonos": 0}'::jsonb);
  UPDATE public.perfiles SET combo_n = 0, combo_en = NULL WHERE user_id = u;
  PERFORM pg_temp.sin_cofre();
  j := pg_temp.mision(d - interval '40 days');
  ASSERT (j->>'puntos_mision')::int = 5, '2f: 1.a del combo = 5';
  j := pg_temp.mision(d - interval '40 days' + interval '10 minutes');
  ASSERT (j->>'puntos_mision')::int = 8, '2f: 2.a = round(5 x 1.5) = 8, fue ' || (j->>'puntos_mision');
  j := pg_temp.mision(d - interval '40 days' + interval '20 minutes');
  ASSERT (j->>'puntos_mision')::int = 8, '2f: 3.a sigue en 8 (tope ×1.5), fue ' || (j->>'puntos_mision');
END $$;

-- ══ Tarea 3: retos, jefe, estado, insignias ══
DO $$
DECLARE u UUID := (SELECT u FROM _t); j JSON; v_ins TEXT[];
BEGIN
  PERFORM public.guardar_reglas('{}'::jsonb);
  ASSERT (SELECT array_agg(premio ORDER BY meta, id) FROM public._retos(u)) = ARRAY[5, 5, 5, 10],
    '3a: premios de retos por defecto 5,5,5,10';
  PERFORM public.guardar_reglas('{"reto_misiones_3": 9}'::jsonb);
  ASSERT (SELECT premio FROM public._retos(u) WHERE id = 'misiones_3') = 9, '3a: reto_misiones_3 = 9';
  PERFORM public.guardar_reglas('{}'::jsonb);

  j := public.estado_juego();
  ASSERT (j->'reglas'->>'jefe_proyecto')::int = 25, '3b: estado_juego trae las reglas';
  ASSERT (j->>'bonos_hoy') IS NOT NULL AND (j->>'bonos_hoy')::int >= 0, '3b: bonos_hoy numérico';

  -- 3c: jefe de proyecto
  PERFORM public.guardar_reglas('{"tope_bonos": 0}'::jsonb);
  PERFORM public.elegir_jefe(u, 'proy-test', 'Proyecto de prueba', 3);
  PERFORM public.registrar_mision(p_user_id => u, p_task_id => 'test-j', p_ocurrencia => 'sin-fecha',
    p_contenido => 'x', p_proyecto => 'P', p_prioridad => 4, p_vencida => FALSE,
    p_momento => now(), p_proyecto_id => 'proy-test');
  j := public.derrotar_jefe(u);
  ASSERT (j->>'premio')::int = 25, '3c: jefe de proyecto = 25, fue ' || coalesce(j->>'premio', 'null');

  -- 3d: combo_max de las reglas se refleja en estado_juego
  PERFORM public.guardar_reglas('{"combo_max": 3}'::jsonb);
  UPDATE public.perfiles SET combo_n = 6, combo_en = now() WHERE user_id = u;
  j := public.estado_juego();
  ASSERT (j->>'combo')::numeric = 3, '3d: combo hasta 3 si combo_max = 3, fue ' || (j->>'combo');
  PERFORM public.guardar_reglas('{}'::jsonb);
  j := public.estado_juego();
  ASSERT (j->>'combo')::numeric = 1.5, '3d: combo tope 1.5 por defecto, fue ' || (j->>'combo');

  -- 3e: suertudo sale de misiones.cofre, no de la bitácora
  UPDATE public.misiones SET cofre = 'legendario' WHERE user_id = u AND task_id = 'test-j';
  DELETE FROM public.insignias WHERE user_id = u AND insignia = 'suertudo';
  v_ins := public._revisar_insignias(u);
  ASSERT 'suertudo' = ANY(v_ins), '3e: suertudo con cofre legendario en misiones';
END $$;

ROLLBACK;
SELECT 'Todas las pruebas pasaron' AS resultado;
