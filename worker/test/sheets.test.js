import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportPKCS8, decodeJwt } from 'jose';
import { tokenDeAcceso, leerEspejo, aNumero, normalizarTablero } from '../src/sheets.js';

const AHORA = new Date('2026-08-31T21:50:00.000Z');

test('aNumero entiende los formatos que manda Sheets', () => {
  assert.equal(aNumero('1833480000'), 1833480000);
  assert.equal(aNumero('$1.833.480.000'), 1833480000);
  assert.equal(aNumero('1.833.480.000'), 1833480000);
  assert.equal(aNumero(' 30000000 '), 30000000);
  assert.equal(aNumero(0), 0);
  assert.equal(aNumero(''), null);
  assert.equal(aNumero('pendiente'), null);
  assert.equal(aNumero('#REF!'), null);
  assert.equal(aNumero(undefined), null);
});

test('tokenDeAcceso firma un JWT correcto y pide el token', async () => {
  const { privateKey } = await generateKeyPair('RS256');
  const credenciales = {
    client_email: 'balcones@proyecto.cuenta-de-prueba.invalid',
    private_key: await exportPKCS8(privateKey)
  };
  let pedido;
  const fetchImpl = async (url, opciones) => {
    pedido = { url, cuerpo: new URLSearchParams(opciones.body) };
    return { ok: true, json: async () => ({ access_token: 'ya29.token' }) };
  };
  const t = await tokenDeAcceso(credenciales, { fetchImpl, ahora: AHORA });
  assert.equal(t, 'ya29.token');
  assert.equal(pedido.url, 'https://oauth2.googleapis.com/token');
  const afirmacion = decodeJwt(pedido.cuerpo.get('assertion'));
  assert.equal(afirmacion.iss, credenciales.client_email);
  assert.equal(afirmacion.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  assert.equal(afirmacion.aud, 'https://oauth2.googleapis.com/token');
});

test('tokenDeAcceso avisa si Google rechaza', async () => {
  const { privateKey } = await generateKeyPair('RS256');
  const credenciales = { client_email: 'x@y.cuenta-de-prueba.invalid', private_key: await exportPKCS8(privateKey) };
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'denegado' });
  await assert.rejects(() => tokenDeAcceso(credenciales, { fetchImpl, ahora: AHORA }), /cuenta de servicio/i);
});

test('leerEspejo pide las cuatro pestañas en una sola llamada', async () => {
  let url;
  const fetchImpl = async (u) => {
    url = u;
    return { ok: true, json: async () => ({ valueRanges: [
      { values: [['Concepto', 'Valor'], ['Vendido', '1500000000']] },
      { values: [['Lote']] }, { values: [['Fecha']] }, { values: [['Fecha']] }
    ] }) };
  };
  const crudo = await leerEspejo({ fetchImpl, idHoja: 'HOJA1', tokenAcceso: 't' });
  assert.match(url, /HOJA1/);
  assert.equal((url.match(/ranges=/g) || []).length, 4);
  assert.deepEqual(crudo.Resumen[1], ['Vendido', '1500000000']);
});

test('leerEspejo avisa si Sheets falla', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  await assert.rejects(() => leerEspejo({ fetchImpl, idHoja: 'X', tokenAcceso: 't' }), /hoja/i);
});

const CRUDO = {
  Resumen: [
    ['Concepto', 'Valor'],
    ['Vendido', '1500000000'], ['Abonado', '515000000'], ['Por cobrar', '985000000'],
    ['Disponible', '1833480000'], ['Gastado en obra', '620000000'], ['Caja', '48000000']
  ],
  Cartera: [
    ['Lote', 'Área', 'Comprador', 'Precio', 'Abonado', 'Saldo', 'Próxima cuota fecha', 'Próxima cuota valor', 'Estado'],
    ['1', '2754', 'Comprador de prueba uno', '300000000', '30000000', '270000000', '2027-02-19', '54000000', 'Promesa'],
    ['14', '3000', 'Comprador lote 14', '300000000', '100000000', '200000000', '', '', 'Promesa']
  ],
  Abonos: [
    ['Fecha', 'Lote', 'Valor', 'Medio'],
    ['2026-08-25', '1', '30000000', 'Transferencia'],
    ['2025-01-15', '14', '100000000', 'Transferencia']
  ],
  Egresos: [
    ['Fecha', 'Categoría', 'Concepto', 'Valor'],
    ['2026-04-29', 'Acueducto', 'Red principal del loteo', '99527738'],
    ['2026-03-31', 'Adecuaciones', 'Barrera viva de eugenios', '8000000']
  ]
};

