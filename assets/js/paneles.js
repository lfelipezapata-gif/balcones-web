// Los paneles del tablero de socios: las seis cifras de arriba, la ficha de un
// lote, el panel de gastos y la tabla de aportes de los socios.
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

import { pesos, metros, pesosConSigno, porcentaje } from './formato.js';
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

// Qué listado abre cada cifra de arriba.
//
// La clave sale del rótulo LARGO, que es el nombre de la fila en la hoja, no
// del corto que se ve en la tarjeta: el corto es cosa de esta pantalla y puede
// cambiar sin que cambie el dato.
//
// Una etiqueta que no esté acá sale con `clave: null` y se dibuja como caja
// quieta, no como botón muerto: si la hoja gana una fila nueva de resumen,
// aparece sin ser pulsable en vez de prometer un listado que no existe.
const CLAVE_DE_CIFRA = {
  'Vendido': 'vendido',
  'Abonado': 'abonado',
  'Por cobrar': 'porCobrar',
  'Disponible': 'disponible',
  'Gastado en obra': 'obra',
  'Caja': 'caja'
};

const PISTA_DE_CIFRA = {
  vendido: 'Ver los lotes colocados y quién los compró',
  abonado: 'Ver los abonos recibidos, con su fecha',
  porCobrar: 'Ver cuánto debe cada lote',
  disponible: 'Ver los lotes que faltan por vender',
  obra: 'Ver en qué se ha gastado',
  caja: 'Ver los movimientos de la caja'
};

export function construirCifras(resumen) {
  return (resumen ?? []).map(r => {
    const clave = CLAVE_DE_CIFRA[r.etiqueta] ?? null;
    return {
      etiqueta: ROTULO_CORTO[r.etiqueta] ?? r.etiqueta,
      texto: r.texto,
      clave,
      pista: clave === null ? null : PISTA_DE_CIFRA[clave]
    };
  });
}

// ---- el listado que abre cada cifra -------------------------------------
//
// Debajo de las seis cifras se abre el listado que explica la que se pulsó:
// «Vendido» muestra los lotes colocados y quién los compró, «Abonado» los
// abonos con su fecha, y así. Es la pregunta que sigue a cualquier total
// —«¿de dónde sale?»— contestada en el mismo sitio donde está el número.
//
// Los seis devuelven la MISMA forma —título, columnas, filas, pie—, y la vista
// tiene una sola plantilla para todos. Si cada listado trajera la suya, cada
// uno necesitaría su propio escapado, y ahí es donde se cuela el que se olvidó.
//
// El texto que sale de la hoja (comprador, concepto, categoría) llega YA
// escapado dentro de `vista`, igual que en el resto del archivo, y no se
// vuelve a tocar. Lo demás son literales de acá y cifras formateadas a partir
// de números.

// Una fecha convertida a algo que se pueda ordenar.
//
// No se compara el texto: «05/09/2026» va antes que «19/08/2026» en orden
// alfabético y después en el calendario. Con los tres abonos de agosto que hay
// hoy da igual; en cuanto entre uno de septiembre, no.
//
// Entiende las dos formas que puede mandar el worker: «dd/mm/aaaa», que es lo
// que devuelve `fechaLegible` cuando la celda trae una fecha de verdad, y
// «aaaa-mm-dd», que es lo que devuelve cuando la celda trae la fecha escrita a
// mano como texto y la deja pasar tal cual. Cualquier otra cosa es null, y esas
// filas van al final en vez de colarse en una posición inventada.
function ordenDeFecha(texto) {
  const t = String(texto ?? '').trim();
  const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (barras) return Number(barras[3]) * 10000 + Number(barras[2]) * 100 + Number(barras[1]);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
  return null;
}

const nombreDeLote = (n) => `Lote ${n}`;

// Una fila de plata que la cartera no trajo. Se distingue del «$0» a propósito:
// que no haya cifra no es que la cifra sea cero.
const RAYA = '—';

function detalleVendido(vista, inventario) {
  const porLote = new Map((vista?.cartera ?? []).map(c => [c.lote, c]));
  const lotes = [...inventario.lotes]
    .filter(l => GRUPO_DE_ESTADO[l.estado] === 'vendidos')
    .sort((a, b) => a.n - b.n);
  const plata = sumarPlataDeLotes(lotes, porLote, 'precio');
  const enEspecie = lotes.filter(l => l.estado === 'especie').length;

  return {
    titulo: 'Los lotes colocados',
    columnas: [
      { etiqueta: 'Lote' }, { etiqueta: 'Comprador' },
      { etiqueta: 'Área', numerica: true }, { etiqueta: 'Valor', numerica: true }
    ],
    filas: lotes.map(l => {
      const c = porLote.get(l.n);
      const especie = l.estado === 'especie';
      return {
        celdas: [
          nombreDeLote(l.n),
          especie ? 'Entregado como pago en especie' : (c?.comprador || 'Sin fila en la cartera'),
          metros(l.area),
          especie || !c ? RAYA : c.precioTexto
        ],
        // El lote que el plano da por vendido y la cartera no conoce sí es un
        // problema: falta plata de verdad. El de especie no — por él nunca
        // entró un peso y eso ya se sabe.
        alerta: !especie && !c
      };
    }),
    pie: { etiqueta: `${lotes.length} ${lotes.length === 1 ? 'lote' : 'lotes'}`, valor: plata.texto },
    nota: enEspecie === 0 ? null
      : 'El lote entregado como pago en especie cuenta entre los colocados, pero por él no entró dinero y no suma al valor.',
    vacio: 'Todavía no hay ningún lote colocado.'
  };
}

