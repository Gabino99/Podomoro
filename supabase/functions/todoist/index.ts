// ═══════════════════════════════════════════════════════
//  Edge Function `todoist` — puente entre FOCUS y Todoist.
//
//  · El token de Todoist vive como secreto (TODOIST_TOKEN) y nunca
//    llega al navegador.
//  · Solo responde a usuarios con sesión de Supabase. Si se define
//    ALLOWED_EMAIL, solo a ese correo (el token es personal).
//  · Los puntos de misión los calcula y suma el servidor con
//    `registrar_mision`; el navegador no manda puntos.
//
//  Acciones (POST con JSON { action, ... }):
//    list      → misiones de hoy y vencidas + proyectos
//    complete  → { id, esperado } completa en Todoist y suma puntos
//    postpone  → { id, fecha }    mueve la fecha (respeta hábitos repetitivos)
//    delete    → { id }           borra la tarea en Todoist
//    detalle   → { id } contexto, veces pospuesta (zombi) y subtareas
//    contexto  → { id, texto } guarda "🧠 Contexto: …" como comentario
//    partir    → { id, pasos[] } crea subtareas para hoy
//    soltar    → { id } p4 + 🗑️_Superflua + 30 días
//    sync      → suma puntos por lo completado fuera de la app (app de
//                Todoist, coach…). También la llama el cron cada 10 min
//                con el encabezado x-cron-secret (ver supabase/cron_todoist.sql).
// ═══════════════════════════════════════════════════════
import { createClient } from "npm:@supabase/supabase-js@2";

const TD = "https://api.todoist.com/api/v1";
const TOKEN = Deno.env.get("TODOIST_TOKEN") ?? "";
const ALLOWED_EMAIL = (Deno.env.get("ALLOWED_EMAIL") ?? "").trim().toLowerCase();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Fecha de Costa Rica (YYYY-MM-DD), igual que src/lib/fechas.js
const fmtCR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Costa_Rica" });
const hoyCR = () => fmtCR.format(new Date());

class TodoistError extends Error {
  constructor(public status: number, detalle: string) {
    super(`Todoist ${status}: ${detalle}`);
  }
}

async function td(path: string, init: RequestInit = {}) {
  const r = await fetch(TD + path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  const txt = await r.text();
  if (!r.ok) throw new TodoistError(r.status, txt.slice(0, 300));
  return txt ? JSON.parse(txt) : null;
}

async function paginar(path: string, params: Record<string, string> = {}) {
  let out: any[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ ...params, limit: "200" });
    if (cursor) q.set("cursor", cursor);
    const d = await td(`${path}?${q}`);
    out = out.concat(d?.results ?? []);
    cursor = d?.next_cursor ?? null;
    if (!cursor) break;
  }
  return out;
}

// La API usa 4 = la más urgente (p1). Aquí 1 = p1 … 4 = p4, como en la app de Todoist.
const prioridadUI = (t: any) => 5 - (Number(t.priority) || 1);

function duracionMin(t: any): number | null {
  const d = t.duration;
  if (!d || !d.amount) return null;
  return d.unit === "day" ? d.amount * 1440 : d.amount;
}

function normalizar(t: any) {
  return {
    id: String(t.id),
    contenido: t.content ?? "",
    descripcion: t.description ?? "",
    prioridad: prioridadUI(t),
    due: t.due
      ? { date: t.due.date, string: t.due.string ?? "", recurrente: !!t.due.is_recurring }
      : null,
    duracion: duracionMin(t),
    etiquetas: t.labels ?? [],
    proyecto_id: t.project_id ? String(t.project_id) : null,
    padre_id: t.parent_id ? String(t.parent_id) : null,
  };
}

// Misma fórmula que muestra la pantalla de Misiones.
// p: 1 = p1 … 4 = p4. dur: minutos o null. vencida: de un día anterior.
// zombi: pospuesta 3+ veces; si por fin se termina, vale x1.5 (se acumula con jefe).
function calcularPuntos(p: number, dur: number | null, vencida: boolean, zombi = false) {
  const base = ({ 1: 40, 2: 25, 3: 15, 4: 10 } as Record<number, number>)[p] ?? 10;
  const bono = dur ? Math.min(30, Math.round(dur / 5)) : 5;
  const mult = (vencida ? 1.5 : 1) * (zombi ? 1.5 : 1);
  return Math.max(1, Math.min(150, Math.round((base + bono) * mult)));
}

