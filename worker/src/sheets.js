import { SignJWT, importPKCS8 } from 'jose';

const ALCANCE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';
// Clave interna -> nombre real de la pestaña en la hoja.
//
// Todas viven DENTRO del libro de control financiero, no en un archivo
// aparte, y por eso llevan el prefijo «Tablero»: el libro ya tiene RESUMEN y
// EGRESOS propios, y Sheets no admite dos pestañas con el mismo nombre.
//
// Empezaron en un archivo espejo separado, alimentado con IMPORTRANGE. Se
// movieron acá porque IMPORTRANGE exige que una persona autorice la conexión
// desde la interfaz —no se puede por API— y esa autorización se vuelve a pedir
// cada vez que algo cambia de sitio. Un tablero que depende de un clic manual
// para no quedarse en blanco es un punto de falla que no vale la pena.
//
// El número de pestañas no está escrito en ninguna otra parte del archivo: la
// lista es la única fuente. `leerEspejo` pide tantos rangos como filas tenga y
// exige que lleguen todos, y `normalizarTablero` avisa por cada una que llegue
// vacía. Agregar una pestaña nueva es agregar una fila acá.
const PESTANAS = [
  ['Resumen', 'Tablero Resumen'],
  ['Cartera', 'Tablero Cartera'],
  ['Abonos', 'Tablero Abonos'],
  ['Egresos', 'Tablero Egresos'],
  ['Socios', 'Tablero Socios'],
  ['Caja', 'Tablero Caja']
];

export async function tokenDeAcceso(credenciales, { fetchImpl = fetch, ahora = new Date() } = {}) {
  const llave = await importPKCS8(credenciales.private_key, 'RS256');
  const segundos = Math.floor(ahora.getTime() / 1000);
  const afirmacion = await new SignJWT({ scope: ALCANCE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(credenciales.client_email)
    .setAudience(URL_TOKEN)
    .setIssuedAt(segundos)
    .setExpirationTime(segundos + 3600)
    .sign(llave);

  const r = await fetchImpl(URL_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: afirmacion
    }).toString()
  });
  if (!r.ok) {
    throw new Error(`La cuenta de servicio no pudo autenticarse (${r.status}).`);
  }
  // Google puede responder 200 con un cuerpo de error (por ejemplo invalid_grant).
  // Sin este chequeo salía `undefined`, después viajaba como «Bearer undefined» y el
  // usuario terminaba viendo «No se pudo leer la hoja (401)»: culpaba a la hoja
  // cuando el problema son las credenciales.
  const { access_token: tokenAcceso } = await r.json();
  if (typeof tokenAcceso !== 'string' || tokenAcceso === '') {
    throw new Error('La cuenta de servicio no pudo autenticarse: la respuesta llegó sin token de acceso.');
  }
  return tokenAcceso;
}