function detalleAbonado(vista) {
  const cartera = vista?.cartera ?? [];
  const filas = [];

  for (const c of cartera) {
    for (const a of c.abonos ?? []) {
      filas.push({
        orden: ordenDeFecha(a.fecha),
        celdas: [a.fecha || RAYA, nombreDeLote(c.lote), c.comprador || RAYA, a.valorTexto],
        alerta: false
      });
    }
  }

  // Los abonos sin fecha van al final: son los que se registraron como un solo
  // monto antes de que se llevara el detalle, y no se sabe cuándo entraron.
  filas.sort((x, y) => {
    if (x.orden === null && y.orden === null) return 0;
    if (x.orden === null) return 1;
    if (y.orden === null) return -1;
    return x.orden - y.orden;
  });

  const sinFecha = filas.filter(f => f.orden === null).length;
  const total = cartera.reduce(
    (t, c) => t + (c.abonos ?? []).reduce((s, a) => s + (typeof a.valor === 'number' ? a.valor : 0), 0), 0);

  return {
    titulo: 'Los abonos recibidos',
    columnas: [
      { etiqueta: 'Fecha' }, { etiqueta: 'Lote' },
      { etiqueta: 'Comprador' }, { etiqueta: 'Abono', numerica: true }
    ],
    filas: filas.map(({ celdas, alerta }) => ({ celdas, alerta })),
    pie: { etiqueta: `${filas.length} ${filas.length === 1 ? 'abono' : 'abonos'}`, valor: pesos(total) },
    nota: sinFecha === 0 ? null
      : `${sinFecha} ${sinFecha === 1 ? 'abono viene' : 'abonos vienen'} sin fecha: se registraron como un solo monto antes de que se llevara el detalle. Suman igual.`,
    vacio: 'Todavía no se ha registrado ningún abono.'
  };
}

function detallePorCobrar(vista) {
  const conSaldo = (vista?.cartera ?? [])
    .filter(c => typeof c.saldo !== 'number' || c.saldo !== 0)
    .sort((a, b) => (b.saldo ?? 0) - (a.saldo ?? 0));
  const total = conSaldo.reduce((t, c) => t + (typeof c.saldo === 'number' ? c.saldo : 0), 0);
  const vencidos = conSaldo.filter(c => mencionaVencido(c.proximaCuotaTexto)).length;

  return {
    titulo: 'Lo que falta por cobrar',
    columnas: [
      { etiqueta: 'Lote' }, { etiqueta: 'Comprador' },
      { etiqueta: 'Abonado', numerica: true }, { etiqueta: 'Saldo', numerica: true }
    ],
    // De mayor a menor saldo: el que más debe es el que primero hay que mirar.
    filas: conSaldo.map(c => ({
      celdas: [nombreDeLote(c.lote), c.comprador || RAYA, c.abonadoTexto, c.saldoTexto],
      alerta: mencionaVencido(c.proximaCuotaTexto)
    })),
    pie: { etiqueta: `${conSaldo.length} ${conSaldo.length === 1 ? 'lote' : 'lotes'}`, valor: pesos(total) },
    nota: vencidos === 0 ? null
      : `${vencidos === 1 ? 'Un lote tiene' : `${vencidos} lotes tienen`} una cuota vencida. Están marcados.`,
    vacio: 'No queda saldo por cobrar.'
  };
}

function detalleDisponible(vista, inventario) {
  const lotes = [...inventario.lotes]
    .filter(l => GRUPO_DE_ESTADO[l.estado] === 'sinVender')
    .sort((a, b) => a.n - b.n);
  const total = lotes.reduce((t, l) => t + precioDeLote(l, inventario.precioM2), 0);

  return {
    titulo: 'Los lotes sin vender',
    columnas: [
      { etiqueta: 'Lote' }, { etiqueta: 'Sector' },
      { etiqueta: 'Área', numerica: true }, { etiqueta: 'Valor de lista', numerica: true }
    ],
    filas: lotes.map(l => ({
      celdas: [nombreDeLote(l.n), `Sector ${l.sector}`, metros(l.area),
        pesos(precioDeLote(l, inventario.precioM2))],
      alerta: false
    })),
    pie: { etiqueta: metros(lotes.reduce((t, l) => t + l.area, 0)), valor: pesos(total) },
    // El precio no se lee de ninguna celda: es el área por el valor del metro,
    // el mismo cálculo con el que la vitrina pública anuncia cada lote.
    nota: `A precio de lista: el área de cada lote por ${pesos(inventario.precioM2)} el metro.`,
    vacio: 'No queda ningún lote sin vender.'
  };
}

