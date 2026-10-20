import { createClient } from "redis";

export const urlRedis = process.env.REDIS_URL?.trim() || "redis://localhost:6379";

// Uno para el historial y los dos que pide el adaptador de Socket.IO (publicar y suscribirse):
// con el adaptador, un evento que llega a una réplica sale por los sockets de todas
export const redis = createClient({ url: urlRedis });
export const redisPub = redis.duplicate();
export const redisSub = redis.duplicate();

// Mientras Redis no responde, node-redis reintenta solo y repite el mismo error: se muestra una vez
for (const [nombre, cliente] of Object.entries({ redis, redisPub, redisSub })) {
  let ultimoError = "";

  cliente.on("error", (error) => {
    if (error.message === ultimoError) return;
    ultimoError = error.message;
    console.error(`Redis (${nombre}): ${error.message}`);
  });
  cliente.on("ready", () => {
    ultimoError = "";
  });
}

export async function conectarRedis() {
  console.log(`Conectando a Redis en ${urlRedis}...`);
  await Promise.all([redis.connect(), redisPub.connect(), redisSub.connect()]);
  console.log("Conexión a Redis exitosa");
}