test('normalizarTablero arma el tablero completo', () => {
  const t = normalizarTablero(CRUDO, { ahora: AHORA });
  assert.equal(t.leidoEn, AHORA.toISOString());
  assert.equal(t.resumen.vendido, 1500000000);
  assert.equal(t.resumen.caja, 48000000);
  assert.equal(t.cartera.length, 2);
  assert.equal(t.egresos.length, 2);
  assert.deepEqual(t.avisos, []);
});

test('cada lote de la cartera trae sus abonos', () => {
  const t = normalizarTablero(CRUDO, { ahora: AHORA });
  const uno = t.cartera.find(c => c.lote === 1);
  assert.equal(uno.abonos.length, 1);
  assert.equal(uno.abonos[0].valor, 30000000);
  assert.equal(uno.abonos[0].fecha, '2026-08-25');
});

test('una celda con texto donde va número se marca y no rompe el total', () => {
  const roto = { ...CRUDO, Egresos: [...CRUDO.Egresos, ['2026-05-01', 'Vías', 'Afirmado', 'pendiente']] };
  const t = normalizarTablero(roto, { ahora: AHORA });
  assert.equal(t.avisos.length, 1);
  assert.equal(t.avisos[0].pestana, 'Egresos');
  assert.equal(t.avisos[0].columna, 'Valor');
  assert.equal(t.egresos.length, 2, 'la fila marcada no entra a los egresos');
});

// --- Hallazgo 7: esta prueba ratificaba el bug (afirmaba que la pestaña vacía era un no-evento).
// Reescrita contra el requisito: no puede tumbar las otras pestañas Y tiene que avisar.
test('una pestaña vacía degrada sola sin tumbar el resto, pero avisa', () => {
  const t = normalizarTablero({ ...CRUDO, Egresos: [] }, { ahora: AHORA });
  assert.deepEqual(t.egresos, []);
  assert.equal(t.cartera.length, 2);
  assert.equal(t.resumen.vendido, 1500000000);
  assert.equal(t.avisos.length, 1, 'una pestaña vacía tiene que avisar');
  assert.equal(t.avisos[0].pestana, 'Egresos');
  assert.equal(t.avisos[0].tipo, 'pestana-vacia');
});

test('un resumen ilegible deja el número en null, nunca en cero', () => {
  const roto = { ...CRUDO, Resumen: [['Concepto', 'Valor'], ['Vendido', '#REF!']] };
  const t = normalizarTablero(roto, { ahora: AHORA });
  assert.equal(t.resumen.vendido, null);
  assert.notEqual(t.resumen.vendido, 0);
});

// --- Hallazgo 4: aNumero devolvía números equivocados en silencio ---
test('aNumero acepta números de JavaScript tal cual', () => {
  assert.equal(aNumero(1234.56), 1234.56);
  assert.equal(aNumero(1.5), 1.5);
  assert.equal(aNumero(-3000), -3000);
  assert.equal(aNumero(1833480000), 1833480000);
  assert.equal(aNumero(NaN), null);
  assert.equal(aNumero(Infinity), null);
});

test('aNumero devuelve null ante un texto ambiguo en vez de adivinar', () => {
  assert.equal(aNumero('1.5'), null, '1.5 es 15 en es-CO y 1,5 en en-US: ambiguo');
  assert.equal(aNumero('1.833'), null);
  assert.equal(aNumero('1,234'), null);
  assert.equal(aNumero('1,234.56'), null, 'formato en-US: la hoja quedó en otro locale');
  assert.equal(aNumero('1,500,000,000'), null);
});

test('aNumero solo acepta los formatos inequívocos de es-CO', () => {
  assert.equal(aNumero('1.833.480.000'), 1833480000);
  assert.equal(aNumero('$1.833.480.000'), 1833480000);
  assert.equal(aNumero('$ 1.234.567,89'), 1234567.89);
  assert.equal(aNumero('1234,56'), 1234.56);
  assert.equal(aNumero('-1.234.567'), -1234567);
  assert.equal(aNumero('0'), 0);
  assert.equal(aNumero(' 30000000 '), 30000000);
});