function detalleObra(vista) {
  const grupos = vista?.egresosPorCategoria ?? [];
  const total = grupos.reduce((t, g) => t + g.total, 0);
  const sinLeer = grupos.reduce((t, g) => t + (g.filasSinLeer ?? 0), 0);
  const pagos = grupos.reduce((t, g) => t + g.movimientos.length, 0);

  return {
    titulo: 'En qué se ha gastado',
    columnas: [
      { etiqueta: 'Categoría' }, { etiqueta: 'Pagos', numerica: true },
      { etiqueta: 'Total', numerica: true }
    ],
    // Ya vienen de mayor a menor de `construirVistaTablero`.
    filas: grupos.map(g => ({
      celdas: [g.categoria, String(g.movimientos.length), g.totalTexto],
      alerta: g.incompleto
    })),
    pie: {
      etiqueta: `${pagos} ${pagos === 1 ? 'pago' : 'pagos'}`,
      // La marca de incompleto viaja PEGADA a la cifra, como en el resto del
      // archivo: ninguna plantilla puede mostrar el total sin mostrar que le
      // falta algo.
      valor: sinLeer > 0
        ? `${pesos(total)} + ${sinLeer} ${sinLeer === 1 ? 'movimiento' : 'movimientos'} sin leer`
        : pesos(total)
    },
    nota: 'En la pestaña «En qué se ha gastado» cada categoría se abre y muestra sus pagos uno por uno.',
    vacio: 'Todavía no hay gastos de obra registrados.'
  };
}

function detalleCaja(vista) {
  const c = construirVistaCaja(vista?.caja);
  const movimientos = c.movimientos;

  return {
    titulo: 'El movimiento de la caja',
    columnas: [{ etiqueta: 'Movimiento' }, { etiqueta: 'Valor', numerica: true }],
    filas: movimientos.map(m => ({
      celdas: [m.concepto || RAYA, m.valorTexto],
      // La fila cuyo signo contradice a su tipo ya viene marcada de
      // `construirVistaCaja`. Acá se hereda esa marca en vez de recalcularla.
      alerta: m.contradice
    })),
    pie: c.saldo ? { etiqueta: c.saldo.concepto || 'Saldo', valor: c.saldo.valorTexto } : null,
    nota: c.notas.map(n => n.texto).filter(Boolean).join(' · ') || null,
    vacio: 'Todavía no hay una cuenta de caja que mostrar.'
  };
}

/**
 * El listado que explica una de las seis cifras de arriba.
 *
 * @param clave       'vendido' | 'abonado' | 'porCobrar' | 'disponible' | 'obra' | 'caja'
 * @param vista       lo que devuelve `construirVistaTablero` (texto YA escapado)
 * @param inventario  el JSON de data/lotes.json
 *
 * Devuelve null si la clave no es ninguna de las seis: una cifra sin listado se
 * dibuja como caja quieta y no llega hasta acá, pero la puerta se cierra igual.
 */
