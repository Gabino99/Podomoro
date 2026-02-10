# ⬡ FOCVS — Pomodoro con Recompensas

Temporizador Pomodoro gamificado. Concentráte, acumulá puntos, canjealos por premios reales.

---

## Stack

- **Frontend**: React + Vite + CSS personalizado
- **Backend / Auth / DB**: Supabase
- **Deploy**: Netlify

---

## Estructura del Proyecto

```
focvs-pomodoro/
├── src/
│   ├── components/
│   │   ├── Auth.jsx          # Login / Registro
│   │   ├── Timer.jsx         # Temporizador Pomodoro + lógica de puntos
│   │   └── Store.jsx         # Tienda de recompensas + canjearPuntos
│   ├── lib/
│   │   └── supabase.js       # Cliente Supabase inicializado
│   ├── App.jsx               # Raíz: auth state + navegación
│   ├── main.jsx
│   └── index.css             # Sistema de diseño completo
├── schema.sql                # ⬅ Ejecutar en Supabase SQL Editor
├── netlify.toml              # Config de build y redirects
├── .env.example              # Template de variables de entorno
├── vite.config.js
└── package.json
```

---

## 🚀 Configuración Paso a Paso

### 1. Clonar e instalar dependencias

```bash
git clone https://github.com/tu-usuario/focvs-pomodoro.git
cd focvs-pomodoro
npm install
```

### 2. Configurar Supabase

1. Ir a [supabase.com](https://supabase.com) y crear un nuevo proyecto.
2. En **SQL Editor**, pegar y ejecutar todo el contenido de `schema.sql`.
   - Esto crea las tablas `perfiles`, `sesiones`, `canjes`, las políticas RLS y la función `canjear_puntos`.
3. En **Project Settings > API**, copiar:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon / public key** → `VITE_SUPABASE_ANON_KEY`

### 3. Variables de entorno (desarrollo local)

```bash
cp .env.example .env.local
```

Editar `.env.local`:

```env
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
```

```bash
npm run dev
```

---

## ☁️ Deploy en Netlify — Variables de Entorno

1. Subir el proyecto a GitHub.
2. En [netlify.com](https://netlify.com), conectar el repositorio.
3. Configurar el build:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
4. Ir a **Site configuration > Environment variables** y agregar:

| Variable               | Valor                              |
|------------------------|------------------------------------|
| `VITE_SUPABASE_URL`    | `https://tu-proyecto.supabase.co`  |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1Ni...`         |

5. Hacer un nuevo deploy (o trigger deploy). El `netlify.toml` ya incluye el redirect necesario para que el routing de React funcione correctamente.

---

## 🗃️ Esquema de Base de Datos

### Tabla `perfiles`
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID | PK generado automáticamente |
| `user_id` | UUID | FK → `auth.users` |
| `puntos_totales` | INT | Saldo de puntos actual |
| `creado_en` | TIMESTAMPTZ | Fecha de creación |

### Tabla `sesiones`
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `auth.users` |
| `duracion_minutos` | INT | Duración de la sesión |
| `tipo` | TEXT | `'trabajo'` o `'descanso'` |
| `completada` | BOOLEAN | `true` si terminó normalmente |

### Tabla `canjes`
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `auth.users` |
| `premio_nombre` | TEXT | Nombre del premio canjeado |
| `puntos_usados` | INT | Costo descontado |

---

## 🎮 Sistema de Puntos

- **Ganar**: 1 minuto de sesión completada = 1 punto (sesión de 25 min = 25 puntos).
- **Cancelar**: los puntos **NO** se acreditan si se cancela la sesión.
- **Canjear**: los puntos se descuentan atómicamente usando la función RPC `canjear_puntos` en PostgreSQL, evitando race conditions.

### Catálogo de premios

| Premio | Costo |
|--------|-------|
| ⚔️ Clash Royale (30 min) | 240 pts |
| 🌿 Salir a Ococa | 500 pts |
| 🍺 Una cerveza | 180 pts |
| 🎮 Jugar videojuegos | 500 pts |
| 📱 Redes sociales (30 min) | 240 pts |
| 💝 Premio Especial (Cariño) | 500 pts |

---

## Desarrollo

```bash
npm run dev      # Servidor de desarrollo en http://localhost:5173
npm run build    # Build de producción en /dist
npm run preview  # Preview del build de producción
```
