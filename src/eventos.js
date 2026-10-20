import { randomUUID } from "node:crypto";

const zonaHoraria = process.env.ZONA_HORARIA?.trim() || "America/Bogota";
const formatoFecha = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "long",
  timeZone: zonaHoraria,
});

function fecha(valor) {
  const dia = new Date(valor);
  return Number.isNaN(dia.getTime()) ? "la fecha indicada" : formatoFecha.format(dia);
}

const tipoDeCuenta = {
  usuario: "lector",
  admin: "bibliotecario",
  superadmin: "superadministrador",
};

const nombre = (d) => d.nombre || d.usuarioNombre || "Un usuario";
const titulo = (d) => `«${d.materialTitulo || d.titulo || "un material"}»`;
const cuenta = (d) => tipoDeCuenta[d.rol] ?? "usuario";

// Quién recibe cada evento y con qué texto. Las claves de "mensajes" son las audiencias:
//   superadmin, admin → salas rol:superadmin y rol:admin (todas las cuentas reales con ese rol)
//   dueno             → sala usuario:<usuarioId> (la persona de la que habla el evento)
//   demo.<perfil>     → canal de la app del celular: sin nombres, correos ni cédulas
// Si una plantilla devuelve null, esa audiencia no recibe nada.
// Reparto acordado: el superadmin ve lo de usuarios; el admin, catálogo y préstamos;
// cada lector, solo su perfil y sus préstamos.
export const catalogo = {
  "usuario.registrado": {
    categoria: "usuarios",
    titulo: "Nueva cuenta",
    mensajes: {
      superadmin: (d) => `${nombre(d)} (${d.email}) se registró como lector.`,
      "demo.superadmin": () => "Se registró una cuenta nueva de lector.",
    },
  },
  "usuario.eliminado": {
    categoria: "usuarios",
    titulo: "Cuenta eliminada",
    mensajes: {
      superadmin: (d) => `${nombre(d)} eliminó su cuenta de ${cuenta(d)}.`,
      "demo.superadmin": (d) => `Se eliminó una cuenta de ${cuenta(d)}.`,
    },
  },
  "perfil.actualizado": {
    categoria: "usuarios",
    titulo: "Perfil actualizado",
    mensajes: {
      superadmin: (d) => `${nombre(d)} actualizó los datos de su perfil.`,
      dueno: () => "Actualizaste los datos de tu perfil.",
      "demo.superadmin": () => "Un usuario actualizó los datos de su perfil.",
      // El canal de lector del celular solo muestra lo que hacen los lectores
      "demo.usuario": (d) => (d.rol === "usuario" ? "Actualizaste los datos de tu perfil." : null),
    },
  },
  "material.creado": {
    categoria: "catalogo",
    titulo: "Material nuevo",
    mensajes: {
      admin: (d) => `Se agregó ${titulo(d)} al catálogo.`,
      "demo.admin": (d) => `Se agregó ${titulo(d)} al catálogo.`,
    },
  },
  "material.actualizado": {
    categoria: "catalogo",
    titulo: "Material actualizado",
    mensajes: {
      admin: (d) => `Se actualizaron los datos de ${titulo(d)}.`,
      "demo.admin": (d) => `Se actualizaron los datos de ${titulo(d)}.`,
    },
  },
  "material.eliminado": {
    categoria: "catalogo",
    titulo: "Material eliminado",
    mensajes: {
      admin: (d) => `Se eliminó ${titulo(d)} del catálogo.`,
      "demo.admin": (d) => `Se eliminó ${titulo(d)} del catálogo.`,
    },
  },
  "prestamo.creado": {
    categoria: "prestamos",
    titulo: "Préstamo nuevo",
    mensajes: {
      admin: (d) => `${nombre(d)} pidió ${titulo(d)}.`,
      dueno: (d) =>
        `Pediste ${titulo(d)}. Recógelo en ${d.lugarRecogida} y devuélvelo antes del ${fecha(d.fechaDevolucionEsperada)}.`,
      "demo.admin": (d) => `Un lector pidió ${titulo(d)}.`,
      "demo.usuario": (d) => `Préstamo registrado: ${titulo(d)}. Recógelo en ${d.lugarRecogida}.`,
    },
  },
  "prestamo.cancelado": {
    categoria: "prestamos",
    titulo: "Préstamo cancelado",
    mensajes: {
      admin: (d) =>
        d.canceladoPor === "admin"
          ? `Se canceló el préstamo de ${titulo(d)} a ${nombre(d)}.`
          : `${nombre(d)} canceló su préstamo de ${titulo(d)}.`,
      dueno: (d) =>
        d.canceladoPor === "admin"
          ? `La biblioteca canceló tu préstamo de ${titulo(d)}.${d.motivo ? ` Motivo: ${d.motivo}` : ""}`
          : `Cancelaste tu préstamo de ${titulo(d)}.`,
      "demo.admin": (d) => `Se canceló un préstamo de ${titulo(d)}.`,
      "demo.usuario": (d) =>
        d.canceladoPor === "admin"
          ? `La biblioteca canceló el préstamo de ${titulo(d)}.`
          : `Cancelaste el préstamo de ${titulo(d)}.`,
    },
  },
  "prestamo.devuelto": {
    categoria: "prestamos",
    titulo: "Devolución registrada",
    mensajes: {
      admin: (d) => `Se registró la devolución de ${titulo(d)} (${nombre(d)}).`,
      dueno: (d) => `Registramos la devolución de ${titulo(d)}. ¡Gracias!`,
      "demo.admin": (d) => `Se registró la devolución de ${titulo(d)}.`,
      "demo.usuario": (d) => `Devolución registrada: ${titulo(d)}. ¡Gracias!`,
    },
  },
  "prestamo.vencido": {
    categoria: "prestamos",
    titulo: "Préstamo vencido",
    mensajes: {
      admin: (d) => `Venció el préstamo de ${titulo(d)} (${nombre(d)}).`,
      dueno: (d) => `Tu préstamo de ${titulo(d)} venció: devuélvelo cuanto antes.`,
      "demo.admin": (d) => `Venció un préstamo de ${titulo(d)}.`,
      "demo.usuario": (d) => `El préstamo de ${titulo(d)} venció: devuélvelo cuanto antes.`,
    },
  },
};

function salaDe(audiencia, salaDueno) {
  if (audiencia === "dueno") return salaDueno;
  if (audiencia.startsWith("demo.")) return `demo:${audiencia.slice(5)}`;
  return `rol:${audiencia}`;
}

// Arma una notificación por sala. Todas comparten el id del evento: si una cuenta está en dos
// salas (un superadmin que edita su propio perfil), la del dueño gana en vivo y en el historial
export function armarEntregas(tipo, datos = {}) {
  const evento = catalogo[tipo];

  if (!evento) return null;

  const id = randomUUID();
  const fechaEvento = new Date().toISOString();
  const salaDueno = datos.usuarioId ? `usuario:${datos.usuarioId}` : null;
  const entregas = [];

  for (const [audiencia, plantilla] of Object.entries(evento.mensajes)) {
    const sala = salaDe(audiencia, salaDueno);
    const mensaje = sala ? plantilla(datos) : null;

    if (!mensaje) continue;

    entregas.push({
      sala,
      excepto: sala.startsWith("rol:") && evento.mensajes.dueno ? salaDueno : null,
      notificacion: {
        id,
        tipo,
        categoria: evento.categoria,
        titulo: evento.titulo,
        mensaje,
        fecha: fechaEvento,
      },
    });
  }

  return entregas;
}