export function construirDetalleCifra(clave, vista, inventario) {
  switch (clave) {
    case 'vendido': validarInventario(inventario); return detalleVendido(vista, inventario);
    case 'abonado': return detalleAbonado(vista);
    case 'porCobrar': return detallePorCobrar(vista);
    case 'disponible': validarInventario(inventario); return detalleDisponible(vista, inventario);
    case 'obra': return detalleObra(vista);
    case 'caja': return detalleCaja(vista);
    default: return null;
  }
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
  // La fecha de la promesa de compraventa: «en cuánto lo compró», que fue una de
  // las dos cosas que se pidieron de la ficha. Sale de la columna J del espejo.
  // Va condicionada porque el lote 2 es en especie y no tiene promesa, y porque
  // una hoja recién montada puede no traerla todavía.
  if (c.promesa) filas.push({ etiqueta: 'Promesa', valor: c.promesa });
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

// ---- los totales por grupo del plano ------------------------------------

// A qué grupo de los tres botones pertenece cada estado del plano.
//
// «especie» va con los VENDIDOS y no con los que siguen sin vender: ese lote ya
// tiene dueño, y así lo cuenta también la vitrina pública, que separa por
// `estado !== 'disponible'` (`resumenInventario` en assets/js/inventario.js). Si
// acá se agrupara distinto, el tablero y la página de venta estarían diciendo
// dos cosas sobre el mismo lote. Lo que un lote en especie NO hace es aportar
// plata: de eso se encarga `sumarPlataDeLotes`, que lo deja por fuera de las
// tres cifras de dinero sin marcar el total como incompleto.
//
// Estos tres estados son los únicos que `validarInventario` deja pasar, así que
// ningún lote se queda sin grupo.
const GRUPO_DE_ESTADO = {
  vendido: 'vendidos',
  especie: 'vendidos',
  disponible: 'sinVender'
};

// «Colocados» y no «Vendidos» porque el grupo incluye el lote 2, que no se
// vendió: se entregó como pago en especie. Decisión del dueño el 1-sep-2026.
const ETIQUETA_GRUPO = {
  todos: 'Todos',
  vendidos: 'Colocados',
  sinVender: 'Sin vender'
};

const areaDe = (lotes) => lotes.reduce((t, l) => t + l.area, 0);

// Suma una columna de plata de la cartera sobre los lotes de un grupo.
//
// Separa dos cosas que se parecen y no son lo mismo:
//   - el lote en especie no aporta y NO deja el total corto. Por él nunca entró
//     un peso y eso ya se sabe; contarlo como dato faltante sería marcar de
//     incompleta, para siempre, una cifra que está completa.
//   - el lote que el plano da por vendido y del que la cartera no trae fila SÍ
//     deja el total corto. Ahí falta plata de verdad, y la marca viaja PEGADA a
//     la cifra para que ninguna plantilla pueda mostrar el número sin mostrar
//     que le falta algo.
//
// Sin ninguna cifra legible no hay $0 que enseñar —eso diría que no se ha
// vendido nada— sino raya.
function sumarPlataDeLotes(lotes, porLote, campo) {
  let total = 0;
  let legibles = 0;
  let sinCifra = 0;

  for (const l of lotes) {
    if (l.estado === 'especie') continue;
    const v = porLote.get(l.n)?.[campo];
    if (typeof v === 'number' && Number.isFinite(v)) {
      total += v;
      legibles++;
    } else {
      sinCifra++;
    }
  }

  const cifra = pesos(total);
  return {
    total: legibles === 0 ? null : total,
    sinCifra,
    incompleto: sinCifra > 0,
    texto: legibles === 0
      ? '—'
      : (sinCifra > 0
        ? `${cifra} + ${sinCifra} ${sinCifra === 1 ? 'lote' : 'lotes'} sin cifras`
        : cifra)
  };
}

// Las dos cifras que todo grupo puede dar sin depender de la hoja: cuántos
// lotes son y cuántos metros suman. Salen de data/lotes.json, que ya pasó por
// `validarInventario`, así que nunca están incompletas.
function cifrasDeConteo(lotes) {
  return [
    { etiqueta: 'Lotes', texto: String(lotes.length), incompleto: false },
    { etiqueta: 'Área', texto: metros(areaDe(lotes)), incompleto: false }
  ];
}

function baseDeGrupo(clave, lotes) {
  return {
    clave,
    etiqueta: ETIQUETA_GRUPO[clave],
    lotes: lotes.map(l => l.n),
    conteo: lotes.length,
    areaTotal: areaDe(lotes)
  };
}

// «Todos» es el estado de siempre: no apaga ningún lote y no resume nada. Un
// total que mezclara lo vendido con lo que está a la venta no significaría
// nada — son plata cobrada y plata por vender.
function grupoTodos(lotes) {
  return { ...baseDeGrupo('todos', lotes), muestraResumen: false, cifras: [], nota: null };
}

function grupoVendidos(lotes, porLote) {
  const base = { ...baseDeGrupo('vendidos', lotes), muestraResumen: true };

  if (lotes.length === 0) {
    return { ...base, cifras: [], nota: 'Todavía no hay ningún lote vendido.' };
  }

  const enEspecie = lotes.filter(l => l.estado === 'especie').length;
  const plata = (etiqueta, campo) => {
    const s = sumarPlataDeLotes(lotes, porLote, campo);
    return { etiqueta, texto: s.texto, incompleto: s.incompleto };
  };

  return {
    ...base,
    cifras: [
      ...cifrasDeConteo(lotes),
      plata('Valor total', 'precio'),
      plata('Abonado', 'abonado'),
      plata('Saldo por cobrar', 'saldo')
    ],
    // El lote en especie tiene que explicarse solo: cuenta entre los vendidos
    // pero no aparece en ninguna de las tres cifras de plata, y sin esta línea
    // eso se lee como una resta que no cuadra.
    nota: enEspecie === 0
      ? null
      : (enEspecie === 1
        ? 'Incluye 1 lote entregado como pago en especie: cuenta en los lotes y en el área, pero por él no entró dinero.'
        : `Incluye ${enEspecie} lotes entregados como pago en especie: cuentan en los lotes y en el área, pero por ellos no entró dinero.`)
  };
}

// Lo que falta por vender, a precio de lista: área por el valor del metro. No
// depende de la hoja de Google, así que nunca queda incompleto — y es el mismo
// cálculo con el que la vitrina pública anuncia cada lote.
function grupoSinVender(lotes, precioM2) {
  const base = { ...baseDeGrupo('sinVender', lotes), muestraResumen: true };

  if (lotes.length === 0) {
    return { ...base, cifras: [], nota: 'No queda ningún lote sin vender.' };
  }

  return {
    ...base,
    cifras: [
      ...cifrasDeConteo(lotes),
      { etiqueta: 'Valor de lista', texto: pesos(areaDe(lotes) * precioM2), incompleto: false }
    ],
    nota: `A precio de lista: el área de cada lote por ${pesos(precioM2)} el metro. Es el mismo cálculo de la vitrina pública.`
  };
}

/**
 * Los tres grupos del filtro de la pestaña «Los lotes», en el orden de los
 * botones: todos, vendidos, sin vender.
 *
 * @param vista       lo que devuelve `construirVistaTablero` (texto YA escapado)
 * @param inventario  el JSON de data/lotes.json
 *
 * Cada grupo trae los números de sus lotes —con eso el plano apaga los demás—,
 * su resumen ya formateado y una nota cuando hay algo que explicar. Ni un solo
 * texto de la hoja de Google entra a lo que sale de acá: las etiquetas son
 * literales de este archivo y las cifras salen de números, no de celdas.
 *
 * Los lotes se agrupan por el ESTADO del plano, no por tener fila en la
 * cartera. Es a propósito: el plano es la única fuente que ve el socio, y un
 * lote vendido cuya fila todavía no llegó tiene que contarse igual —con su
 * área— y dejar marcadas de incompletas las cifras de plata, en vez de
 * desaparecer del conteo.
 */
export function construirTotalesLotes(vista, inventario) {
  validarInventario(inventario);

  const porLote = new Map((vista?.cartera ?? []).map(c => [c.lote, c]));
  const lotes = [...inventario.lotes].sort((a, b) => a.n - b.n);
  const del = (clave) => lotes.filter(l => GRUPO_DE_ESTADO[l.estado] === clave);

  return [
    grupoTodos(lotes),
    grupoVendidos(del('vendidos'), porLote),
    grupoSinVender(del('sinVender'), inventario.precioM2)
  ];
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

// ---- la caja ------------------------------------------------------------
//
// La pestaña es una cuenta, no una tabla: empieza en un saldo, le suma y le
// resta cosas, corta en un subtotal y termina en un resultado. Se lee de arriba
// abajo y en el orden de la hoja, que es el orden en que la cuenta se explica.
//
// El contrato con la hoja es la columna TIPO. Los conceptos y las cifras
// cambian cada vez que el dueño edita su libro; el papel que juega cada fila,
// no. Por eso ni un solo texto de la hoja decide acá cómo se pinta algo.

// Los tipos que esta pestaña sabe pintar. Cualquier otro —uno que el dueño
// invente mañana, una celda con un espacio de más que ya vino en minúsculas
// desde el worker— cae en 'otro': la fila se muestra igual, con su concepto y
// su cifra, sin signo forzado y sin realce. Una pestaña que se cae porque
// apareció un tipo nuevo es peor que una que muestra una fila de más.
//
// `apertura` es el saldo con el que ARRANCA la cuenta, y es distinto de
// `subtotal`, que es un corte en el medio. Se ven igual en pantalla, pero solo
// la apertura sirve para comprobar que las entradas y las salidas dan el saldo
// final — y la hoja llegó a usar `subtotal` para las dos cosas.
const TIPOS_CAJA = new Set(['saldo', 'apertura', 'suma', 'resta', 'subtotal', 'brecha', 'nota']);

// El tipo sale a un atributo `data-` del HTML. Por eso se traduce a este
// vocabulario cerrado antes de salir: lo que llega de la hoja nunca entra a un
// atributo, ni escapado.
const tipoDeFila = (t) => (TIPOS_CAJA.has(t) ? t : 'otro');

// Las filas que se leen por el SIGNO antes que por la cifra. En una suma y en
// una resta el signo es el dato —qué entra y qué sale—, y en la brecha dice si
// falta o si sobra. `pesos` sola devolvería «$-411.847.440», con el menos
// escondido detrás del signo de pesos.
const SIGNO_EXPLICITO = new Set(['suma', 'resta', 'brecha']);

// Una cifra en null es raya, nunca $0: un valor que no se pudo leer no puede
// verse como una fila que vale cero. Un cero de verdad sí sale como «$0».
function cifraDeCaja(tipo, valor) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—';
  return SIGNO_EXPLICITO.has(tipo) || valor < 0 ? pesosConSigno(valor) : pesos(valor);
}

// Qué significa el número con el que cierra la cuenta. Sale del signo, no de la
// hoja: el concepto de la fila ya lo nombra («Brecha de diciembre») y esto
// contesta la única pregunta que queda.
function sentidoDeBrecha(valor) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  if (valor < 0) return 'Es lo que falta para cerrar la cuenta.';
  if (valor > 0) return 'Es lo que sobra después de cerrar la cuenta.';
  return 'La cuenta cierra exacta.';
}

