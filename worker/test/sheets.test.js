import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportPKCS8, decodeJwt } from 'jose';
import { tokenDeAcceso, leerEspejo, aNumero, normalizarTablero, fechaLegible } from '../src/sheets.js';

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

test('leerEspejo pide las seis pestañas en una sola llamada', async () => {
  let url;
  const fetchImpl = async (u) => {
    url = u;
    return { ok: true, json: async () => ({ valueRanges: [
      { values: [['Concepto', 'Valor'], ['Vendido', '1500000000']] },
      { values: [['Lote']] }, { values: [['Fecha']] }, { values: [['Fecha']] },
      { values: [['Socio']] }, { values: [['Concepto']] }
    ] }) };
  };
  const crudo = await leerEspejo({ fetchImpl, idHoja: 'HOJA1', tokenAcceso: 't' });
  assert.match(url, /HOJA1/);
  assert.equal((url.match(/ranges=/g) || []).length, 6);
  assert.deepEqual(crudo.Resumen[1], ['Vendido', '1500000000']);
  assert.deepEqual(crudo.Socios, [['Socio']], 'la pestaña de socios entra por su clave');
  assert.deepEqual(crudo.Caja, [['Concepto']], 'la pestaña de la caja entra por su clave');
});

test('leerEspejo pide la pestaña de la caja por su nombre real en la hoja', async () => {
  let url;
  const fetchImpl = async (u) => {
    url = u;
    return { ok: true, json: async () => ({ valueRanges: [
      { values: [['a']] }, { values: [['b']] }, { values: [['c']] },
      { values: [['d']] }, { values: [['e']] }, { values: [['f']] }
    ] }) };
  };
  await leerEspejo({ fetchImpl, idHoja: 'HOJA1', tokenAcceso: 't' });
  assert.match(url, new RegExp(encodeURIComponent("'Tablero Caja'")));
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
  ],
  // Socios inventados y cifras de juguete: los nombres reales viven en la hoja
  // y no entran a este repositorio (ver test/secretos.test.js en la raíz).
  Socios: [
    ['Socio', 'Participación', 'Escritura dic-2024', 'Compromiso jun-2025',
     'Adicional jul-2025', 'Compromiso dic-2025', 'Total aportado'],
    ['Sociedad Primera S.A.S.', 0.5, '100000000', '50000000', '25000000', '30000000', '205000000'],
    ['Sociedad Segunda S.A.S.', 0.5, '100000000', '50000000', '25000000', '20000000', '195000000']
  ],
  // La cuenta de la caja, con cifras de juguete: arranca en un saldo, le suma
  // y le resta, corta en un subtotal y cierra en la brecha. La última fila es
  // una nota: su columna B lleva texto, no plata.
  Caja: [
    ['Concepto', 'Valor', 'Tipo'],
    ['Saldo en banco', 100000000, 'saldo'],
    ['Compromisos pendientes de obra', -40000000, 'resta'],
    ['Cuota por entrar', 10000000, 'suma'],
    ['Disponible estimado', 70000000, 'subtotal'],
    ['Préstamo por devolver', -200000000, 'resta'],
    ['Brecha', -130000000, 'brecha'],
    ['Cuenta', 'Banco de prueba, ahorros', 'nota']
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
      { values: [['Lote']] }, { values: [['Fecha']] }, { values: [['Fecha']] },
      { values: [['Socio']] }, { values: [['Concepto']] }
    ] }) };
  };
  await leerEspejo({ fetchImpl, idHoja: 'HOJA1', tokenAcceso: 't' });
  assert.match(url, /valueRenderOption=UNFORMATTED_VALUE/);
});

// --- Hallazgo 5: una respuesta truncada no puede rellenarse en silencio ---
// Lo que fija esta prueba no es el número de pestañas —ese sube cada vez que se
// agrega una— sino que una respuesta corta se RECHAZA en vez de rellenarse con
// arreglos vacíos. Rellenar volvía una lectura parcial indistinguible de una
// hoja vacía, y aguas abajo cualquier suma daba 0.
test('leerEspejo falla si llegan menos rangos de los que pidió', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ valueRanges: [
    { values: [['Concepto', 'Valor']] }
  ] }) });
  await assert.rejects(
    () => leerEspejo({ fetchImpl, idHoja: 'X', tokenAcceso: 't' }),
    /incompleta/i
  );
});

test('a leerEspejo tampoco le sirve que llegue uno de más', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ valueRanges: [
    { values: [['a']] }, { values: [['b']] }, { values: [['c']] },
    { values: [['d']] }, { values: [['e']] }, { values: [['f']] }, { values: [['g']] }
  ] }) });
  await assert.rejects(() => leerEspejo({ fetchImpl, idHoja: 'X', tokenAcceso: 't' }), /incompleta/i);
});