export async function leerEspejo({ fetchImpl = fetch, idHoja, tokenAcceso }) {
  const rangos = PESTANAS.map(([, real]) => `ranges=${encodeURIComponent(`'${real}'`)}`).join('&');
  // UNFORMATTED_VALUE: Sheets devuelve números de JSON en vez del texto ya formateado.
  // Sin esto, una hoja en locale en_US mandaba "1,234.56" y había que adivinar el formato,
  // que es de donde salían los números equivocados y callados.
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(idHoja)}` +
    `/values:batchGet?${rangos}&valueRenderOption=UNFORMATTED_VALUE`;
  const r = await fetchImpl(url, { headers: { authorization: `Bearer ${tokenAcceso}` } });
  if (!r.ok) {
    throw new Error(`No se pudo leer la hoja (${r.status}).`);
  }
  const { valueRanges = [] } = await r.json();
  // Una respuesta corta no se rellena con []. Rellenar volvía una lectura parcial
  // indistinguible de una hoja vacía, y aguas abajo cualquier suma daba 0.
  if (valueRanges.length !== PESTANAS.length) {
    throw new Error(
      `La hoja llegó incompleta: se pidieron ${PESTANAS.length} pestañas y llegaron ${valueRanges.length}.`
    );
  }
  const crudo = {};
  PESTANAS.forEach(([clave, real], i) => {
    if (!valueRanges[i]) {
      throw new Error(`La hoja llegó incompleta: no vino el rango de la pestaña ${real}.`);
    }
    crudo[clave] = valueRanges[i].values ?? [];
  });
  return crudo;
}

// Formas de número que se aceptan como texto. Todo lo demás devuelve null y genera aviso.
const ENTERO = /^\d+$/;                              // 1500000000
const MILES = /^\d{1,3}(?:\.\d{3}){2,}$/;            // 1.234.567.890  (dos grupos o más)
const MILES_CON_DECIMAL = /^\d{1,3}(?:\.\d{3})+,\d+$/; // 1.234.567,89
const DECIMAL_COMA = /^\d+,\d+$/;                    // 1234,56
const COMA_AMBIGUA = /^\d{1,3},\d{3}$/;              // 1,234 -> 1234 en en-US, 1,234 en es-CO

/**
 * Convierte a número lo que llega de la hoja.
 *
 * Con `valueRenderOption=UNFORMATTED_VALUE` los números llegan como números de JSON y
 * esta función casi no tiene que hacer nada. El manejo de texto es el cinturón, para
 * cuando alguien pega un valor a mano o alguien cambia el renderizado.
 *
 * ACEPTA
 *   número de JavaScript finito, tal cual:  1234 · 1234.56 · -3000 · 0
 *   "1500000000"       entero pelado
 *   "1.833.480.000"    miles es-CO, dos grupos de tres o más
 *   "$ 1.234.567,89"   miles es-CO con decimales por coma
 *   "1234,56"          decimales por coma sin separador de miles
 *   "-1.234.567"       cualquiera de las anteriores en negativo
 *   Se ignoran los espacios alrededor y un "$" al frente.
 *
 * DEVUELVE null — y entonces el llamador emite aviso — ante todo lo demás. En particular
 * ante lo AMBIGUO, que antes se adivinaba mal y en silencio:
 *   "1.5"       15 si el punto es de miles, 1,5 si es decimal. No se adivina.
 *   "1.833"     mismo caso.
 *   "1,234"     1234 en en-US, 1,234 en es-CO.
 *   "1,234.56"  formato en-US: la hoja quedó en otro locale y hay que arreglar la hoja.
 * Y ante lo que `Number()` acepta de más:
 *   "0x10" · "1e5" · "+1000" · "1 234" · "(1.000)" · [42] · true
 * Un cero de verdad sigue siendo 0, distinto de null. Esa distinción no se toca.
 */
export function aNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;

  let t = valor.trim();
  if (t.startsWith('$')) t = t.slice(1).trim();
  let signo = 1;
  if (t.startsWith('-')) { signo = -1; t = t.slice(1).trim(); }
  if (t === '') return null;

  if (ENTERO.test(t)) return signo * Number(t);
  if (MILES.test(t)) return signo * Number(t.replace(/\./g, ''));
  if (MILES_CON_DECIMAL.test(t)) return signo * Number(t.replace(/\./g, '').replace(',', '.'));
  if (DECIMAL_COMA.test(t) && !COMA_AMBIGUA.test(t)) return signo * Number(t.replace(',', '.'));
  return null;
}

// Sheets cuenta las fechas como días desde el 30 de diciembre de 1899.
const EPOCA_SHEETS = Date.UTC(1899, 11, 30);
const DIA = 86400000;

/**
 * Deja una fecha en `dd/mm/aaaa`, venga como venga de la hoja.
 *
 * Con `valueRenderOption=UNFORMATTED_VALUE` —que es lo que pedimos, y con razón,
 * porque es lo que evita adivinar formatos de número— una celda de fecha no llega
 * como «19/08/2026» sino como **46253**, su número serial. Sin esta conversión la
 * ficha del lote mostraba ese número crudo al socio.
 *
 * Si la celda trae texto se devuelve tal cual: puede que alguien la haya escrito a
 * mano, y ahí el texto es más confiable que cualquier interpretación nuestra.
 */
export function fechaLegible(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    // Serial 1 es el 31-dic-1899. Por debajo de eso no es una fecha, es un número
    // que cayó en la columna equivocada: se devuelve como texto y se nota.
    if (valor < 1) return String(valor);
    const d = new Date(EPOCA_SHEETS + Math.round(valor) * DIA);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getUTCFullYear()}`;
  }
  return String(valor ?? '');
}

