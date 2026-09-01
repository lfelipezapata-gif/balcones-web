export const ESTADOS = ['disponible', 'vendido', 'especie'];

// Ruta de la panorámica 360 de un lote. Es opcional —el sitio se publica con
// unas pocas y las demás entran después— pero cuando viene tiene que ser un
// archivo de este mismo repositorio.
//
// El patrón es cerrado a propósito, no una comprobación de «no empieza por
// http». Esa ruta se le entrega al visor dentro de la página de venta: una URL
// de afuera cargaría una imagen que no controlamos, y un `..` sacaría al
// visitante del sitio. Cerrando la forma completa —carpeta fija, nombre sin
// puntos ni barras, extensión fija— no hay que ir adivinando qué otra cosa se
// puede escribir ahí.
const RUTA_PANO = /^img\/pano\/[a-z0-9-]+\.jpg$/;

export function validarInventario(json) {
  if (!json || typeof json.precioM2 !== 'number' || json.precioM2 <= 0) {
    throw new Error('El inventario no trae un precio por metro cuadrado válido.');
  }
  if (!Array.isArray(json.lotes) || json.lotes.length === 0) {
    throw new Error('El inventario no trae lotes.');
  }
  const vistos = new Set();
  for (const l of json.lotes) {
    if (!Number.isInteger(l.n) || l.n < 1) {
      throw new Error(`Número de lote inválido: ${l.n}`);
    }
    if (vistos.has(l.n)) throw new Error(`Lote repetido: ${l.n}`);
    vistos.add(l.n);
    if (!Number.isInteger(l.area) || l.area <= 0) {
      throw new Error(`El área del lote ${l.n} no es un entero positivo.`);
    }
    if (!ESTADOS.includes(l.estado)) {
      throw new Error(`El lote ${l.n} tiene un estado que no existe: ${l.estado}`);
    }
    if ('precio' in l) {
      throw new Error(`El lote ${l.n} trae un precio escrito. El precio se calcula.`);
    }
    if ('pano' in l && !(typeof l.pano === 'string' && RUTA_PANO.test(l.pano))) {
      throw new Error(
        `El lote ${l.n} tiene un «pano» que no es una panorámica de este sitio: ${l.pano}. ` +
        'Tiene que ser una ruta como img/pano/lote-07.jpg.'
      );
    }
  }
}

export function precioDeLote(lote, precioM2) {
  return lote.area * precioM2;
}

export function resumenInventario(json) {
  validarInventario(json);
  const suma = (ls) => ls.reduce((t, l) => t + l.area, 0);
  const disponibles = json.lotes.filter(l => l.estado === 'disponible');
  const colocados = json.lotes.filter(l => l.estado !== 'disponible');
  const vendidos = json.lotes.filter(l => l.estado === 'vendido');
  const areaDisponible = suma(disponibles);
  return {
    areaTotal: suma(json.lotes),
    disponibles: disponibles.length,
    areaDisponible,
    valorDisponible: areaDisponible * json.precioM2,
    colocados: colocados.length,
    areaColocada: suma(colocados),
    vendidos: vendidos.length,
    areaVendida: suma(vendidos)
  };
}

export function lotesDisponibles(json) {
  validarInventario(json);
  return json.lotes
    .filter(l => l.estado === 'disponible')
    .sort((a, b) => a.n - b.n)
    .map(l => ({
      n: l.n,
      sector: l.sector,
      area: l.area,
      precio: precioDeLote(l, json.precioM2)
    }));
}