function puntosDe(t: any, zombi = false) {
  const vencida = !!(t.due?.date && String(t.due.date).slice(0, 10) < hoyCR());
  return { puntos: calcularPuntos(prioridadUI(t), duracionMin(t), vencida, zombi), vencida };
}

// ── Contexto y tareas zombi (etapa 3) ─────────────────────
const PREFIJO_CONTEXTO = "🧠 Contexto:";
const PREFIJO_REPROGRAMADA = "🔁 Reprogramada";
const LIMITE_ZOMBI = 3;
const ETIQUETA_SUPERFLUA = "🗑️_Superflua";

// Lee los comentarios de una tarea y saca el contexto y cuántas veces se pospuso.
async function leerComentarios(id: string) {
  const comentarios = await paginar("/comments", { task_id: id });
  const ctx = comentarios
    .filter((c: any) => String(c.content ?? "").startsWith(PREFIJO_CONTEXTO))
    .sort((a: any, b: any) => String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? "")))[0];
  const reprogramadas = comentarios.filter((c: any) => String(c.content ?? "").startsWith(PREFIJO_REPROGRAMADA)).length;
  return {
    contexto: ctx ? String(ctx.content).slice(PREFIJO_CONTEXTO.length).trim() : "",
    contexto_id: ctx ? String(ctx.id) : null,
    reprogramadas,
    zombi: reprogramadas >= LIMITE_ZOMBI,
  };
}

const subtareasActivas = async (id: string) => (await paginar("/tasks", { parent_id: id })).filter((t: any) => !t.checked);

const sumarDias = (yyyyMmDd: string, n: number) => {
  const d = new Date(`${yyyyMmDd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Mueve la fecha conservando la repetición (igual que "reschedule" de Todoist).
// extra: otros campos para el mismo item_update (prioridad, etiquetas…).
async function moverFecha(t: any, fecha: string, extra: Record<string, unknown> = {}) {
  const id = String(t.id);
  if (t.due) {
    let date = fecha.length === 16 ? fecha + ":00" : fecha;
    if (date.length === 10 && String(t.due.date).length > 10) date += String(t.due.date).slice(10);
    const uuid = crypto.randomUUID();
    const commands = [{
      type: "item_update",
      uuid,
      args: {
        id,
        ...extra,
        // Hábitos: se manda el texto ("every day") para no perder la repetición.
        // Tareas normales: solo la fecha; si se manda el texto viejo ("18 Nov"),
        // Todoist le hace caso al texto y la fecha no se mueve.
        due: t.due.is_recurring
          ? {
            date,
            string: t.due.string,
            is_recurring: true,
            ...(t.due.timezone ? { timezone: t.due.timezone } : {}),
            ...(t.due.lang ? { lang: t.due.lang } : {}),
          }
          : { date, ...(t.due.timezone ? { timezone: t.due.timezone } : {}) },
      },
    }];
    const r = await td("/sync", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ commands: JSON.stringify(commands) }),
    });
    const estado = r?.sync_status?.[uuid];
    if (estado !== "ok") throw new TodoistError(400, JSON.stringify(estado));
  } else {
    // Tarea sin fecha: se le pone con due_string, que sí acepta fecha y hora.
    const due_string = fecha.length > 10 ? `${fecha.slice(0, 10)} ${fecha.slice(11, 16)}` : fecha;
    await td(`/tasks/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ due_string, ...extra }),
    });
  }
}

const comentar = (id: string, content: string) =>
  td("/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: id, content }),
  });

// ── Sincronización: completadas fuera de la app ──────────

// Ref del proyecto de Supabase ("mzlk…" en https://mzlk….supabase.co). Las tareas que
// completa el botón Hecho quedan en Todoist con client "…ref=<este ref>": esas ya
// tienen sus puntos y se saltan.
const PROJECT_REF = (SUPABASE_URL.match(/^https?:\/\/([^.]+)\./) ?? [])[1] ?? "";

// extra_data a veces viene en snake_case y a veces en camelCase.
const ex = (x: any, snake: string, camel: string) => x?.[snake] ?? x?.[camel];

