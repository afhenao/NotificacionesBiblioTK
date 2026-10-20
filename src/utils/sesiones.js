import { createHash } from "node:crypto";
import pool from "../config/db.js";

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// La misma búsqueda que verificarSesion en Perfil/Materiales/Préstamos: la cookie token_acceso
// solo trae un valor aleatorio y el usuario (con su rol actual) sale de la tabla sesiones
export async function buscarSesion(token) {
  if (typeof token !== "string" || !token) return null;

  const tokenHash = hashToken(token);
  const [filas] = await pool.query(
    `SELECT u.id, u.rol FROM sesiones s
     JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ? AND s.expira > NOW()
     LIMIT 1`,
    [tokenHash],
  );

  return filas[0] ? { ...filas[0], tokenHash } : null;
}