/**
 * Arma la pestaña «La caja» a partir de las filas que trae la hoja.
 *
 * @param caja lo que trae `construirVistaTablero().caja` (texto YA escapado)
 *
 * Devuelve la cuenta repartida en sus cuatro papeles —el saldo de arriba, los
 * movimientos del medio, la brecha del final y las notas del pie— más lo que
 * haya que revisar. Las filas conservan el orden de la hoja.
 *
 * Los textos de `avisos` mezclan literales de este archivo con el concepto de
 * la fila, que YA viene escapado de `construirVistaTablero`. No se vuelven a
 * escapar aguas abajo: hacerlo mostraría «&amp;lt;img» en pantalla.
 */
export function construirVistaCaja(caja) {
  const filas = (caja ?? []).map((f, i) => {
    const tipo = tipoDeFila(f.tipo);
    const valor = typeof f.valor === 'number' && Number.isFinite(f.valor) ? f.valor : null;
    return {
      indice: i,
      concepto: f.concepto ?? '',
      tipo,
      valor,
      texto: f.texto ?? '',
      valorTexto: cifraDeCaja(tipo, valor),
      // Lo pone el recorrido de abajo cuando el signo contradice al tipo.
      contradice: false
    };
  });

  const notas = filas.filter(f => f.tipo === 'nota');
  const cuenta = filas.filter(f => f.tipo !== 'nota');
  // La primera de cada una. Si la hoja trae dos saldos o dos brechas, la
  // repetida se queda en el medio como una fila más en vez de desaparecer: no
  // se sabe cuál de las dos es la buena, y esconder una cifra de plata es peor
  // que mostrarla fuera de su sitio.
  const saldo = cuenta.find(f => f.tipo === 'saldo') ?? null;
  const brecha = cuenta.find(f => f.tipo === 'brecha') ?? null;
  const movimientos = cuenta.filter(f => f !== saldo && f !== brecha);

  const avisos = [];

  // El signo lo trae la hoja y el tipo dice cuál debería ser. Cuando se
  // contradicen no se corrige ninguno de los dos —enderezar un signo en
  // silencio es inventar plata—: se muestra lo que dice la hoja y se avisa.
  //
  // La fila queda marcada además con `contradice`, y con eso la vista le quita
  // el color: una fila en verde de «entra plata» con la cifra en negativo se
  // lee al revés de lo que dice, y el aviso está tres renglones más abajo.
  for (const f of movimientos) {
    if (f.valor === null || f.valor === 0) continue;
    if (f.tipo === 'suma' && f.valor < 0) {
      f.contradice = true;
      avisos.push(`«${f.concepto}» está marcada como suma y su valor llega en negativo. Revisá la hoja.`);
    }
    if (f.tipo === 'resta' && f.valor > 0) {
      f.contradice = true;
      avisos.push(`«${f.concepto}» está marcada como resta y su valor llega en positivo. Revisá la hoja.`);
    }
  }

  // La comprobación de la cuenta: la brecha tiene que ser el saldo más todas
  // las sumas y las restas. Es la cifra que un socio se va a llevar de acá, y
  // si la hoja se desincroniza —una fila nueva que nadie sumó, un total viejo
  // pegado a mano— no puede pasar callada.
  //
  // Solo se comprueba cuando se PUEDE: hace falta el saldo, la brecha, que
  // ninguna cifra del camino esté ilegible, que no haya filas de tipo
  // desconocido —de las que por definición no se sabe si entran a la cuenta— y
  // que el saldo y la brecha no vengan repetidos, porque ahí tampoco se sabe
  // cuál de los dos entra. Sin eso queda en null —«no se pudo comprobar»—, que
  // no es lo mismo que «no cuadra»: acusar a la hoja de descuadre cuando el
  // que no entiende la cuenta es este archivo la volvería un aviso que nadie
  // vuelve a mirar.
  const sumables = cuenta.filter(f => f.tipo === 'suma' || f.tipo === 'resta');
  const puedeComprobar = saldo !== null && brecha !== null &&
    !cuenta.some(f => f.tipo === 'otro') &&
    !movimientos.some(f => f.tipo === 'saldo' || f.tipo === 'brecha') &&
    saldo.valor !== null && brecha.valor !== null &&
    !sumables.some(f => f.valor === null);
  // Se redondea al peso antes de comparar, por lo mismo que en la tabla de
  // socios: la coma flotante deja ruido de fracciones de peso.
  const calculada = puedeComprobar
    ? Math.round(sumables.reduce((t, f) => t + f.valor, saldo.valor))
    : null;
  const cuadra = puedeComprobar ? calculada === Math.round(brecha.valor) : null;

  if (cuadra === false) {
    avisos.push(
      `La cuenta no cuadra: el saldo con las sumas y las restas da ${pesosConSigno(calculada)} ` +
      `y la hoja cierra en ${brecha.valorTexto}. Revisá la hoja.`
    );
  }

  // La OTRA comprobación, y la única que aplica desde que la brecha salió del
  // tablero (decisión del 31-ago-2026): el saldo de apertura más las entradas y
  // las salidas tiene que dar el saldo con el que cierra la cuenta.
  //
  // La de arriba no la reemplaza: comprueba una ecuación distinta —saldo +
  // movimientos = brecha— y quedó dormida al quitar la fila de brecha. Sin esta,
  // la cifra más mirada del tablero pasó a no tener ninguna comprobación.
  //
  // Hace falta porque la pestaña «Tablero Caja» de la hoja se arma FILA POR FILA
  // A MANO contra la hoja CAJA. Un movimiento que entra a CAJA y no se copia allá
  // le deja al socio un saldo que sus propios movimientos no explican, sin que
  // nada avise. Pasó el 1-sep-2026 al registrar la seguridad social.
  //
  // La apertura se pide por su propio TIPO y no se deduce de `subtotal` ni de
  // la posición: `subtotal` también rotula los cortes del medio —«Disponible
  // estimado a diciembre» era uno—, y sumarle las entradas y las salidas de
  // toda la cuenta a un corte intermedio da un número que no es nada, y un
  // aviso de descuadre falso. Un aviso que grita sin razón es peor que no
  // tenerlo: enseña a ignorarlo.
  //
  // Mismo criterio de prudencia que arriba: si falta la apertura, si viene
  // repetida, si hay un tipo desconocido o si alguna cifra está ilegible, queda
  // en null —«no se pudo comprobar»—, que no es «no cuadra».
  const apertura = cuenta.find(f => f.tipo === 'apertura') ?? null;
  const unaSola = (t) => cuenta.filter(f => f.tipo === t).length === 1;
  const puedeCuadrarSaldo = saldo !== null && apertura !== null &&
    !cuenta.some(f => f.tipo === 'otro') &&
    unaSola('saldo') && unaSola('apertura') &&
    saldo.valor !== null && apertura.valor !== null &&
    !sumables.some(f => f.valor === null);
  const saldoCalculado = puedeCuadrarSaldo
    ? Math.round(sumables.reduce((t, f) => t + f.valor, apertura.valor))
    : null;
  const cuadraSaldo = puedeCuadrarSaldo
    ? saldoCalculado === Math.round(saldo.valor)
    : null;

  if (cuadraSaldo === false) {
    avisos.push(
      `La caja no cuadra: «${apertura.concepto}» con las entradas y las salidas de abajo da ` +
      `${cifraDeCaja('saldo', saldoCalculado)}, y arriba dice ${saldo.valorTexto}. ` +
      'Suele ser un movimiento que entró a la hoja CAJA y no se copió a «Tablero Caja». Revisá la hoja.'
    );
  }

  return {
    hay: filas.length > 0,
    saldo,
    movimientos,
    brecha,
    brechaSentido: brecha ? sentidoDeBrecha(brecha.valor) : null,
    notas,
    cuadra,
    calculada,
    calculadaTexto: calculada === null ? '—' : pesosConSigno(calculada),
    cuadraSaldo,
    saldoCalculado,
    saldoCalculadoTexto: saldoCalculado === null ? '—' : cifraDeCaja('saldo', saldoCalculado),
    avisos
  };
}

