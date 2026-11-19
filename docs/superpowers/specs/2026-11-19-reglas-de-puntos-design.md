# Reglas de puntos configurables — diseño (corto, aprobado)

## Intención
El minuto de enfoque es la moneda base (1 min = 1 punto, canjeable). Misiones, combo, cofres, retos y jefes inflaban demasiado: una tarea llegaba a ~470 puntos. Los bonos deben ser pequeños y el usuario debe poder configurarlos.

## Metas / no metas
- Metas: enfoque como fuente principal; bonos chicos y con tope diario; todo editable desde la app.
- No metas: cambiar saldo, XP o historial existentes; cambiar precios de recompensas; separar XP de puntos.
- Anti-meta: que el navegador pueda escribirse puntos.

## Enfoques considerados
1. Números fijos en el código: no es configurable. Descartado.
2. Una tabla con una fila por regla: excesivo para un solo usuario.
3. **Elegido:** columna `reglas` JSONB en `perfiles`, con valores por defecto; se guarda con una función del servidor que valida rangos.

## Diseño
- `perfiles.reglas JSONB`; función `_regla(user, clave)` devuelve el valor guardado o el defecto.
- `guardar_reglas(p_reglas JSONB)` (auth.uid(), valida rangos, ignora claves desconocidas) y `reglas_juego()` para leerlas.
- Valores iniciales: min enfoque 1; misión +5; jefe vencido +10 total; zombi +10 total; combo máx ×1.5 (solo sobre bono de misión); cofres +5 / +20; retos +5, +5, +5, +10; jefe de proyecto +25; tope diario de bonos 50 (minutos de enfoque sin tope).
- `registrar_mision` calcula el bono en el servidor (ignora el valor del cliente); se elimina la fórmula de prioridad/duración en `todoist.js` y la función edge.
- `_ganar` aplica el tope diario a todo origen distinto de `sesion`.
- Panel "Reglas de puntos" en la pestaña de recompensas, con botón de valores recomendados. Aplica solo a ganancias futuras.

## Decisiones del builder
Rangos exactos de validación y el diseño visual del panel.
