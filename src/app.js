import "dotenv/config";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { testConnection } from "./config/db.js";
import { origenesPermitidos } from "./config/origenes.js";
import { conectarRedis } from "./config/redis.js";
import { crearRouter } from "./router/routerBiblioTK.js";
import { crearSocket } from "./socket.js";

const app = express();
const servidor = createServer(app);
const puerto = Number(process.env.PORT) || 3006;

app.use(express.json({ limit: "32kb" }));
app.use(cors({ origin: origenesPermitidos, methods: ["GET", "POST"] }));

// Los detalles del error se quedan en la consola: al cliente solo le llega un mensaje genérico
function manejarErrores(error, _req, res, _next) {
  if (error.type === "entity.parse.failed") {
    return res
      .status(400)
      .json({ message: "El cuerpo de la solicitud no es un JSON válido" });
  }

  console.error("Error del servidor:", error);

  if (res.headersSent) return res.end();

  return res.status(500).json({ message: "Error interno del servidor" });
}

async function iniciarServidor() {
  try {
    await testConnection();
    await conectarRedis();

    const io = crearSocket(servidor);
    app.use("/NotificacionesBiblioTK", crearRouter(io));
    app.use(manejarErrores);

    servidor.listen(puerto, () => {
      console.log(`Servicio de notificaciones corriendo en el puerto ${puerto}`);
    });

    // Kubernetes manda SIGTERM antes de reemplazar un pod: se cierran los sockets con orden
    process.on("SIGTERM", () => {
      io.close(() => process.exit(0));
    });
  } catch {
    process.exitCode = 1;
  }
}

iniciarServidor();
