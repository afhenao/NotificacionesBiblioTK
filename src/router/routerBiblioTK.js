import { Router } from "express";
import { catalogo } from "../eventos.js";
import { soloInterno } from "../middlewares/soloInterno.js";
import { cerrarSesion, publicar } from "../socket.js";
import { qrMovil, urlMovil } from "../utils/movil.js";

export function crearRouter(io) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.status(200).json({ message: "Servicio de notificaciones activo" });
  });

  // Los backends avisan aquí después de hacer commit: { tipo, datos }
  router.post("/interno/eventos", soloInterno, async (req, res, next) => {
    const { tipo, datos } = req.body ?? {};

    if (!Object.hasOwn(catalogo, tipo) || typeof datos !== "object" || datos === null) {
      return res.status(400).json({ message: "Evento desconocido o sin datos." });
    }

    try {
      const id = await publicar(io, tipo, datos);
      return res.status(202).json({ id });
    } catch (error) {
      return next(error);
    }
  });

  // InicioSesionBiblioTK avisa al cerrar sesión: { tokenHash } (SHA-256 de la cookie, nunca el valor)
  router.post("/interno/sesiones/cierre", soloInterno, (req, res) => {
    const tokenHash = req.body?.tokenHash;

    if (typeof tokenHash !== "string" || !/^[0-9a-f]{64}$/.test(tokenHash)) {
      return res.status(400).json({ message: "Falta el hash de la sesión." });
    }

    cerrarSesion(io, tokenHash);
    return res.status(204).end();
  });

  // Para el QR de la landing: a dónde debe ir el celular
  router.get("/movil", (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.json({ url: urlMovil() });
  });

  router.get("/movil/qr.svg", async (_req, res, next) => {
    try {
      res.set("Cache-Control", "no-cache");
      res.type("image/svg+xml").send(await qrMovil());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