// ---- la tabla de socios -------------------------------------------------

// Un total de columna sobre celdas que pudieron no leerse.
//
// Mismo trato que el total de una categoría de gastos: la marca viaja PEGADA a
// la cifra, así ninguna plantilla puede mostrar el número sin mostrar que está
// incompleto. Sin ninguna celda legible no hay $0 que enseñar —eso diría que
// nadie puso nada— sino raya.
function sumarColumna(valores) {
  const legibles = valores.filter(v => typeof v === 'number' && Number.isFinite(v));
  const sinLeer = valores.length - legibles.length;
  const total = legibles.reduce((t, v) => t + v, 0);
  const cifra = pesos(total);
  return {
    total: legibles.length === 0 ? null : total,
    sinLeer,
    incompleto: sinLeer > 0,
    texto: legibles.length === 0
      ? '—'
      : (sinLeer > 0 ? `${cifra} + ${sinLeer} ${sinLeer === 1 ? 'socio' : 'socios'} sin leer` : cifra)
  };
}

// Los tres estados de una diferencia, en un solo lugar para que la tabla y su
// pie no puedan discrepar. El valor sale a un atributo `data-` del HTML, así
// que es de este vocabulario cerrado y nunca de la hoja.
function estadoDiferencia(diferencia) {
  if (diferencia === null) return 'sin-dato';
  if (diferencia === 0) return 'exacto';
  return diferencia > 0 ? 'de-mas' : 'de-menos';
}

