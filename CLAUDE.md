# NotificacionesBiblioTK — Notificaciones en tiempo real

Parte del sistema BiblioTK (ver `../CLAUDE.md`). Recibe los eventos que publican los demás backends y los reparte en vivo por Socket.IO, con un historial breve en Redis. Lo consumen las tres apps de rol (con la sesión del usuario) y la app del celular `BiblioTK-notificaciones` (perfiles de demostración, sin sesión).

- **Puerto:** 3006 (`PORT` en `.env`). Prefijo `/NotificacionesBiblioTK`; el socket va en `/NotificacionesBiblioTK/socket.io`.
- **Arranque:** `npm run dev` (`node --watch src/app.js`). Necesita la BD (para validar la cookie contra `sesiones`) y **Redis**: `docker compose -f ../InfraBiblioTK/docker-compose.yml up -d redis`. Mientras Redis no responde, el servicio espera reintentando.
- **Dependencias clave:** express 5, socket.io 4, @socket.io/redis-adapter, redis (node-redis), mysql2, cookie 2 (`parseCookie`), qrcode, cors, dotenv. Versiones fijas, sin `^`.
- **Variables (`.env`, ver `.env.example`):** `PORT=3006`, `DB_*` (las mismas de los demás backends), `REDIS_URL` (por defecto `redis://localhost:6379`), `ALLOWED_ORIGIN_*` (si no hay, 5172–5175), y opcionales `NOTIFICACIONES_CLAVE`, `MOVIL_URL`, `MOVIL_PUERTO` (5177) y `ZONA_HORARIA` (`America/Bogota`).

## Estructura

- `src/app.js` — express + servidor HTTP compartido con Socket.IO + router en `/NotificacionesBiblioTK` + middleware de errores. Con `SIGTERM` cierra los sockets con orden (Kubernetes).
- `src/config/db.js`, `src/config/redis.js` (un cliente para el historial y los dos del adaptador), `src/config/origenes.js`
- `src/eventos.js` — **el contrato**: catálogo de tipos de evento, audiencias y textos (`armarEntregas`)
- `src/socket.js` — autenticación de la conexión, salas, historial al conectarse, `publicar` y `cerrarSesion`
- `src/utils/sesiones.js` (misma búsqueda que `verificarSesion`), `historial.js` (Redis), `movil.js` (URL y QR del celular)
- `src/middlewares/soloInterno.js` — protege las rutas `/interno`
- `src/router/routerBiblioTK.js`

## Conexiones y salas

| Conexión | Cómo se valida | Salas |
|---|---|---|
| Apps del computador | Origen en `ALLOWED_ORIGIN_*` **y** cookie `token_acceso` con sesión viva en `sesiones` | `usuario:<id>`, `rol:<rol>` y `sesion:<hash>` (solo para cortarla al cerrar sesión) |
| App del celular | `auth: { demo: "superadmin" \| "admin" \| "usuario" }`, sin cookie | `demo:<perfil>` |

- El rol lo decide el servidor al validar la cookie: nunca llega al front.
- Solo **WebSocket** (sin long-polling, en el servidor y en los clientes): con varias réplicas no hace falta afinidad de sesión en el balanceador, y el adaptador de Redis reparte cada evento entre réplicas.
- Al conectarse, el socket recibe `historial` (las últimas 20 de sus salas, más reciente primero). Después, cada aviso llega como `notificacion`: `{ id, tipo, categoria, titulo, mensaje, fecha }`.

## Eventos (contrato con los demás backends)

Los backends llaman a `POST /interno/eventos` con `{ tipo, datos }` **después del commit**, sin esperar respuesta (`src/utils/notificar.js` en cada uno). Un mismo evento llega a cada sala con su propio texto y el mismo `id`; el canal demo nunca lleva nombres, correos ni cédulas.

| Tipo | Lo emite | superadmin | admin | dueño | Celular (demo) |
|---|---|---|---|---|---|
| `usuario.registrado` | Registro | ✔ | | | superadmin |
| `usuario.eliminado` | Perfil | ✔ | | | superadmin (además se cortan los sockets de la cuenta y se borra su historial) |
| `perfil.actualizado` | Perfil | ✔ | | ✔ | superadmin; usuario solo si el dueño es lector |
| `material.creado` / `actualizado` / `eliminado` | Materiales | | ✔ | | admin |
| `prestamo.creado` | Préstamos | | ✔ | ✔ | admin, usuario |
| `prestamo.cancelado` | Préstamos (lector o bibliotecario) | | ✔ | ✔ | admin, usuario |
| `prestamo.devuelto` | Préstamos | | ✔ | ✔ | admin, usuario |
| `prestamo.vencido` | Préstamos (al marcar vencidos) | | ✔ | ✔ | admin, usuario |

Si una cuenta está en dos salas del mismo evento (un superadmin que edita su propio perfil), en vivo solo recibe la versión del dueño (`except`) y el historial deduplica por `id`.

## Endpoints (`/NotificacionesBiblioTK`)

| Método | Ruta | Quién | Respuesta |
|---|---|---|---|
| GET | `/health` | pública | `{ message }` |
| POST | `/interno/eventos` | backends | `{ tipo, datos }` → 202 `{ id }`; tipo desconocido → 400 |
| POST | `/interno/sesiones/cierre` | InicioSesion | `{ tokenHash }` (SHA-256 de la cookie) → 204; corta los sockets de esa sesión |
| GET | `/movil` | landing | `{ url }` de la app del celular |
| GET | `/movil/qr.svg` | landing | QR de esa URL (SVG) |

**`/interno`:** con `NOTIFICACIONES_CLAVE` exige esa clave en `x-clave-interna` (Docker/Kubernetes); sin ella, solo acepta llamadas desde la misma máquina (desarrollo local). Además, el gateway no publica `/interno`.

**URL del celular:** `MOVIL_URL` si existe; si no, `http://<IP de la red local>:5177/` (prefiere el Wi-Fi y se salta adaptadores virtuales y la red 192.168.56.x de VirtualBox). Dentro de un contenedor no se ve la IP del computador: ahí hay que fijar `MOVIL_URL`.

## Problemas conocidos

- La sesión se valida al conectar: si vence (30 días) con el socket abierto, sigue conectado hasta que se recargue la página. Cerrar sesión y borrar la cuenta sí cortan el socket.
- El historial vive solo en Redis (7 días, 20 por sala): si Redis se reinicia sin persistencia, se pierde. Es una caché a propósito.
