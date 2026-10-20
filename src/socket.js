import { createAdapter } from "@socket.io/redis-adapter";
import { parseCookie } from "cookie";
import { Server } from "socket.io";
import { origenesPermitidos } from "./config/origenes.js";
import { redisPub, redisSub } from "./config/redis.js";
import { armarEntregas } from "./eventos.js";
import { borrarHistorial, guardarEnHistorial, leerHistorial } from "./utils/historial.js";
import { buscarSesion } from "./utils/sesiones.js";

export const RUTA_SOCKET = "/NotificacionesBiblioTK/socket.io";
export const PERFILES_DEMO = ["superadmin", "admin", "usuario"];

// Hay dos tipos de conexión:
// - Real (apps del computador): la cookie token_acceso, validada contra la tabla sesiones, y desde
//   un origen permitido. Entra a usuario:<id> y rol:<rol>: el rol lo decide el servidor, no el front.
// - Demo (app del celular): elige un perfil y entra a demo:<perfil>, que solo recibe textos sin
//   datos personales. No lleva cookie: cualquiera que escanee el QR la puede ver.
async function autenticar(socket, next) {
  const { demo } = socket.handshake.auth ?? {};

  if (demo !== undefined) {
    if (!PERFILES_DEMO.includes(demo)) return next(new Error("perfil_desconocido"));

    socket.data.salas = [`demo:${demo}`];
    return next();
  }

  // Una página de otro sitio no puede abrir el socket con la sesión de quien la visita
  if (!origenesPermitidos.includes(socket.handshake.headers.origin)) {
    return next(new Error("origen_no_permitido"));
  }

  try {
    const { token_acceso: token } = parseCookie(socket.handshake.headers.cookie ?? "");
    const sesion = await buscarSesion(token);

    if (!sesion) return next(new Error("sin_sesion"));

    // La sala personal va primero: en el historial gana su versión del mensaje
    socket.data.salas = [`usuario:${sesion.id}`, `rol:${sesion.rol}`];
    socket.data.salaSesion = `sesion:${sesion.tokenHash}`;
    return next();
  } catch (error) {
    console.error("Error al validar la sesión del socket:", error.message);
    return next(new Error("error_interno"));
  }
}

export function crearSocket(servidorHttp) {
  // Solo WebSocket (sin long-polling): con varias réplicas en Kubernetes no hace falta
  // que el balanceador mande siempre al mismo pod
  const io = new Server(servidorHttp, {
    path: RUTA_SOCKET,
    transports: ["websocket"],
    serveClient: false,
    adapter: createAdapter(redisPub, redisSub),
  });

  io.use(autenticar);

  io.on("connection", async (socket) => {
    const { salas, salaSesion } = socket.data;
    socket.join(salaSesion ? [...salas, salaSesion] : salas);

    try {
      socket.emit("historial", await leerHistorial(salas));
    } catch (error) {
      console.error("No se pudo leer el historial:", error.message);
      socket.emit("historial", []);
    }
  });

  return io;
}

// Guarda en el historial de cada sala y avisa en vivo. Devuelve el id del evento, o null si el tipo
// no existe. Con el adaptador de Redis, emit llega a los sockets de todas las réplicas
export async function publicar(io, tipo, datos) {
  const entregas = armarEntregas(tipo, datos);

  if (!entregas) return null;

  for (const { sala, excepto, notificacion } of entregas) {
    await guardarEnHistorial(sala, notificacion);
    const destino = excepto ? io.to(sala).except(excepto) : io.to(sala);
    destino.emit("notificacion", notificacion);
  }

  if (tipo === "usuario.eliminado" && datos.usuarioId) {
    // La cuenta ya no existe: se cierran sus sockets y se olvida su historial personal
    io.in(`usuario:${datos.usuarioId}`).disconnectSockets(true);
    await borrarHistorial(`usuario:${datos.usuarioId}`);
  }

  if (tipo === "usuario.rolCambiado" && datos.usuarioId) {
    // Sus salas dependían del rol viejo: se cortan sus sockets (un instante después, para que le
    // llegue el aviso) y su app revalida la sesión y la lleva a la app del rol nuevo
    setTimeout(() => io.in(`usuario:${datos.usuarioId}`).disconnectSockets(true), 500);
  }

  return entregas[0]?.notificacion.id ?? null;
}

// Al cerrar sesión (InicioSesionBiblioTK) se desconectan los sockets abiertos con esa cookie
export function cerrarSesion(io, tokenHash) {
  io.in(`sesion:${tokenHash}`).disconnectSockets(true);
}
