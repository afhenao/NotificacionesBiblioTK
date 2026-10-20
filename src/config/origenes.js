// Mismo criterio que Préstamos: los orígenes salen de ALLOWED_ORIGIN_* del .env y,
// si no hay ninguno, se aceptan los fronts locales para que funcione recién clonado
const origenesDelEnv = Object.entries(process.env)
  .filter(([clave, valor]) => clave.startsWith("ALLOWED_ORIGIN_") && valor)
  .map(([, origen]) => origen.trim());

export const origenesPermitidos = origenesDelEnv.length
  ? origenesDelEnv
  : [
      "http://localhost:5172",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
    ];
