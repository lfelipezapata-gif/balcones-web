// Los tres paneles del tablero de socios: las seis cifras de arriba, la ficha
// de un lote y el panel de gastos.
//
// TODO lo de este archivo trabaja sobre la vista que ya armó
// `construirVistaTablero` (assets/js/tablero.js), no sobre el JSON crudo del
// Worker. Ahí es donde se escapa el texto que viene de la hoja de Google, y ese
// paso no se repite acá. Si alguien le pasa a estas funciones el tablero crudo,
// lo que devuelvan va a llegar sin escapar a innerHTML y vuelve el XSS del
// comprador `<img src=x onerror=...>`. Por eso el parámetro se llama `vista`.
//
// El área, el estado y el precio de lista salen de data/lotes.json, que es el
// mismo dato que pinta el plano y la vitrina pública: números y estados
// validados por `validarInventario`, sin texto libre de nadie.

import { pesos, metros } from './formato.js';
import { validarInventario, precioDeLote } from './inventario.js';

// Los rótulos largos vienen del nombre de la fila en la hoja («Disponible»,
// «Gastado en obra»). En la fila de seis cifras no caben y además «Disponible»
// pegado a «Caja» se lee como plata disponible, que es justo lo que no es: es
// el valor del inventario sin vender.
const ROTULO_CORTO = {
  'Disponible': 'Inventario',
  'Gastado en obra': 'Obra'
};

const ETIQUETA_ESTADO = {
  vendido: 'Vendido',
  disponible: 'Disponible',
  especie: 'En especie'
};

export function construirCifras(resumen) {
  return (resumen ?? []).map(r => ({
    etiqueta: ROTULO_CORTO[r.etiqueta] ?? r.etiqueta,
    texto: r.texto
  }));
}

// ---- la ficha de un lote ------------------------------------------------

const ACENTOS = /[\u0300-\u036f]/g;

// ¿El calendario del saldo habla de algo vencido?
//
// Se mira el TEXTO, no una fecha. La hoja escribe la mora en palabras
// —«$10.000.000 vencidos el 24-ago-2026»— y no hay ninguna columna aparte que
// la marque, así que no hay nada que comparar contra el reloj. Se normalizan
// acentos y mayúsculas para que «Vencido», «vencidas» y «VENCIDOS» cuenten
// igual. Escapar no toca las letras, así que da lo mismo mirarlo antes o
// después de `escapar`.
export function mencionaVencido(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(ACENTOS, '').toLowerCase()
    .includes('vencid');
}

// Cuánto del precio ya está pagado, de 0 a 100.
//
// Devuelve null —y entonces no se dibuja barra— cuando no se puede calcular:
// sin precio, sin abonado, o con un precio que no sirve de denominador. Una
// barra en 0 % sobre datos que faltan afirma que el comprador no ha pagado
// nada, y eso es distinto de «no se sabe». Es la misma regla de la raya contra
// el $0, aplicada a un dibujo en vez de a una cifra.
export function porcentajePagado(abonado, precio) {
  if (typeof abonado !== 'number' || typeof precio !== 'number') return null;
  if (!Number.isFinite(abonado) || !Number.isFinite(precio) || precio <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((abonado / precio) * 100)));
}

function fichaBase(lote) {
  return {
    n: lote.n,
    numeroTexto: String(lote.n),
    estado: lote.estado,
    etiqueta: ETIQUETA_ESTADO[lote.estado] ?? lote.estado,
    filas: [],
    progreso: null,
    calendario: null,
    nota: null
  };
}

// Un lote con fila en la cartera. Las cifras salen ya formateadas de
// construirVistaTablero (`precioTexto` y compañía), así que un null que llegue
// de la hoja ya viene como raya y nunca como $0.
function fichaConCartera(lote, c) {
  const filas = [
    { etiqueta: 'Comprador', valor: c.comprador || '—' },
    { etiqueta: 'Estado', valor: c.estado || '—' }
  ];
  // El Worker de hoy no manda una fecha de promesa aparte: la hoja la escribe
  // dentro de la columna Estado. Si algún día llega como campo propio, entra
  // acá sola y ya viene escapada por `escaparTextos`.
  if (c.fechaPromesa) filas.push({ etiqueta: 'Promesa', valor: c.fechaPromesa });
  filas.push(
    { etiqueta: 'Área', valor: metros(lote.area) },
    { etiqueta: 'Precio', valor: c.precioTexto },
    { etiqueta: 'Abonado', valor: c.abonadoTexto },
    { etiqueta: 'Saldo', valor: c.saldoTexto }
  );

  const pct = porcentajePagado(c.abonado, c.precio);
  return {
    ...fichaBase(lote),
    etiqueta: ETIQUETA_ESTADO.vendido,
    filas,
    progreso: pct === null ? null : { porcentaje: pct, texto: `${pct} % pagado` },
    calendario: {
      texto: c.proximaCuotaTexto,
      vencido: mencionaVencido(c.proximaCuotaTexto)
    }
  };
}

// El plano lo da por vendido y la cartera no trae su fila. No se inventa
// ninguna cifra: sin precio no hay barra, y sin saldo no hay calendario.
function fichaVendidaSinCartera(lote) {
  return {
    ...fichaBase(lote),
    filas: [{ etiqueta: 'Área', valor: metros(lote.area) }],
    nota: 'El plano lo da por vendido y la cartera todavía no trae su fila. No hay cifras que mostrar.'
  };
}