test('aNumero rechaza lo que Number() acepta de más', () => {
  assert.equal(aNumero('0x10'), null);
  assert.equal(aNumero('1e5'), null);
  assert.equal(aNumero('+1000'), null);
  assert.equal(aNumero('1 234'), null);
  assert.equal(aNumero('(1.000)'), null);
  assert.equal(aNumero([42]), null);
  assert.equal(aNumero(true), null);
  assert.equal(aNumero('-'), null);
  assert.equal(aNumero('   '), null);
});

// --- Hallazgo 4, de raíz: pedirle valores crudos a Sheets ---
test('leerEspejo pide valores sin formatear', async () => {
  let url;
  const fetchImpl = async (u) => {
    url = u;
    return { ok: true, json: async () => ({ valueRanges: [
      { values: [['Concepto', 'Valor'], ['Vendido', 1500000000]] },
      { values: [['Lote']] }, { values: [['Fecha']] }, { values: [['Fecha']] }
    ] }) };
  };
  await leerEspejo({ fetchImpl, idHoja: 'HOJA1', tokenAcceso: 't' });
  assert.match(url, /valueRenderOption=UNFORMATTED_VALUE/);
});

// --- Hallazgo 5: una respuesta truncada no puede rellenarse en silencio ---
test('leerEspejo falla si no llegan las cuatro pestañas', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ valueRanges: [
    { values: [['Concepto', 'Valor']] }
  ] }) });
  await assert.rejects(
    () => leerEspejo({ fetchImpl, idHoja: 'X', tokenAcceso: 't' }),
    /incompleta|cuatro/i
  );
});

test('leerEspejo falla si un rango llega sin cuerpo', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ valueRanges: [
    { values: [['a']] }, { values: [['b']] }, null, { values: [['d']] }
  ] }) });
  await assert.rejects(() => leerEspejo({ fetchImpl, idHoja: 'X', tokenAcceso: 't' }), /incompleta|cuatro/i);
});

// --- Menor 16: idHoja sin codificar ---
test('leerEspejo codifica el id de la hoja', async () => {
  let url;
  const fetchImpl = async (u) => {
    url = u;
    return { ok: true, json: async () => ({ valueRanges: [
      { values: [['a']] }, { values: [['b']] }, { values: [['c']] }, { values: [['d']] }
    ] }) };
  };
  await leerEspejo({ fetchImpl, idHoja: 'X/values:batchGet?ranges=Secreta&x=', tokenAcceso: 't' });
  assert.equal((url.match(/values:batchGet/g) || []).length, 1, 'el id no puede inyectar otra ruta');
  assert.equal((url.match(/ranges=Secreta/g) || []).length, 0);
  assert.match(url, /spreadsheets\/X%2Fvalues%3AbatchGet%3Franges%3DSecreta%26x%3D\/values:batchGet/);
});

test('leerEspejo manda el token de acceso en el encabezado', async () => {
  let opciones;
  const fetchImpl = async (u, o) => {
    opciones = o;
    return { ok: true, json: async () => ({ valueRanges: [
      { values: [['a']] }, { values: [['b']] }, { values: [['c']] }, { values: [['d']] }
    ] }) };
  };
  await leerEspejo({ fetchImpl, idHoja: 'HOJA1', tokenAcceso: 'ya29.token' });
  assert.equal(opciones.headers.authorization, 'Bearer ya29.token');
});

// --- Menor 17: culpar a la hoja cuando el problema son las credenciales ---
test('tokenDeAcceso avisa si la respuesta llega sin access_token', async () => {
  const { privateKey } = await generateKeyPair('RS256');
  const credenciales = { client_email: 'x@y.cuenta-de-prueba.invalid', private_key: await exportPKCS8(privateKey) };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ error: 'invalid_grant' }) });
  await assert.rejects(
    () => tokenDeAcceso(credenciales, { fetchImpl, ahora: AHORA }),
    (e) => {
      assert.match(e.message, /cuenta de servicio/i);
      assert.doesNotMatch(e.message, /hoja/i, 'el error no puede culpar a la hoja');
      return true;
    }
  );
});

// --- Hallazgo 5: pestaña vacía ---
test('normalizarTablero avisa por cada pestaña que llega vacía', () => {
  const t = normalizarTablero({}, { ahora: AHORA });
  const vacias = t.avisos.filter(a => a.tipo === 'pestana-vacia').map(a => a.pestana);
  assert.deepEqual(vacias, ['Resumen', 'Cartera', 'Abonos', 'Egresos']);
  assert.ok(t.avisos.length > 0, 'una lectura vacía no puede verse igual que una hoja sana');
});

