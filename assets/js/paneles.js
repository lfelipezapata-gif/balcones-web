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