function fichaDisponible(lote, precioM2) {
  return {
    ...fichaBase(lote),
    filas: [
      { etiqueta: 'Área', valor: metros(lote.area) },
      { etiqueta: 'Precio de lista', valor: pesos(precioDeLote(lote, precioM2)) }
    ],
    nota: 'Sin promesa: sigue a la venta. El precio es el de lista, área por el valor del metro.'
  };
}

// El lote 2 se entregó como pago en especie. No entró plata, así que no tiene
// precio, ni abonado, ni saldo, ni barra: mostrarle un $0 a cualquiera de esos
// campos sería decir que se vendió en cero.
function fichaEspecie(lote) {
  return {
    ...fichaBase(lote),
    filas: [{ etiqueta: 'Área', valor: metros(lote.area) }],
    nota: 'Entregado como pago en especie. Por este lote no entra dinero, así que no tiene precio ni saldo.'
  };
}

/**
 * Arma una ficha por cada lote del inventario y avisa de lo que no cuadra
 * entre el plano y la cartera.
 *
 * @param vista       lo que devuelve `construirVistaTablero` (texto YA escapado)
 * @param inventario  el JSON de data/lotes.json
 *
 * Los `avisos` que salen de acá no son cosméticos. Sin ellos, una fila de
 * cartera cuyo lote no existe en el plano desaparecía de la pantalla sin dejar
 * rastro —el plano manda, y lo que no tiene polígono no se puede seleccionar—,
 * y un lote vendido que en data/lotes.json siguiera en «disponible» se estaría
 * anunciando en verde en la vitrina pública al mismo tiempo.
 */
export function construirVistaLotes(vista, inventario) {
  validarInventario(inventario);

  const cartera = vista?.cartera ?? [];
  const porLote = new Map(cartera.map(c => [c.lote, c]));
  const avisos = [];

  const fichas = [...inventario.lotes].sort((a, b) => a.n - b.n).map(lote => {
    const c = porLote.get(lote.n);

    if (lote.estado === 'especie') {
      if (c) {
        avisos.push(`El lote ${lote.n} figura como pago en especie en el plano y aun así trae fila en la cartera. Revisá cuál de los dos está mal.`);
      }
      return fichaEspecie(lote);
    }

    if (c) {
      if (lote.estado === 'disponible') {
        avisos.push(`El lote ${lote.n} tiene comprador en la cartera y en data/lotes.json sigue como disponible: la vitrina pública lo está mostrando en verde.`);
      }
      return fichaConCartera(lote, c);
    }

    return lote.estado === 'vendido'
      ? fichaVendidaSinCartera(lote)
      : fichaDisponible(lote, inventario.precioM2);
  });

  const enElPlano = new Set(inventario.lotes.map(l => l.n));
  for (const c of cartera) {
    if (!enElPlano.has(c.lote)) {
      avisos.push(`El lote ${c.lote} está en la cartera y no existe en el plano, así que no se puede abrir su ficha. Revisá data/lotes.json.`);
    }
  }

  // Al abrir arranca en el primer lote que tenga cartera: es la ficha que
  // enseña de qué se trata el panel. Si no hay ninguno, el primero del plano.
  const conCartera = fichas.find(f => porLote.has(f.n));
  const inicial = (conCartera ?? fichas[0])?.n ?? null;

  return { fichas, inicial, avisos };
}

// ---- el panel de gastos -------------------------------------------------

/**
 * Convierte los grupos de `construirVistaTablero.egresosPorCategoria` en el
 * panel: mismas categorías, ya ordenadas de mayor a menor, cada una con su
 * barra proporcional a la más grande, y el total general arriba.
 *
 * El total general se suma sobre categorías a las que el Worker pudo haberles
 * descartado filas ilegibles. Se marca igual que los totales por categoría, y
 * la marca viaja PEGADA a la cifra: nunca puede mostrarse un total que parece
 * completo cuando no lo está.
 */
export function construirVistaGastos(egresosPorCategoria) {
  const grupos = egresosPorCategoria ?? [];

  // Sin ninguna categoría no hay $0 que mostrar: no es que se haya gastado
  // cero, es que no llegó nada. Un $0 acá diría que la obra no ha costado
  // nada. Los avisos del final explican por qué está vacío.
  if (grupos.length === 0) {
    return { categorias: [], total: null, totalTexto: '—', incompleto: false, filasSinLeer: 0 };
  }

  const mayor = grupos.reduce((m, g) => Math.max(m, g.total), 0);
  const total = grupos.reduce((t, g) => t + g.total, 0);
  const filasSinLeer = grupos.reduce((t, g) => t + (g.filasSinLeer ?? 0), 0);

  return {
    categorias: grupos.map((g, i) => ({
      ...g,
      indice: i,
      // De 0 a 100 contra la categoría más grande. Con la mayor en cero o en
      // negativo no hay proporción posible y no se dibuja ninguna barra, en vez
      // de inventar una escala.
      proporcion: mayor > 0 ? Math.max(0, Math.round((g.total / mayor) * 100)) : 0
    })),
    total,
    totalTexto: filasSinLeer > 0
      ? `${pesos(total)} + ${filasSinLeer} ${filasSinLeer === 1 ? 'movimiento' : 'movimientos'} sin leer`
      : pesos(total),
    incompleto: filasSinLeer > 0,
    filasSinLeer
  };
}
