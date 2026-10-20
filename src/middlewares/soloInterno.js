import { timingSafeEqual } from "node:crypto";

const claveInterna = process.env.NOTIFICACIONES_CLAVE?.trim();
const direccionesLocales = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function mismaClave(recibida) {
  const a = Buffer.from(recibida);
  const b = Buffer.from(claveInterna);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Las rutas /interno las llaman los otros backends, nunca el navegador.
// Con NOTIFICACIONES_CLAVE (Docker/Kubernetes) piden esa clave en x-clave-interna;
// sin ella (desarrollo local) solo se aceptan llamadas desde la misma máquina
export function soloInterno(req, res, next) {
  const permitido = claveInterna
    ? mismaClave(req.get("x-clave-interna") ?? "")
    : direccionesLocales.has(req.socket.remoteAddress);

  if (!permitido) {
    return res.status(403).json({ message: "Solo los servicios de BiblioTK pueden publicar eventos." });
  }

  res.set("Cache-Control", "no-store");
  return next();
}