// Inicio del día de hoy en Costa Rica (UTC-6, sin horario de verano).
const inicioHoyCR = () => new Date(`${hoyCR()}T06:00:00Z`);
const isoSinMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

// Convierte un evento "item:completed" del registro de actividad en una misión,
// o null si no corresponde (de otra persona, o ya la registró el botón Hecho).
function misionDeEvento(ev: any, miId: string) {
  if (ev?.object_type !== "item" || ev?.event_type !== "completed") return null;
  if (ev.initiator_id && miId && String(ev.initiator_id) !== miId) return null;
  const x = ev.extra_data ?? {};
  if (PROJECT_REF && String(x.client ?? "").includes(`ref=${PROJECT_REF}`)) return null;

  // Misma llave que usa el botón Hecho: la fecha de vencimiento que se completó
  // ("2026-11-18" o "2026-11-18T19:00:00"), o "sin-fecha".
  const dueLocal = String(ex(x, "completed_due_date_local", "completedDueDateLocal") ?? "");
  const conHora = ex(x, "has_time", "hasTime") === true;
  const ocurrencia = dueLocal ? (conHora ? dueLocal.slice(0, 19) : dueLocal.slice(0, 10)) : "sin-fecha";

  const prioridad = 5 - (Number(x.priority) || 1);
  const cant = Number(x.duration) || 0;
  const unidad = ex(x, "duration_unit", "durationUnit");
  const dur = cant ? (unidad === "day" ? cant * 1440 : cant) : null;
  const diaEvento = fmtCR.format(new Date(ev.event_date));
  const vencida = ocurrencia !== "sin-fecha" && ocurrencia.slice(0, 10) < diaEvento;

  return {
    task_id: String(ev.object_id),
    ocurrencia,
    contenido: String(x.content ?? "Tarea"),
    proyecto_id: ev.parent_project_id ? String(ev.parent_project_id) : null,
    prioridad,
    vencida,
    puntos: calcularPuntos(prioridad, dur, vencida),
  };
}

async function sincronizar(userId: string) {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const ahora = new Date();

  const { data: estado } = await db.from("sync_todoist").select("desde").eq("user_id", userId).maybeSingle();
  let desde = estado?.desde ? new Date(estado.desde) : inicioHoyCR();
  if (!estado) await db.from("sync_todoist").insert({ user_id: userId, desde: desde.toISOString() });
  const tope = new Date(ahora.getTime() - 3 * 86400000); // nunca más de 3 días atrás
  if (desde < tope) desde = tope;

  try {
    const [yo, eventos, proyectos] = await Promise.all([
      td("/user"),
      paginar("/activities", {
        object_event_types: '["item:completed"]',
        date_from: isoSinMs(desde),
        date_to: isoSinMs(ahora),
      }),
      paginar("/projects"),
    ]);
    const nombres = Object.fromEntries(proyectos.map((p: any) => [String(p.id), p.name]));
    let nuevas = 0, ganados = 0;
    let total: number | null = null;

    for (const ev of eventos) {
      const m = misionDeEvento(ev, String(yo?.id ?? ""));
      if (!m) continue;
      const { data, error } = await db.rpc("registrar_mision", {
        p_user_id: userId,
        p_task_id: m.task_id,
        p_ocurrencia: m.ocurrencia,
        p_contenido: m.contenido,
        p_proyecto: m.proyecto_id ? nombres[m.proyecto_id] ?? null : null,
        p_prioridad: m.prioridad,
        p_vencida: m.vencida,
        p_puntos: m.puntos,
        p_origen: "todoist",
      });
      if (error) throw new Error(`registrar_mision: ${error.message}`);
      total = data?.puntos_totales ?? total;
      if (data?.nueva) { nuevas++; ganados += data.puntos_ganados ?? 0; }
    }

    await db.from("sync_todoist").update({ ultima: ahora.toISOString(), ultimo_error: null }).eq("user_id", userId);
    return { ok: true, revisadas: eventos.length, nuevas, puntos_ganados: ganados, puntos_totales: total };
  } catch (e) {
    await db.from("sync_todoist").update({ ultimo_error: String((e as Error).message).slice(0, 300) }).eq("user_id", userId);
    throw e;
  }
}