// --- Hallazgo 6: fila del resumen ausente o renombrada ---
test('normalizarTablero avisa cuál concepto del resumen falta', () => {
  const sinCaja = {
    ...CRUDO,
    Resumen: CRUDO.Resumen.filter(f => f[0] !== 'Caja')
  };
  const t = normalizarTablero(sinCaja, { ahora: AHORA });
  assert.equal(t.resumen.caja, null);
  const faltantes = t.avisos.filter(a => a.tipo === 'clave-faltante');
  assert.equal(faltantes.length, 1);
  assert.equal(faltantes[0].pestana, 'Resumen');
  assert.equal(faltantes[0].concepto, 'Caja');
});

test('un concepto renombrado avisa por el nombre que se esperaba', () => {
  const renombrado = {
    ...CRUDO,
    Resumen: CRUDO.Resumen.map(f => (f[0] === 'Por cobrar' ? ['Saldo por cobrar', f[1]] : f))
  };
  const t = normalizarTablero(renombrado, { ahora: AHORA });
  assert.equal(t.resumen.porCobrar, null);
  const faltantes = t.avisos.filter(a => a.tipo === 'clave-faltante');
  assert.deepEqual(faltantes.map(a => a.concepto), ['Por cobrar']);
});

// --- Menor 14: el arreglo de abonos compartido y mutado por .sort() ---
test('dos filas del mismo lote no comparten el arreglo de abonos', () => {
  const duplicado = {
    ...CRUDO,
    Cartera: [
      CRUDO.Cartera[0],
      CRUDO.Cartera[1],
      ['1', '2754', 'Comprador repetido', '300000000', '30000000', '270000000', '', '', 'Promesa']
    ]
  };
  const antes = duplicado.Abonos.length;
  const t = normalizarTablero(duplicado, { ahora: AHORA });
  assert.notEqual(t.cartera[0].abonos, t.cartera[1].abonos, 'no puede ser la misma instancia');
  t.cartera[0].abonos.push({ fecha: 'x', valor: 1, medio: 'x' });
  assert.equal(t.cartera[1].abonos.length, 1, 'tocar una fila no puede tocar la otra');
  assert.equal(duplicado.Abonos.length, antes);
});

// --- Revisión final, hallazgo 2: una cuota ilegible se volvía «Sin cuota programada» ---
// `proximaCuotaValor` usaba `aNumero` pelado: devolvía null callado, igual que una
// celda vacía. Aguas abajo eso se convierte en una afirmación de negocio —«este
// comprador no tiene cuota pendiente»— falsa y sin ninguna señal de que falló la
// lectura. Vacío e ilegible tienen que distinguirse.
test('una próxima cuota ilegible avisa e identifica la fila', () => {
  const roto = {
    ...CRUDO,
    Cartera: [
      CRUDO.Cartera[0],
      ['14', '3000', 'Comprador lote 14', '300000000', '100000000', '200000000', '2027-03-01', '#REF!', 'Promesa']
    ]
  };
  const t = normalizarTablero(roto, { ahora: AHORA });
  const c = t.cartera.find(x => x.lote === 14);
  assert.equal(c.proximaCuotaValor, null);
  assert.equal(c.proximaCuotaIlegible, true, 'la vista no puede decir «sin cuota» ante un dato ilegible');
  const avisos = t.avisos.filter(a => a.tipo === 'ilegible' && a.pestana === 'Cartera' && a.columna === 'Próxima cuota');
  assert.equal(avisos.length, 1, 'una cuota ilegible tiene que avisar');
  assert.equal(avisos[0].fila, 2);
  assert.equal(avisos[0].valor, '#REF!');
});

test('una próxima cuota genuinamente vacía no avisa: eso sí es «sin cuota programada»', () => {
  const t = normalizarTablero(CRUDO, { ahora: AHORA });
  const c = t.cartera.find(x => x.lote === 14);
  assert.equal(c.proximaCuotaValor, null);
  assert.equal(c.proximaCuotaIlegible, false, 'una celda vacía no es un error');
  assert.deepEqual(t.avisos, [], 'una cuota vacía no puede generar ruido');
});

test('una cuota ambigua tampoco pasa callada', () => {
  const roto = {
    ...CRUDO,
    Cartera: [
      CRUDO.Cartera[0],
      ['1', '2754', 'Comprador uno', '300000000', '30000000', '270000000', '2027-02-19', '1.5', 'Promesa']
    ]
  };
  const t = normalizarTablero(roto, { ahora: AHORA });
  assert.equal(t.cartera[0].proximaCuotaIlegible, true);
  assert.ok(t.avisos.some(a => a.columna === 'Próxima cuota'));
});