// De mayor a menor aporte. El socio cuyo total no se pudo leer se va al final:
// no se puede comparar contra nadie, y ponerlo arriba o abajo por accidente le
// inventaría un lugar en el orden.
function porAporte(a, b) {
  const ha = typeof a.total === 'number';
  const hb = typeof b.total === 'number';
  if (ha && hb) return b.total - a.total;
  if (ha) return -1;
  if (hb) return 1;
  return 0;
}

/**
 * Arma la tabla de socios: quién puso cuánto por la tierra y, al lado, cuánto
 * se aparta de lo que le correspondía por su participación.
 *
 * @param socios lo que trae `construirVistaTablero().socios` (texto YA escapado)
 *
 * La diferencia es el punto de la pestaña: `total - participación × total de la
 * tierra`. Con signo, para que se lea de un vistazo quién puso de más y quién
 * de menos sin tener que calcular nada.
 *
 * Y tiene TRES estados, no dos:
 *   - un número (positivo o negativo) -> se muestra con su signo y su color.
 *   - cero de verdad -> «$0» en gris. Ese socio está exacto.
 *   - no se pudo calcular -> raya. Es distinto de cero y no puede parecerse:
 *     decirle «$0» a un socio es afirmarle que está a paz y salvo.
 *
 * El tercer caso incluye algo que no es evidente: si el total de UN socio no se
 * pudo leer, el total de la tierra queda corto, y entonces la parte que le
 * corresponde a CADA UNO sale mal. Con la base dañada no se calcula ninguna
 * diferencia — una cifra sobre una base equivocada es una afirmación falsa
 * sobre la plata de un socio, y esas no se imprimen.
 */