/**
 * El instante que representa una celda de fecha, para poder ORDENAR por ella.
 *
 * Existe aparte de `fechaLegible` porque son dos preguntas distintas: aquella
 * contesta «cómo se escribe esto» y esta «qué va antes». Ordenar por el texto
 * que devuelve la otra está mal y no se nota hasta que cambia el mes:
 * «05/09/2026» va antes que «19/08/2026» en orden alfabético y después en el
 * calendario.
 *
 * Entiende las tres formas en que puede llegar la celda: el número serial de
 * Sheets —que es lo normal con `UNFORMATTED_VALUE`—, «dd/mm/aaaa» y
 * «aaaa-mm-dd», que es lo que aparece cuando alguien la escribió a mano como
 * texto. Todas salen en la misma escala (milisegundos UTC) para que se puedan
 * comparar entre sí: mezclar seriales con años en la misma comparación daría
 * un orden inventado.
 *
 * Devuelve null cuando no hay fecha que ordenar —la celda vacía de un abono
 * «Sin desglose», por ejemplo—. Esas filas van al final.
 */
export function instanteDeFecha(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    if (valor < 1) return null;
    return EPOCA_SHEETS + Math.round(valor) * DIA;
  }
  const t = String(valor ?? '').trim();
  const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (barras) return Date.UTC(Number(barras[3]), Number(barras[2]) - 1, Number(barras[1]));
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}

// Compara dos abonos por su fecha. Lo que no tiene fecha va al final: un abono
// sin fecha no es «el más viejo», es uno del que no se sabe cuándo entró.
function porFecha(a, b) {
  if (a.orden === null && b.orden === null) return 0;
  if (a.orden === null) return 1;
  if (b.orden === null) return -1;
  return a.orden - b.orden;
}

// Las seis filas que el Resumen tiene que traer. Si falta alguna, se avisa por su nombre.
const CONCEPTOS_RESUMEN = [
  ['Vendido', 'vendido'],
  ['Abonado', 'abonado'],
  ['Por cobrar', 'porCobrar'],
  ['Disponible', 'disponible'],
  ['Gastado en obra', 'gastadoObra'],
  ['Caja', 'caja']
];
const CLAVES_RESUMEN = Object.fromEntries(
  CONCEPTOS_RESUMEN.map(([etiqueta, campo]) => [etiqueta.toLowerCase(), campo])
);

// «Tablero Socios» tiene siete columnas: A el nombre, B la participación, de la
// C a la F los cuatro aportes con que se pagó la tierra, y G el total.
const COLUMNA_NOMBRE = 0;
const COLUMNA_PARTICIPACION = 1;
const COLUMNAS_APORTE = [2, 3, 4, 5];
const COLUMNA_TOTAL = 6;

// «Tablero Caja» tiene tres columnas: A el concepto, B el valor y C el tipo.
//
// El TIPO es el contrato de esa pestaña. Los conceptos y las cifras cambian
// cada vez que el dueño actualiza su libro —una cuota que entra, un
// compromiso que se paga—, y lo único estable es qué papel juega cada fila en
// la cuenta. Acá el tipo no se interpreta ni se valida contra una lista: se
// pasa tal cual, en minúsculas y sin espacios, y la vista decide cómo pintarlo.
// Un tipo que este archivo no conozca tiene que llegar igual al otro lado.
const COLUMNA_CONCEPTO_CAJA = 0;
const COLUMNA_VALOR_CAJA = 1;
const COLUMNA_TIPO_CAJA = 2;

// La única fila cuya columna B NO es plata: lleva texto —el número de la
// cuenta, una aclaración al pie—. Pasarla por `numero` la marcaría de
// ilegible, y ese aviso sería falso: nadie escribió mal un número, ahí nunca
// hubo uno.
const TIPO_NOTA = 'nota';

