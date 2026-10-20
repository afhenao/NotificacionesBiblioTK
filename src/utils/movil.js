import os from "node:os";
import QRCode from "qrcode";

// Adaptadores que no son la red del celular (VirtualBox, Hyper-V/WSL, Docker, VMware)
const adaptadoresVirtuales = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Docker|vboxnet|veth|br-/i;

// El celular no llega a "localhost": el QR lleva la IP del computador en la red local.
// Se prefiere el Wi-Fi y se salta la red solo-anfitrión de VirtualBox (192.168.56.x)
function ipEnLaRed() {
  const candidatas = [];

  for (const [nombre, direcciones] of Object.entries(os.networkInterfaces())) {
    if (adaptadoresVirtuales.test(nombre)) continue;

    for (const direccion of direcciones ?? []) {
      if (direccion.family !== "IPv4" || direccion.internal) continue;
      if (direccion.address.startsWith("192.168.56.")) continue;
      candidatas.push({ nombre, ip: direccion.address });
    }
  }

  const wifi = candidatas.find(({ nombre }) => /wi-?fi|wlan|wireless/i.test(nombre));
  return (wifi ?? candidatas[0])?.ip ?? "localhost";
}

// MOVIL_URL manda cuando existe (en Docker/Kubernetes el contenedor no ve la IP del computador)
export function urlMovil() {
  const configurada = process.env.MOVIL_URL?.trim();

  if (configurada) return configurada;

  const puerto = Number(process.env.MOVIL_PUERTO) || 5177;
  return `http://${ipEnLaRed()}:${puerto}/`;
}

export function qrMovil() {
  return QRCode.toString(urlMovil(), {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#143229", light: "#fdfbf7" },
  });
}
