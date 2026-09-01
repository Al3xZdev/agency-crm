# @agency-crm/web

Interfaz de la agencia en Next.js (App Router, `src/`). Trabaja contra la API
de `apps/api` a través de un proxy same-origin (sin CORS: las cookies quedan
first-party).

## Rutas

### Portal de la agencia (staff) — layout en `(staff)/layout.tsx`

| Ruta | Descripción |
| --- | --- |
| `/login` | Inicio de sesión con magic link. |
| `/` (`(staff)/dashboard`) | Resumen: estadísticas, campañas recientes, actividad. |
| `/clients` | Lista de clientes y creación. |
| `/clients/[id]` | Detalle de cliente (campañas, fichas de contacto). |
| `/campaigns` + `/campaigns/[id]` | Lista y detalle de campañas (creativos, métricas). |
| `/creatives/[id]` | Detalle de creativo (versiones, vista de medios). |
| `/versions/[id]` | Revisor de versión (pin comments, aprobar/rechazar). |
| `/upload/[creativeId]` | Subida de una nueva versión. |
| `/magic-links` | Generación y gestión de links de invitación. |
| `/settings` | Configuración (cuenta, usuarios de la agencia). |

### Portal del cliente — rutas `/c/*`

| Ruta | Descripción |
| --- | --- |
| `/c` | Dashboard del cliente: sesiones pendientes/aprobadas/rechazadas. |
| `/c/[token]` | Canje del link de invitación (crea/abre la sesión). |
| `/c/expired` | Enlace expirado o revocado (los 401 del portal rebotan acá). |
| `/c/invalid` | Enlace inválido. |
| `/c/versions/[id]` | Lightbox: revisión de una versión y comentarios. |

## Convenciones

- **Imports relativos.** El repo no usa el alias `@/`; todos los imports son
  relativos a `src` (ej. `../../lib/format`).
- **Capa de red única.** `src/lib/api.ts` centraliza `apiFetch`, el envío del
  token CSRF (`X-CSRF-Token`), el manejo de errores y el bounce de 401. Usa
  `redirectTargetFor401()`: los 401 del staff van a `/login`, los del portal
  `/c/*` van a `/c/expired` (excepto `/login` y `/c/expired` mismos, que
  manejan el 401 inline).
- **Formateo.** `src/lib/format.ts` centraliza `formatDate`, `formatRelativeTime`
  y `formatMs`. No dupliques estos helpers en los componentes.
- **Toasts.** `src/lib/toast.tsx` expone `<ToastProvider>` (montado en
  `app/providers.tsx`) y el hook `useToast()` → `{ showToast }`, con
  auto-dismiss de 3 s.
- **Datos server/client sobreescritos.** `components/staff/*` son los forms y
  modales; `components/client/*` son primitivas del portal del cliente.
- **UI en español** (rioplatense neutral en artefactos): etiquetas y copys de
  la interfaz están en español.
- **Estado de datos.** React Query para fetching/caching; `useMutation` para
  escrituras con invalidation de queries (`queryKey` correspondiente).

## Entorno y proxy

- `INTERNAL_API_URL` — base de la API. Default `http://localhost:3000`.
- `next.config.ts` expone dos rewrites (no editar sin motivo):
  - `/api/:path* → {INTERNAL_API_URL}/:path*`
  - `/media/:path* → {INTERNAL_API_URL}/media/:path*`

Esto permite que el front consuma media (`/media/...`, ej. posters de
versiones) y la API por la misma semilla, manteniendo cookies first-party.

## Comandos

Desde la raíz del repo (pnpm workspace):

- Levantar API + web en docker: `docker compose up -d --build api web`
- Typecheck del paquete: `pnpm --filter @agency-crm/web exec tsc --noEmit`
  (o desde la raíz `pnpm typecheck`)
- Dev: `pnpm --filter @agency-crm/web dev`

## Pendientes reales

- Copys en inglés en el dashboard del portal del cliente (`/c`) y en
  `/c/invalid` (el resto de la UI es español).
- Sin tests unitarios del web.
- Sin focus-trap en los modales (accesibilidad por mejorar).
- Jobs de escaneo/recordatorio de sesiones sin implementar en la API.
