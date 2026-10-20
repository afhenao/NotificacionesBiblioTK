import { redis } from "../config/redis.js";

// Historial breve en caché: las últimas notificaciones de cada sala, una semana como máximo
export const MAX_HISTORIAL = 20;
const DURACION_SEGUNDOS = 7 * 24 * 60 * 60;

const clave = (sala) => `bibliotk:notificaciones:${sala}`;

export async function guardarEnHistorial(sala, notificacion) {
  await redis
    .multi()
    .lPush(clave(sala), JSON.stringify(notificacion))
    .lTrim(clave(sala), 0, MAX_HISTORIAL - 1)
    .expire(clave(sala), DURACION_SEGUNDOS)
    .exec();
}

// Junta el historial de varias salas, más reciente primero. Un mismo evento puede estar en dos
// salas con textos distintos: se queda el de la sala que va primero (la personal)
export async function leerHistorial(salas) {
  const listas = await Promise.all(
    salas.map((sala) => redis.lRange(clave(sala), 0, MAX_HISTORIAL - 1)),
  );
  const vistas = new Set();
  const notificaciones = [];

  for (const texto of listas.flat()) {
    const notificacion = JSON.parse(texto);

    if (vistas.has(notificacion.id)) continue;
    vistas.add(notificacion.id);
    notificaciones.push(notificacion);
  }

  return notificaciones
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, MAX_HISTORIAL);
}

export async function borrarHistorial(sala) {
  await redis.del(clave(sala));
}