export function normalizarTablero(crudo, { ahora = new Date() } = {}) {
  const avisos = [];
  const cuerpo = (p) => (crudo[p] ?? []).slice(1);

  // `extra` deja colgarle al aviso lo que la vista necesite para ubicarlo — hoy,
  // la categoría del egreso descartado, para poder marcar ese total y no otro.
  const numero = (valor, pestana, fila, columna, extra = {}) => {
    const n = aNumero(valor);
    if (n === null) {
      avisos.push({ tipo: 'ilegible', pestana, fila, columna, valor: String(valor ?? ''), ...extra });
    }
    return n;
  };

  // «Vacía» es SIN FILAS DE DATOS, no sin filas. La forma real de «alguien borró
  // los datos» no es cero filas: es una, la del encabezado, que la API de Sheets
  // devuelve igual. Mirando `length === 0` ese caso no avisaba, index.js guardaba
  // esa lectura en caché y borraba la última lectura buena justo cuando más falta
  // hace. Se mide sobre el cuerpo, que ya descarta el encabezado.
  PESTANAS.forEach(([clave]) => {
    if (cuerpo(clave).length === 0) avisos.push({ tipo: 'pestana-vacia', pestana: clave });
  });

  const resumen = {
    vendido: null, abonado: null, porCobrar: null,
    disponible: null, gastadoObra: null, caja: null
  };
  const vistas = new Set();
  cuerpo('Resumen').forEach((f, i) => {
    const clave = CLAVES_RESUMEN[String(f[0] ?? '').trim().toLowerCase()];
    if (!clave) return;
    vistas.add(clave);
    resumen[clave] = numero(f[1], 'Resumen', i + 2, 'Valor');
  });
  // Si una fila falta o alguien la renombró, el campo no puede quedar en null callado.
  CONCEPTOS_RESUMEN.forEach(([etiqueta, campo]) => {
    if (!vistas.has(campo)) {
      avisos.push({ tipo: 'clave-faltante', pestana: 'Resumen', concepto: etiqueta });
    }
  });

  const abonosPorLote = new Map();
  cuerpo('Abonos').forEach((f, i) => {
    // El lote también avisa. Con `aNumero` pelado, un abono cuyo lote quedó en
    // «siete», «L-7» o «#REF!» desaparecía entero y sin rastro: el socio abría el
    // lote, le faltaba un pago, y el Abonado del Resumen dejaba de cuadrar con el
    // detalle sin nada en pantalla que lo explicara.
    const lote = numero(f[1], 'Abonos', i + 2, 'Lote');
    const valor = numero(f[2], 'Abonos', i + 2, 'Valor');
    if (lote === null || valor === null) return;
    if (!abonosPorLote.has(lote)) abonosPorLote.set(lote, []);
    // `orden` sale del valor CRUDO de la celda, antes de formatearlo, y es
    // interno: se usa para ordenar y no viaja al navegador.
    abonosPorLote.get(lote).push({
      orden: instanteDeFecha(f[0]),
      fecha: fechaLegible(f[0]),
      valor,
      medio: String(f[3] ?? '')
    });
  });

  const cartera = cuerpo('Cartera').map((f, i) => {
    const lote = aNumero(f[0]);
    if (lote === null) {
      avisos.push({ tipo: 'ilegible', pestana: 'Cartera', fila: i + 2, columna: 'Lote', valor: String(f[0] ?? '') });
      return null;
    }
    // La próxima cuota tiene TRES estados, no dos. Vacía es «no hay cuota
    // programada» y no es un error. Ilegible es un dato que no se pudo leer, y
    // con `aNumero` pelado se volvía null callado — indistinguible del vacío. La
    // vista lo traducía a «Sin cuota programada»: una afirmación de negocio falsa
    // y definitiva, peor que un número raro porque nadie va a ir a revisarla.
    const cuotaCruda = f[7];
    const cuotaVacia = cuotaCruda === undefined || cuotaCruda === null || String(cuotaCruda).trim() === '';
    const proximaCuotaValor = cuotaVacia ? null : numero(cuotaCruda, 'Cartera', i + 2, 'Próxima cuota');
    return {
      lote,
      area: aNumero(f[1]),
      comprador: String(f[2] ?? ''),
      precio: numero(f[3], 'Cartera', i + 2, 'Precio'),
      abonado: numero(f[4], 'Cartera', i + 2, 'Abonado'),
      saldo: numero(f[5], 'Cartera', i + 2, 'Saldo'),
      proximaCuotaFecha: String(f[6] ?? ''),
      proximaCuotaValor,
      proximaCuotaIlegible: !cuotaVacia && proximaCuotaValor === null,
      estado: String(f[8] ?? ''),
      // Columna J del espejo: la fecha de la promesa de compraventa.
      promesa: fechaLegible(f[9]),
      // Se copia antes de ordenar: `.sort()` ordena en sitio y dos filas con el mismo
      // lote recibían la MISMA instancia guardada en el Map, así que una mutaba a la otra.
      // El `orden` se quita al final: sirvió para ordenar y no es asunto del navegador.
      abonos: [...(abonosPorLote.get(lote) ?? [])]
        .sort(porFecha)
        .map(({ orden, ...abono }) => abono)
    };
  }).filter(Boolean);

  const egresos = cuerpo('Egresos').map((f, i) => {
    const categoria = String(f[1] ?? '').trim() === '' ? 'Sin categoría' : String(f[1]);
    // El aviso lleva la categoría de la fila descartada para que la vista pueda
    // marcar ESE total como incompleto, junto a la cifra. Un total sumado sobre
    // filas incompletas no puede verse igual que uno completo.
    const valor = numero(f[3], 'Egresos', i + 2, 'Valor', { categoria });
    if (valor === null) return null;
    return {
      fecha: fechaLegible(f[0]),
      categoria,
      concepto: String(f[2] ?? ''),
      valor
    };
  }).filter(Boolean);

  // --- los socios y lo que puso cada uno por la tierra ---------------------
  //
  // El rótulo de cada aporte sale del encabezado de la hoja, no de acá: cada
  // ronda tiene su propia fecha («Escritura dic-2024», «Compromiso jun-2025») y
  // una etiqueta quemada en el código quedaría rotulando plata de otro año la
  // próxima vez que entre una. Si el encabezado viene vacío se cae a un rótulo
  // genérico, que es feo pero no miente.
  const encabezadoSocios = (crudo.Socios ?? [])[0] ?? [];
  const rotuloAporte = (columna, i) => {
    const r = String(encabezadoSocios[columna] ?? '').trim();
    return r === '' ? `Aporte ${i + 1}` : r;
  };

  const socios = cuerpo('Socios').map((f, i) => {
    const fila = f ?? [];
    // Una fila enteramente en blanco no dice nada y no hay nada que revisar en
    // ella: seis avisos por un renglón que alguien dejó vacío en el medio de la
    // tabla serían ruido, no información.
    if (fila.every((c) => String(c ?? '').trim() === '')) return null;
    // A diferencia de un egreso, acá la fila NO se descarta cuando algo no se
    // puede leer: descartarla borra a un socio entero de la tabla, y el que
    // desaparece es justo el que tiene el dato raro. La celda ilegible queda en
    // null —que la vista pinta como raya, nunca como $0— y el aviso dice cuál
    // es. Todos los números pasan por `numero`, igual que en el resto del
    // archivo, para que ninguno se vuelva un cero callado.
    return {
      nombre: String(fila[COLUMNA_NOMBRE] ?? ''),
      participacion: numero(fila[COLUMNA_PARTICIPACION], 'Socios', i + 2, 'Participación'),
      pagos: COLUMNAS_APORTE.map((columna, j) => {
        const etiqueta = rotuloAporte(columna, j);
        return { etiqueta, valor: numero(fila[columna], 'Socios', i + 2, etiqueta) };
      }),
      total: numero(fila[COLUMNA_TOTAL], 'Socios', i + 2, 'Total aportado')
    };
  }).filter(Boolean);

  // --- la caja: en qué termina la cuenta -----------------------------------
  //
  // Cada fila es un renglón de una cuenta que empieza en un saldo, le suma y le
  // resta cosas y termina en un resultado. El orden de la hoja se respeta: es
  // el orden en que se lee la cuenta, y reordenarla acá sería reescribirla.
  //
  // Igual que en los socios, la fila NO se descarta cuando el valor no se puede
  // leer —descartarla borraría un renglón de la cuenta y el resultado dejaría de
  // explicarse solo—. La cifra queda en null, que la vista pinta como raya y
  // nunca como $0, y el aviso dice qué fila hay que ir a mirar.
  const caja = cuerpo('Caja').map((f, i) => {
    const fila = f ?? [];
    // Una fila enteramente en blanco es un renglón de aire entre bloques de la
    // cuenta, no un dato roto: no hay nada que revisar en ella.
    if (fila.every((c) => String(c ?? '').trim() === '')) return null;

    const concepto = String(fila[COLUMNA_CONCEPTO_CAJA] ?? '');
    const tipo = String(fila[COLUMNA_TIPO_CAJA] ?? '').trim().toLowerCase();
    const crudoValor = fila[COLUMNA_VALOR_CAJA];

    if (tipo === TIPO_NOTA) {
      return { concepto, valor: null, texto: String(crudoValor ?? ''), tipo };
    }
    return {
      concepto,
      valor: numero(crudoValor, 'Caja', i + 2, 'Valor'),
      texto: '',
      tipo
    };
  }).filter(Boolean);

  return { leidoEn: ahora.toISOString(), resumen, cartera, egresos, socios, caja, avisos };
}
