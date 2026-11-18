-- ═══════════════════════════════════════════════════════
--  FOCUS — Cron de Todoist (etapa 2)
--  Cada 10 minutos llama a la Edge Function `todoist` con
--  { "action": "sync" } para sumar puntos por lo completado fuera
--  de la app. Ejecutar en Supabase > SQL Editor DESPUÉS de schema.sql.
--
--  Antes de correrlo, reemplace en este archivo:
--    · SU_PROJECT_REF   → el ref del proyecto (lo que va antes de .supabase.co)
--    · SU_ANON_KEY      → la llave "anon public" (la misma de VITE_SUPABASE_ANON_KEY).
--                        No es secreta: ya va dentro de la app publicada. Hace falta
--                        porque la función tiene "Verify JWT" encendido.
--  Es repetible: si lo corre otra vez, reemplaza el cron y la llave.
-- ═══════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Clave que comparten el cron y la función. Se genera sola y vive en Vault;
-- la función la lee con public.todoist_cron_secreto() (solo service_role).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'todoist_cron_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'todoist_cron_secret',
      'Clave del cron de Todoist (FOCUS)');
  END IF;
END $$;

-- Llave anon (pública) para pasar el control de JWT de la función.
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'todoist_anon_key';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret('SU_ANON_KEY', 'todoist_anon_key', 'Llave anon para el cron de Todoist (FOCUS)');
  ELSE
    PERFORM vault.update_secret(v_id, 'SU_ANON_KEY');
  END IF;
END $$;

-- (Re)programa el cron.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'todoist-sync';

SELECT cron.schedule(
  'todoist-sync',
  '*/10 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://SU_PROJECT_REF.supabase.co/functions/v1/todoist',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'todoist_anon_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'todoist_cron_secret')
    ),
    body    := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);

-- Para revisar que corre:
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
--   SELECT status_code, content FROM net._http_response ORDER BY created DESC LIMIT 5;
--   SELECT * FROM public.sync_todoist;