export function construirVistaSocios(socios) {
  const filas = socios ?? [];

  if (filas.length === 0) {
    return {
      socios: [], etiquetasPagos: [], totalesPagos: [],
      total: null, totalTexto: '—', incompleto: false, sinLeer: 0,
      participacionTotal: null, participacionTotalTexto: '—', participacionCuadra: true,
      diferenciaTotal: null, diferenciaTotalTexto: '—', diferenciaTotalEstado: 'sin-dato',
      baseConfiable: false
    };
  }

  // Los rótulos de las cuatro rondas los pone la hoja en su encabezado y el
  // worker se los cuelga a cada socio. Se toman de la primera fila que los
  // traiga: son los mismos para todos.
  const etiquetasPagos = (filas.find(s => s.pagos?.length)?.pagos ?? []).map(p => p.etiqueta);

  const general = sumarColumna(filas.map(s => s.total));
  const totalesPagos = etiquetasPagos.map((_, j) =>
    sumarColumna(filas.map(s => s.pagos?.[j]?.valor))
  );

  const participaciones = filas
    .map(s => s.participacion)
    .filter(p => typeof p === 'number' && Number.isFinite(p));
  const participacionTotal = participaciones.length === filas.length
    ? participaciones.reduce((t, p) => t + p, 0)
    : null;

  // La base sirve solo si están los seis totales. `general.total` en null es el
  // caso extremo (ninguno legible) y también queda por fuera.
  const baseConfiable = !general.incompleto && typeof general.total === 'number';

  const conDiferencia = [...filas].sort(porAporte).map(s => {
    const puedeCalcular = baseConfiable &&
      typeof s.participacion === 'number' && typeof s.total === 'number';
    // Se redondea al peso antes de comparar: 0,33 × 3.600.000.000 deja ruido
    // de coma flotante y sin redondear un socio exacto salía con una
    // diferencia de fracciones de peso, que en pantalla se ve como $0 pero
    // pinta del color de «puso de más».
    const esperado = puedeCalcular ? Math.round(s.participacion * general.total) : null;
    const diferencia = puedeCalcular ? Math.round(s.total - s.participacion * general.total) : null;
    return {
      ...s,
      esperado,
      esperadoTexto: esperado === null ? '—' : pesos(esperado),
      diferencia,
      diferenciaTexto: diferencia === null ? '—' : pesosConSigno(diferencia),
      diferenciaEstado: estadoDiferencia(diferencia)
    };
  });

  // La suma de las diferencias. Con las participaciones cuadradas en 100 % da
  // cero, y ese cero es la comprobación de que la columna está bien calculada.
  // Si NO da cero, lo que está mal es el reparto de la hoja, y la fila del pie
  // es donde se ve. Basta con que una diferencia no se haya podido calcular
  // para que el pie no pueda afirmar nada: ahí va raya.
  const faltaAlguna = conDiferencia.some(s => s.diferencia === null);
  const diferenciaTotal = faltaAlguna
    ? null
    : conDiferencia.reduce((t, s) => t + s.diferencia, 0);

  return {
    socios: conDiferencia,
    diferenciaTotal,
    diferenciaTotalTexto: diferenciaTotal === null ? '—' : pesosConSigno(diferenciaTotal),
    diferenciaTotalEstado: estadoDiferencia(diferenciaTotal),
    etiquetasPagos,
    totalesPagos,
    total: general.total,
    totalTexto: general.texto,
    incompleto: general.incompleto,
    sinLeer: general.sinLeer,
    participacionTotal,
    participacionTotalTexto: participacionTotal === null ? '—' : porcentaje(participacionTotal),
    // Las participaciones tienen que sumar el 100 %. Si no suman, la parte que
    // le toca a cada uno está mal repartida en la hoja y hay que ir a mirarla.
    // Se compara con holgura de un peso sobre el total para no pelear con la
    // coma flotante.
    participacionCuadra: participacionTotal !== null &&
      Math.abs(participacionTotal - 1) < 1e-9,
    baseConfiable
  };
}