test('leerEspejo falla si un rango llega sin cuerpo', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ valueRanges: [
    { values: [['a']] }, { values: [['b']] }, null, { values: [['d']] },
    { values: [['e']] }, { values: [['f']] }
  ] }) });
  await assert.rejects(() => leerEspejo({ fetchImpl, idHoja: 'X', tokenAcceso: 't' }), /incompleta/i);
});

// --- Menor 16: idHoja sin codificar ---
test('leerEspejo codifica el id de la hoja', async () => {
  let url;
  const fetchImpl = async (u) => {
    url = u;
    return { ok: true, json: async () => ({ valueRanges: [
      { values: [['a']] }, { values: [['b']] }, { values: [['c']] },
      { values: [['d']] }, { values: [['e']] }, { values: [['f']] }
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
      { values: [['a']] }, { values: [['b']] }, { values: [['c']] },
      { values: [['d']] }, { values: [['e']] }, { values: [['f']] }
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
  assert.deepEqual(vacias, ['Resumen', 'Cartera', 'Abonos', 'Egresos', 'Socios', 'Caja']);
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

test('todas las pestañas reducidas a su encabezado avisan una por una', () => {
  const soloEncabezados = {
    Resumen: [['Concepto', 'Valor']],
    Cartera: [['Lote', 'Área', 'Comprador']],
    Abonos: [['Fecha', 'Lote', 'Valor', 'Medio']],
    Egresos: [['Fecha', 'Categoría', 'Concepto', 'Valor']],
    Socios: [['Socio', 'Participación', 'Total aportado']],
    Caja: [['Concepto', 'Valor', 'Tipo']]
  };
  const t = normalizarTablero(soloEncabezados, { ahora: AHORA });
  const vacias = t.avisos.filter(a => a.tipo === 'pestana-vacia').map(a => a.pestana);
  assert.deepEqual(vacias, ['Resumen', 'Cartera', 'Abonos', 'Egresos', 'Socios', 'Caja']);
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

test('una fecha de la hoja llega legible y no como número serial', () => {
  // Con UNFORMATTED_VALUE, Sheets manda 46253 en vez de «19/08/2026».
  assert.equal(fechaLegible(46253), '19/08/2026');
  assert.equal(fechaLegible(45672), '15/01/2025');
  assert.equal(fechaLegible(1), '31/12/1899', 'el serial 1 es el origen del calendario de Sheets');
});

test('lo que no es un serial de fecha se devuelve tal cual', () => {
  assert.equal(fechaLegible('19/08/2026'), '19/08/2026', 'una fecha escrita a mano se respeta');
  assert.equal(fechaLegible('contra escritura'), 'contra escritura');
  assert.equal(fechaLegible(''), '');
  assert.equal(fechaLegible(null), '');
  assert.equal(fechaLegible(undefined), '');
  assert.equal(fechaLegible(0), '0', 'un 0 no es una fecha: cayó en la columna equivocada y se nota');
  assert.equal(fechaLegible(-5), '-5');
});

// --- «Tablero Socios»: lo que puso cada socio por la tierra -----------------

test('normalizarTablero devuelve un socio por fila, con sus cuatro pagos y su total', () => {
  const t = normalizarTablero(CRUDO, { ahora: AHORA });
  assert.equal(t.socios.length, 2);
  const [a, b] = t.socios;
  assert.equal(a.nombre, 'Sociedad Primera S.A.S.');
  assert.equal(a.participacion, 0.5);
  assert.equal(a.total, 205000000);
  assert.equal(a.pagos.length, 4);
  assert.deepEqual(a.pagos.map(p => p.valor), [100000000, 50000000, 25000000, 30000000]);
  assert.equal(b.total, 195000000);
  assert.deepEqual(t.avisos, []);
});

test('el rótulo de cada aporte sale del encabezado de la hoja, no del código', () => {
  const t = normalizarTablero(CRUDO, { ahora: AHORA });
  assert.deepEqual(t.socios[0].pagos.map(p => p.etiqueta), [
    'Escritura dic-2024', 'Compromiso jun-2025', 'Adicional jul-2025', 'Compromiso dic-2025'
  ]);
});

test('un encabezado de aporte en blanco cae a un rótulo genérico, no a «undefined»', () => {
  const sinRotulos = {
    ...CRUDO,
    Socios: [['Socio', 'Participación', '', '', '  ', '', 'Total aportado'], CRUDO.Socios[1]]
  };
  const t = normalizarTablero(sinRotulos, { ahora: AHORA });
  assert.deepEqual(t.socios[0].pagos.map(p => p.etiqueta),
    ['Aporte 1', 'Aporte 2', 'Aporte 3', 'Aporte 4']);
});

test('la participación pasa por numero: una celda ilegible queda en null y avisa', () => {
  const roto = {
    ...CRUDO,
    Socios: [CRUDO.Socios[0], ['Sociedad Primera S.A.S.', '#REF!', '1', '1', '1', '1', '4']]
  };
  const t = normalizarTablero(roto, { ahora: AHORA });
  assert.equal(t.socios[0].participacion, null);
  assert.notEqual(t.socios[0].participacion, 0);
  const aviso = t.avisos.find(a => a.pestana === 'Socios' && a.columna === 'Participación');
  assert.equal(aviso.fila, 2);
  assert.equal(aviso.valor, '#REF!');
});

test('un total ilegible avisa con el nombre de su columna y deja el número en null', () => {
  const roto = {
    ...CRUDO,
    Socios: [CRUDO.Socios[0], ['Sociedad Primera S.A.S.', 0.5, '1', '1', '1', '1', 'pendiente']]
  };
  const t = normalizarTablero(roto, { ahora: AHORA });
  assert.equal(t.socios[0].total, null);
  const aviso = t.avisos.find(a => a.pestana === 'Socios' && a.columna === 'Total aportado');
  assert.equal(aviso.tipo, 'ilegible');
  assert.equal(aviso.valor, 'pendiente');
});

test('un aporte ilegible avisa por el rótulo de la hoja y no borra al socio', () => {
  const roto = {
    ...CRUDO,
    Socios: [CRUDO.Socios[0], ['Sociedad Primera S.A.S.', 0.5, '100000000', '1.5', '1', '1', '4']]
  };
  const t = normalizarTablero(roto, { ahora: AHORA });
  assert.equal(t.socios.length, 1, 'el socio sigue en la tabla aunque una celda no se lea');
  assert.equal(t.socios[0].pagos[1].valor, null);
  assert.equal(t.socios[0].pagos[0].valor, 100000000, 'las celdas sanas de la fila no se pierden');
  const aviso = t.avisos.find(a => a.pestana === 'Socios');
  assert.equal(aviso.columna, 'Compromiso jun-2025');
});

test('una fila de socio en blanco no genera seis avisos: no hay nada que revisar', () => {
  const conBlanco = { ...CRUDO, Socios: [...CRUDO.Socios, ['', '', '', '', '', '', ''], ['   ']] };
  const t = normalizarTablero(conBlanco, { ahora: AHORA });
  assert.equal(t.socios.length, 2);
  assert.deepEqual(t.avisos, []);
});

test('un cero real en un aporte sigue siendo cero, no null', () => {
  const enCero = {
    ...CRUDO,
    Socios: [CRUDO.Socios[0], ['Sociedad Primera S.A.S.', 0.5, 0, '1', '1', '1', '3']]
  };
  const t = normalizarTablero(enCero, { ahora: AHORA });
  assert.equal(t.socios[0].pagos[0].valor, 0);
  assert.deepEqual(t.avisos, []);
});

test('la pestaña de socios vacía avisa como las demás', () => {
  const t = normalizarTablero({ ...CRUDO, Socios: [CRUDO.Socios[0]] }, { ahora: AHORA });
  assert.deepEqual(t.socios, []);
  const vacias = t.avisos.filter(a => a.tipo === 'pestana-vacia').map(a => a.pestana);
  assert.deepEqual(vacias, ['Socios']);
  assert.equal(t.cartera.length, 2, 'y no tumba a las otras pestañas');
});

// --- «Tablero Caja»: la cuenta que empieza en un saldo y termina en la brecha --

test('normalizarTablero devuelve la caja fila por fila, en el orden de la hoja', () => {
  const t = normalizarTablero(CRUDO, { ahora: AHORA });
  assert.equal(t.caja.length, 7);
  assert.deepEqual(t.caja.map(f => f.tipo),
    ['saldo', 'resta', 'suma', 'subtotal', 'resta', 'brecha', 'nota']);
  assert.equal(t.caja[0].concepto, 'Saldo en banco');
  assert.equal(t.caja[0].valor, 100000000);
  assert.equal(t.caja[5].valor, -130000000, 'la brecha llega en negativo, tal como está en la hoja');
  assert.deepEqual(t.avisos, []);
});

test('el valor de la caja pasa por la misma conversión que el resto de la hoja', () => {
  const conTexto = {
    ...CRUDO,
    Caja: [CRUDO.Caja[0], ['Saldo en banco', '$132.000.000', 'saldo']]
  };
  const t = normalizarTablero(conTexto, { ahora: AHORA });
  assert.equal(t.caja[0].valor, 132000000);
  assert.deepEqual(t.avisos, []);
});

test('una cifra ilegible de la caja avisa con su fila y deja el número en null', () => {
  const roto = {
    ...CRUDO,
    Caja: [CRUDO.Caja[0], CRUDO.Caja[1], ['Cuota por entrar', '#REF!', 'suma']]
  };
  const t = normalizarTablero(roto, { ahora: AHORA });
  assert.equal(t.caja.length, 2, 'la fila ilegible no se descarta: es un renglón de la cuenta');
  assert.equal(t.caja[1].valor, null);
  assert.notEqual(t.caja[1].valor, 0);
  const aviso = t.avisos.find(a => a.pestana === 'Caja');
  assert.equal(aviso.tipo, 'ilegible');
  assert.equal(aviso.fila, 3);
  assert.equal(aviso.columna, 'Valor');
  assert.equal(aviso.valor, '#REF!');
});

test('la fila de tipo «nota» lleva texto en la columna del valor y no avisa', () => {
  const t = normalizarTablero(CRUDO, { ahora: AHORA });
  const nota = t.caja.at(-1);
  assert.equal(nota.tipo, 'nota');
  assert.equal(nota.texto, 'Banco de prueba, ahorros');
  assert.equal(nota.valor, null, 'una nota no tiene cifra');
  assert.deepEqual(t.avisos, [], 'el texto de una nota no es un número mal escrito');
});

test('el tipo llega normalizado en minúsculas y sin espacios', () => {
  const desprolijo = {
    ...CRUDO,
    Caja: [CRUDO.Caja[0], ['Saldo en banco', 100000000, '  SALDO '], ['Cuenta', 'Banco', ' Nota ']]
  };
  const t = normalizarTablero(desprolijo, { ahora: AHORA });
  assert.deepEqual(t.caja.map(f => f.tipo), ['saldo', 'nota']);
  assert.equal(t.caja[1].texto, 'Banco', 'una «Nota» con mayúscula sigue siendo una nota');
});

test('un tipo desconocido pasa tal cual, sin descartar la fila', () => {
  const nuevo = {
    ...CRUDO,
    Caja: [CRUDO.Caja[0], ['Reserva por definir', 5000000, 'provision']]
  };
  const t = normalizarTablero(nuevo, { ahora: AHORA });
  assert.equal(t.caja.length, 1);
  assert.equal(t.caja[0].tipo, 'provision');
  assert.equal(t.caja[0].valor, 5000000);
  assert.deepEqual(t.avisos, [], 'un tipo nuevo no es un error de la hoja');
});

test('una fila de caja sin tipo tampoco se pierde', () => {
  const sinTipo = { ...CRUDO, Caja: [CRUDO.Caja[0], ['Algo suelto', 1000]] };
  const t = normalizarTablero(sinTipo, { ahora: AHORA });
  assert.equal(t.caja.length, 1);
  assert.equal(t.caja[0].tipo, '');
  assert.equal(t.caja[0].valor, 1000);
});

test('un cero real en la caja sigue siendo cero, no null', () => {
  const enCero = { ...CRUDO, Caja: [CRUDO.Caja[0], ['Saldo en banco', 0, 'saldo']] };
  const t = normalizarTablero(enCero, { ahora: AHORA });
  assert.equal(t.caja[0].valor, 0);
  assert.deepEqual(t.avisos, []);
});

test('una fila de caja en blanco no genera avisos: es un renglón de aire', () => {
  const conBlanco = { ...CRUDO, Caja: [...CRUDO.Caja, ['', '', ''], ['   ']] };
  const t = normalizarTablero(conBlanco, { ahora: AHORA });
  assert.equal(t.caja.length, 7);
  assert.deepEqual(t.avisos, []);
});

test('la pestaña de la caja vacía avisa como las demás', () => {
  const t = normalizarTablero({ ...CRUDO, Caja: [CRUDO.Caja[0]] }, { ahora: AHORA });
  assert.deepEqual(t.caja, []);
  const vacias = t.avisos.filter(a => a.tipo === 'pestana-vacia').map(a => a.pestana);
  assert.deepEqual(vacias, ['Caja']);
  assert.equal(t.cartera.length, 2, 'y no tumba a las otras pestañas');
});

test('el concepto de la caja llega crudo: escaparlo es tarea de la vista', () => {
  const malicioso = {
    ...CRUDO,
    Caja: [CRUDO.Caja[0], ['<img src=x onerror=alert(1)>', 1000, 'suma']]
  };
  const t = normalizarTablero(malicioso, { ahora: AHORA });
  assert.equal(t.caja[0].concepto, '<img src=x onerror=alert(1)>');
});

test('el nombre del socio llega crudo: escaparlo es tarea de la vista', () => {
  const malicioso = {
    ...CRUDO,
    Socios: [CRUDO.Socios[0], ['<img src=x onerror=alert(1)>', 0.5, '1', '1', '1', '1', '4']]
  };
  const t = normalizarTablero(malicioso, { ahora: AHORA });
  assert.equal(t.socios[0].nombre, '<img src=x onerror=alert(1)>');
});