// --- Revisión final, hallazgo 3: un abono con lote ilegible desaparecía en silencio ---
// El socio abre el lote, le falta un pago, y el Abonado del Resumen deja de cuadrar
// con el detalle. Sin nada en pantalla que lo explique.
test('un abono con lote ilegible avisa e identifica la fila', () => {
  const roto = { ...CRUDO, Abonos: [...CRUDO.Abonos, ['2026-07-01', 'siete', '50000000', 'Transferencia']] };
  const t = normalizarTablero(roto, { ahora: AHORA });
  const avisos = t.avisos.filter(a => a.tipo === 'ilegible' && a.pestana === 'Abonos' && a.columna === 'Lote');
  assert.equal(avisos.length, 1, 'un abono descartado no puede irse callado');
  assert.equal(avisos[0].fila, 4);
  assert.equal(avisos[0].valor, 'siete');
});

test('el abono con lote ilegible sigue sin colarse a ningún lote', () => {
  const roto = { ...CRUDO, Abonos: [...CRUDO.Abonos, ['2026-07-01', 'siete', '50000000', 'Transferencia']] };
  const t = normalizarTablero(roto, { ahora: AHORA });
  const total = t.cartera.flatMap(c => c.abonos).reduce((s, a) => s + a.valor, 0);
  assert.equal(total, 130000000, 'la fila ilegible no entra a ningún detalle');
});

// --- Revisión final, hallazgo 4: «vacía» tiene que ser sin filas de DATOS ---
// A una pestaña a la que le borran las filas le queda el encabezado: length === 1.
// Ese caso no disparaba `pestana-vacia`, así que index.js guardaba esa lectura en
// caché y borraba la última lectura buena justo cuando más falta hace.
test('una pestaña que quedó solo con el encabezado también avisa', () => {
  const t = normalizarTablero(
    { ...CRUDO, Egresos: [['Fecha', 'Categoría', 'Concepto', 'Valor']] },
    { ahora: AHORA }
  );
  const vacias = t.avisos.filter(a => a.tipo === 'pestana-vacia').map(a => a.pestana);
  assert.deepEqual(vacias, ['Egresos'], 'sin filas de datos es vacía, aunque venga el encabezado');
});

test('las cuatro pestañas reducidas a su encabezado avisan las cuatro', () => {
  const soloEncabezados = {
    Resumen: [['Concepto', 'Valor']],
    Cartera: [['Lote', 'Área', 'Comprador']],
    Abonos: [['Fecha', 'Lote', 'Valor', 'Medio']],
    Egresos: [['Fecha', 'Categoría', 'Concepto', 'Valor']]
  };
  const t = normalizarTablero(soloEncabezados, { ahora: AHORA });
  const vacias = t.avisos.filter(a => a.tipo === 'pestana-vacia').map(a => a.pestana);
  assert.deepEqual(vacias, ['Resumen', 'Cartera', 'Abonos', 'Egresos']);
});

test('una pestaña con una sola fila de datos no se marca como vacía', () => {
  const t = normalizarTablero(CRUDO, { ahora: AHORA });
  assert.equal(t.avisos.filter(a => a.tipo === 'pestana-vacia').length, 0);
});

// --- Revisión final, hallazgo 6: el total por categoría necesita saber qué le falta ---
// El aviso de un egreso ilegible tiene que decir de qué categoría era la fila, para
// que la vista pueda marcar ESE total como incompleto, al lado de la cifra.
test('el aviso de un egreso ilegible dice a qué categoría pertenecía la fila', () => {
  const roto = { ...CRUDO, Egresos: [...CRUDO.Egresos, ['2026-05-01', 'Vías', 'Afirmado', '1.5']] };
  const t = normalizarTablero(roto, { ahora: AHORA });
  const aviso = t.avisos.find(a => a.pestana === 'Egresos');
  assert.equal(aviso.categoria, 'Vías');
});

test('un egreso ilegible sin categoría escrita se atribuye a «Sin categoría»', () => {
  const roto = { ...CRUDO, Egresos: [...CRUDO.Egresos, ['2026-05-01', '', 'Afirmado', '#N/A']] };
  const t = normalizarTablero(roto, { ahora: AHORA });
  const aviso = t.avisos.find(a => a.pestana === 'Egresos');
  assert.equal(aviso.categoria, 'Sin categoría');
});