// El cron no tiene sesión de usuario: se identifica con la clave guardada en Vault.
async function esCron(req: Request) {
  const clave = req.headers.get("x-cron-secret");
  if (!clave) return false;
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await db.rpc("todoist_cron_secreto");
  return !error && typeof data === "string" && data.length >= 32 && data === clave;
}

async function usuarioPorCorreo(correo: string) {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(error.message);
    const u = data.users.find((u: any) => (u.email ?? "").toLowerCase() === correo);
    if (u) return u;
    if (data.users.length < 100) break;
  }
  return null;
}

async function usuarioActual(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  if (!TOKEN) return json({ ok: false, error: "Falta el secreto TODOIST_TOKEN en Supabase." }, 500);

  // Llamada del cron: solo puede sincronizar, y solo para ALLOWED_EMAIL.
  if (req.headers.get("x-cron-secret")) {
    if (!(await esCron(req))) return json({ ok: false, error: "Clave del cron inválida." }, 401);
    if (!ALLOWED_EMAIL) return json({ ok: false, error: "El cron necesita el secreto ALLOWED_EMAIL." }, 500);
    try {
      const dueno = await usuarioPorCorreo(ALLOWED_EMAIL);
      if (!dueno) return json({ ok: false, error: "No existe un usuario con ALLOWED_EMAIL." }, 404);
      return json(await sincronizar(dueno.id));
    } catch (e) {
      return json({ ok: false, error: `Sincronización: ${(e as Error).message}` }, 502);
    }
  }

  const user = await usuarioActual(req);
  if (!user) return json({ ok: false, error: "Inicie sesión de nuevo." }, 401);
  if (ALLOWED_EMAIL && (user.email ?? "").toLowerCase() !== ALLOWED_EMAIL) {
    return json({ ok: false, error: "Esta cuenta no tiene acceso a Todoist." }, 403);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* cuerpo vacío */ }
  const action = body.action;
  const id = body.id ? String(body.id) : "";

  try {
    if (action === "list") {
      const [tareas, proyectos] = await Promise.all([
        paginar("/tasks/filter", { query: "today | overdue" }),
        paginar("/projects"),
      ]);
      return json({
        ok: true,
        hoy: hoyCR(),
        tareas: tareas.filter((t) => !t.checked).map(normalizar),
        proyectos: proyectos.map((p) => ({ id: String(p.id), nombre: p.name, inbox: !!p.inbox_project })),
      });
    }

    if (action === "sync") return json(await sincronizar(user.id));

    if (!id) return json({ ok: false, error: "Falta el id de la tarea." }, 400);

    if (action === "complete") {
      const t = await td(`/tasks/${id}`);
      if (t.checked) return json({ ok: false, motivo: "ya_completada" });
      // Protege contra doble clic: si la fecha ya cambió (hábito que avanzó), no se vuelve a completar.
      if (body.esperado && t.due?.date && body.esperado !== t.due.date) {
        return json({ ok: false, motivo: "ya_completada" });
      }
      // Zombi (pospuesta 3+ veces): terminarla vale x1.5.
      let zombi = false;
      // (No confiar en t.note_count: la API v1 lo devuelve en 0 aunque haya comentarios.)
      if (!t.due?.is_recurring) {
        try { zombi = (await leerComentarios(id)).zombi; } catch { /* sin bono */ }
      }
      const { puntos, vencida } = puntosDe(t, zombi);
      const ocurrencia = t.due?.date ?? "sin-fecha";
      let proyecto: string | null = null;
      try { proyecto = (await td(`/projects/${t.project_id}`))?.name ?? null; } catch { /* opcional */ }

      await td(`/tasks/${id}/close`, { method: "POST" });

      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data, error } = await admin.rpc("registrar_mision", {
        p_user_id: user.id,
        p_task_id: id,
        p_ocurrencia: ocurrencia,
        p_contenido: t.content,
        p_proyecto: proyecto,
        p_prioridad: prioridadUI(t),
        p_vencida: vencida,
        p_puntos: puntos,
      });
      if (error) {
        // La tarea sí se completó en Todoist; solo falló sumar los puntos.
        return json({ ok: true, completada: true, puntos_ganados: 0, error_puntos: error.message });
      }
      return json({ ok: true, completada: true, zombi, ...data });
    }

    if (action === "postpone") {
      const fecha = String(body.fecha ?? "");
      if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(fecha)) {
        return json({ ok: false, error: "Fecha inválida." }, 400);
      }
      const t = await td(`/tasks/${id}`);
      // Tarea zombi: no se pospone más hasta partirla en pasos (o soltarla).
      if (!t.due?.is_recurring) {
        const info = await leerComentarios(id);
        if (info.zombi && (await subtareasActivas(id)).length === 0) {
          return json({ ok: false, motivo: "zombi", reprogramadas: info.reprogramadas,
            error: `Esta tarea ya se pospuso ${info.reprogramadas} veces. Pártala en pasos o suéltela.` });
        }
      }
      await moverFecha(t, fecha);
      // Deja rastro para el coach y para detectar tareas "zombi" (pospuestas muchas veces).
      if (!t.due?.is_recurring) {
        try { await comentar(id, `${PREFIJO_REPROGRAMADA} desde FOCUS ${hoyCR()}`); } catch { /* opcional */ }
      }
      return json({ ok: true });
    }

    // Contexto, veces pospuesta y pasos de una tarea (para la misión actual).
    if (action === "detalle") {
      const t = await td(`/tasks/${id}`);
      const [info, subs] = await Promise.all([leerComentarios(id), subtareasActivas(id)]);
      return json({ ok: true, ...info, zombi: info.zombi && !t.due?.is_recurring, subtareas: subs.length });
    }

    // Guarda el contexto como comentario "🧠 Contexto: …" (actualiza el anterior si existe).
    if (action === "contexto") {
      const texto = String(body.texto ?? "").trim().slice(0, 2000);
      if (!texto) return json({ ok: false, error: "Escriba algo de contexto." }, 400);
      const content = `${PREFIJO_CONTEXTO} ${texto}`;
      const { contexto_id } = await leerComentarios(id);
      if (contexto_id) {
        await td(`/comments/${contexto_id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
      } else {
        await comentar(id, content);
      }
      return json({ ok: true, contexto: texto });
    }

    // Parte la tarea en pasos: cada línea es una subtarea para hoy, con la misma prioridad.
    if (action === "partir") {
      const pasos = (Array.isArray(body.pasos) ? body.pasos : [])
        .map((p: unknown) => String(p ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 10);
      if (pasos.length < 2) return json({ ok: false, error: "Escriba al menos 2 pasos, uno por línea." }, 400);
      const t = await td(`/tasks/${id}`);
      const creadas = [];
      for (const content of pasos) {
        const n = await td("/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, parent_id: id, priority: t.priority ?? 1, due_string: "today" }),
        });
        creadas.push(normalizar(n));
      }
      try { await comentar(id, `🧩 Partida en ${pasos.length} pasos desde FOCUS ${hoyCR()}`); } catch { /* opcional */ }
      return json({ ok: true, creadas });
    }

    // Soltar: baja a p4, etiqueta 🗑️_Superflua y la manda a +30 días.
    if (action === "soltar") {
      const t = await td(`/tasks/${id}`);
      const etiquetas = Array.from(new Set([...(t.labels ?? []), ETIQUETA_SUPERFLUA]));
      await moverFecha(t, sumarDias(hoyCR(), 30), { priority: 1, labels: etiquetas });
      try { await comentar(id, `🗑️ Soltada desde FOCUS ${hoyCR()}`); } catch { /* opcional */ }
      return json({ ok: true });
    }

    if (action === "delete") {
      await td(`/tasks/${id}`, { method: "DELETE" });
      return json({ ok: true });
    }

    return json({ ok: false, error: "Acción desconocida." }, 400);
  } catch (e) {
    const status = e instanceof TodoistError ? e.status : 500;
    const msg = status === 401 || status === 403
      ? "Todoist rechazó el token. Revise el secreto TODOIST_TOKEN."
      : status === 404
        ? "Esa tarea ya no existe en Todoist."
        : `Error hablando con Todoist: ${(e as Error).message}`;
    return json({ ok: false, error: msg }, status >= 400 && status < 600 ? status : 500);
  }
});
