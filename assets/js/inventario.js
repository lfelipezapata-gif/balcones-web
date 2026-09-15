// «reservado» es un lote que el dueño retira de la venta por un tiempo. No se
// vendió y no entró plata por él: sigue siendo inventario, y en el tablero de
// socios tiene que seguir contando entre los que faltan por vender. Lo único
// que cambia es que hoy no se puede pedir desde la página.
export const ESTADOS = ['disponible', 'reservado', 'vendido', 'especie'];

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

// El anteproyecto de un lote: el paquete de render que muestra QUÉ SE PUEDE
// construir ahí. Es un manifiesto aparte y no un bloque dentro de este JSON
// porque son doce imágenes con su pie, un video y un aviso legal: metido acá
// engordaría el inventario que carga TODA visita, para un dato que hoy usa un
// solo lote y solo cuando alguien abre su ficha.
//
// Va cerrado igual que la panorámica, y por la misma razón: esta ruta termina
// en un `fetch` desde la página de venta. Una URL de afuera traería contenido
// que no controlamos justo en el momento en que alguien está decidiendo.
const RUTA_CASA = /^data\/casa-lote-[0-9]{1,3}\.json$/;

// Caja de coordenadas alrededor de Santa Rosa de Osos. Las escribe
// herramientas/preparar-aereo.py convirtiendo el CAD de EPSG:9377 a WGS84, y
// una conversion mal hecha no da un numero raro: da un numero perfectamente
// valido en otro pais. Sin esta caja, un alfiler en el oceano o en Nueva York
// se publica sin que nada se queje.
//
// El margen es generoso a proposito -- no vale la pena apretarlo al predio y
// tener que tocarlo cada vez que se compre un lote vecino.
const CAJA = { latMin: 6.5, latMax: 6.8, lonMin: -75.6, lonMax: -75.3 };

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
    const tieneLat = 'lat' in l, tieneLon = 'lon' in l;
    if (tieneLat !== tieneLon) {
      throw new Error(
        `El lote ${l.n} trae media coordenada. Van las dos o ninguna.`
      );
    }
    if (tieneLat && !(
      typeof l.lat === 'number' && typeof l.lon === 'number' &&
      l.lat >= CAJA.latMin && l.lat <= CAJA.latMax &&
      l.lon >= CAJA.lonMin && l.lon <= CAJA.lonMax
    )) {
      throw new Error(
        `El lote ${l.n} tiene una coordenada fuera de Santa Rosa: ${l.lat}, ${l.lon}`
      );
    }
    if ('pano' in l && !(typeof l.pano === 'string' && RUTA_PANO.test(l.pano))) {
      throw new Error(
        `El lote ${l.n} tiene un «pano» que no es una panorámica de este sitio: ${l.pano}. ` +
        'Tiene que ser una ruta como img/pano/lote-07.jpg.'
      );
    }
    if ('casa' in l && !(typeof l.casa === 'string' && RUTA_CASA.test(l.casa))) {
      throw new Error(
        `El lote ${l.n} tiene una «casa» que no es un manifiesto de este sitio: ${l.casa}. ` +
        'Tiene que ser una ruta como data/casa-lote-6.json.'
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
  const reservados = json.lotes.filter(l => l.estado === 'reservado');
  // «Colocado» es el lote por el que ya hubo contraprestación: vendido, o
  // entregado como pago en especie. Antes esto era «todo lo que no está
  // disponible», que con la llegada de «reservado» habría contado como
  // colocado un lote que sigue siendo del proyecto y por el que no entró un
  // peso — y lo habría pintado de gris en el plano.
  const colocados = json.lotes.filter(l => l.estado === 'vendido' || l.estado === 'especie');
  const vendidos = json.lotes.filter(l => l.estado === 'vendido');
  const areaDisponible = suma(disponibles);
  return {
    areaTotal: suma(json.lotes),
    disponibles: disponibles.length,
    areaDisponible,
    valorDisponible: areaDisponible * json.precioM2,
    reservados: reservados.length,
    areaReservada: suma(reservados),
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
      precio: precioDeLote(l, json.precioM2),
      pano: l.pano ?? null
    }));
}

// ── El manifiesto de anteproyecto ───────────────────────────────────────────
// Lo que `casa` apunta. Se valida aparte porque no llega con el inventario:
// entra por `fetch` cuando alguien abre la ficha de un lote que lo tiene, y
// para entonces ya no hay nadie mirando si el archivo quedó bien.
//
// Las rutas van cerradas igual que la panorámica. Estas terminan dentro de un
// <img> y de un <video> en la página de venta: una URL de afuera cargaría
// material de un servidor ajeno en la pestaña del cliente.
const RUTA_IMG_CASA = /^img\/casa-lote-[0-9]{1,3}\/[a-z0-9-]+\.jpg$/;
const RUTA_VIDEO_CASA = /^video\/casa-lote-[0-9]{1,3}\.mp4$/;

export function validarCasa(casa) {
  if (!casa || typeof casa !== 'object') {
    throw new Error('El manifiesto de anteproyecto no es un objeto.');
  }
  for (const campo of ['titulo', 'aviso']) {
    if (typeof casa[campo] !== 'string' || !casa[campo].trim()) {
      throw new Error(`El manifiesto de anteproyecto no trae «${campo}».`);
    }
  }
  // El aviso no es decorativo: es lo que separa una propuesta de una promesa.
  // Un manifiesto que lo deje en blanco o le quite la frase no se publica.
  if (!/sin construcci[óo]n/i.test(casa.aviso)) {
    throw new Error(
      'El aviso del anteproyecto tiene que decir que el lote se vende sin construcción.'
    );
  }
  if (!RUTA_VIDEO_CASA.test(String(casa.video ?? ''))) {
    throw new Error(`El video del anteproyecto no es de este sitio: ${casa.video}`);
  }
  if (!RUTA_IMG_CASA.test(String(casa.poster ?? ''))) {
    throw new Error(`El poster del anteproyecto no es de este sitio: ${casa.poster}`);
  }
  if (!Array.isArray(casa.imagenes) || casa.imagenes.length === 0) {
    throw new Error('El manifiesto de anteproyecto no trae imágenes.');
  }
  for (const par of casa.imagenes) {
    if (!Array.isArray(par) || par.length !== 2) {
      throw new Error('Cada imagen del anteproyecto va como [ruta, pie].');
    }
    const [src, pie] = par;
    if (!RUTA_IMG_CASA.test(String(src))) {
      throw new Error(`Una imagen del anteproyecto no es de este sitio: ${src}`);
    }
    // Sin pie, la imagen no explica nada y el lector de pantalla queda mudo.
    if (typeof pie !== 'string' || !pie.trim()) {
      throw new Error(`La imagen ${src} del anteproyecto no trae pie.`);
    }
  }
  if (casa.datos !== undefined) {
    if (!Array.isArray(casa.datos)) {
      throw new Error('Los datos del anteproyecto van en una lista.');
    }
    for (const d of casa.datos) {
      if (!Array.isArray(d) || d.length !== 2 ||
          !String(d[0]).trim() || !String(d[1]).trim()) {
        throw new Error('Cada dato del anteproyecto va como [cifra, explicación].');
      }
    }
  }
  return casa;
}
