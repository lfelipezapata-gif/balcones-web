import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { manejar } from '../src/index.js';
import { normalizarTablero } from '../src/sheets.js';

const CLIENTE = '123-abc.apps.googleusercontent.com';
const AHORA = new Date('2026-08-31T21:50:00.000Z');
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const jwks = createLocalJWKSet({ keys: [jwk] });

const TABLERO = {
  leidoEn: AHORA.toISOString(),
  resumen: { vendido: 1500000000, abonado: 515000000, porCobrar: 985000000,
             disponible: 1833480000, gastadoObra: 620000000, caja: 48000000 },
  cartera: [], egresos: [], avisos: []
};

const env = {
  GOOGLE_CLIENT_ID: CLIENTE,
  SOCIOS_AUTORIZADOS: 'luis@ejemplo.com',
  ID_HOJA_ESPEJO: 'HOJA1',
  ORIGEN_PERMITIDO: 'https://lfelipezapata-gif.github.io',
  CUENTA_SERVICIO_JSON: '{"client_email":"x@y.cuenta-de-prueba.invalid","private_key":"-"}'
};

async function token(email = 'luis@ejemplo.com') {
  return new SignJWT({ email, email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://accounts.google.com').setAudience(CLIENTE)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
}

const pedir = async (t) => new Request('https://tablero.workers.dev/api/tablero', {
  headers: t ? { authorization: `Bearer ${t}` } : {}
});

function deps({ falla = false, cache = null } = {}) {
  const guardado = { valor: cache };
  return {
    jwks,
    ahora: () => AHORA,
    leerTablero: async () => {
      if (falla) throw new Error('Sheets caído');
      return TABLERO;
    },
    cacheLeer: async () => guardado.valor,
    cacheGuardar: async (t) => { guardado.valor = t; },
    _guardado: guardado
  };
}

test('sin token responde 401', async () => {
  const r = await manejar(await pedir(null), env, deps());
  assert.equal(r.status, 401);
  assert.match((await r.json()).error, /sesión/i);
});

test('correo fuera de lista responde 403 diciendo CON CUÁL entró', async () => {
  // Sin el correo en pantalla, «me olvidaron de la lista» y «el navegador está
  // en otra cuenta de Google» se ven idénticos, y se arreglan al revés.
  const r = await manejar(await pedir(await token('ajeno@ejemplo.com')), env, deps());
  assert.equal(r.status, 403);
  const { error } = await r.json();
  assert.match(error, /ajeno@ejemplo\.com/, 'tiene que decir con qué correo entró');
  assert.match(error, /cuenta de Google/i, 'y qué hacer si no es el suyo');
});

test('socio autorizado recibe el tablero', async () => {
  const r = await manejar(await pedir(await token()), env, deps());
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.resumen.vendido, 1500000000);
  assert.equal(cuerpo.desdeCache, false);
});

test('una lectura buena queda guardada en caché', async () => {
  const d = deps();
  await manejar(await pedir(await token()), env, d);
  assert.equal(d._guardado.valor.resumen.vendido, 1500000000);
});

test('si Sheets falla devuelve la última lectura buena, marcada', async () => {
  const viejo = { ...TABLERO, leidoEn: '2026-08-31T21:38:00.000Z' };
  const r = await manejar(await pedir(await token()), env, deps({ falla: true, cache: viejo }));
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.desdeCache, true);
  assert.equal(cuerpo.leidoEn, '2026-08-31T21:38:00.000Z');
  assert.equal(cuerpo.resumen.vendido, 1500000000);
});

test('si Sheets falla y no hay caché responde 503, NUNCA ceros', async () => {
  const r = await manejar(await pedir(await token()), env, deps({ falla: true, cache: null }));
  assert.equal(r.status, 503);
  const cuerpo = await r.json();
  assert.match(cuerpo.error, /no se pudo/i);
  assert.equal('resumen' in cuerpo, false);
});

test('la respuesta lleva el origen permitido, no un comodín', async () => {
  const r = await manejar(await pedir(await token()), env, deps());
  assert.equal(r.headers.get('access-control-allow-origin'), env.ORIGEN_PERMITIDO);
});

test('responde al preflight', async () => {
  const req = new Request('https://tablero.workers.dev/api/tablero', { method: 'OPTIONS' });
  const r = await manejar(req, env, deps());
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), env.ORIGEN_PERMITIDO);
});

test('una ruta que no existe responde 404', async () => {
  const req = new Request('https://tablero.workers.dev/otra', {
    headers: { authorization: `Bearer ${await token()}` }
  });
  assert.equal((await manejar(req, env, deps())).status, 404);
});

// --- Defecto 1 del brief: ErrorConfiguracion no puede caer en el catch genérico de 401 ---
// GOOGLE_CLIENT_ID vacío apaga la revisión de audience en jose (ver auth.js). Es una falla
// de configuración del servidor, no de la persona que entra: tiene que responder 500, con
// un mensaje que no le cuente a un extraño CUÁL es el problema pero sí le sirva a quien opera.
test('GOOGLE_CLIENT_ID vacío responde 500, no 401, y no revela el detalle interno', async () => {
  const envRoto = { ...env, GOOGLE_CLIENT_ID: '' };
  const r = await manejar(await pedir(await token()), envRoto, deps());
  assert.equal(r.status, 500);
  const cuerpo = await r.json();
  assert.match(cuerpo.error, /administra|configurad/i);
  assert.doesNotMatch(cuerpo.error, /sesión/i);
});

test('GOOGLE_CLIENT_ID ausente también responde 500', async () => {
  const envRoto = { ...env };
  delete envRoto.GOOGLE_CLIENT_ID;
  const r = await manejar(await pedir(await token()), envRoto, deps());
  assert.equal(r.status, 500);
});

test('un error 500 de configuración también trae el origen permitido en la cabecera', async () => {
  const envRoto = { ...env, GOOGLE_CLIENT_ID: '' };
  const r = await manejar(await pedir(await token()), envRoto, deps());
  assert.equal(r.headers.get('access-control-allow-origin'), env.ORIGEN_PERMITIDO);
});

test('si Sheets falla y leer el caché también falla, igual responde 503 en español, sin dejar escapar la excepción', async () => {
  const d = deps({ falla: true });
  d.cacheLeer = async () => { throw new Error('Cache API no disponible'); };
  const r = await manejar(await pedir(await token()), env, d);
  assert.equal(r.status, 503);
  const cuerpo = await r.json();
  assert.match(cuerpo.error, /no se pudo/i);
  assert.equal('resumen' in cuerpo, false);
});

test('si Sheets responde bien pero cacheGuardar falla, se sirve igual la lectura fresca, no la vieja del caché', async () => {
  const viejo = { ...TABLERO, resumen: { ...TABLERO.resumen, vendido: 1 }, leidoEn: '2020-01-01T00:00:00.000Z' };
  const d = deps({ cache: viejo });
  d.cacheGuardar = async () => { throw new Error('Cache API no disponible al guardar'); };
  const r = await manejar(await pedir(await token()), env, d);
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.desdeCache, false);
  assert.equal(cuerpo.resumen.vendido, 1500000000);
  assert.equal(cuerpo.leidoEn, AHORA.toISOString());
});

test('una lectura con aviso de pestaña vacía no se guarda en caché', async () => {
  const d = deps();
  d.leerTablero = async () => ({ ...TABLERO, avisos: [{ tipo: 'pestana-vacia', pestana: 'Cartera' }] });
  const r = await manejar(await pedir(await token()), env, d);
  assert.equal(r.status, 200);
  assert.equal(d._guardado.valor, null);
});

test('ORIGEN_PERMITIDO ausente no serializa el texto "undefined" en la cabecera', async () => {
  const envRoto = { ...env };
  delete envRoto.ORIGEN_PERMITIDO;
  const r = await manejar(await pedir(await token()), envRoto, deps());
  assert.notEqual(r.headers.get('access-control-allow-origin'), 'undefined');
});

// --- Revisión final, hallazgo 4: una hoja con solo encabezados no puede pisar el respaldo ---
test('una hoja a la que le borraron las filas de datos no pisa la última lectura buena', async () => {
  const soloEncabezados = {
    Resumen: [['Concepto', 'Valor']],
    Cartera: [['Lote', 'Área', 'Comprador']],
    Abonos: [['Fecha', 'Lote', 'Valor', 'Medio']],
    Egresos: [['Fecha', 'Categoría', 'Concepto', 'Valor']]
  };
  const d = deps({ cache: TABLERO });
  d.leerTablero = async () => normalizarTablero(soloEncabezados, { ahora: AHORA });
  const r = await manejar(await pedir(await token()), env, d);
  assert.equal(r.status, 200);
  assert.equal(d._guardado.valor, TABLERO, 'la última lectura buena tiene que seguir intacta en el caché');
});

// --- Revisión final, hallazgo 5: el secreto olvidado no puede leerse como un rechazo ---
test('SOCIOS_AUTORIZADOS ausente responde 500, no 403, y no le dice al socio que no tiene acceso', async () => {
  const envRoto = { ...env };
  delete envRoto.SOCIOS_AUTORIZADOS;
  const r = await manejar(await pedir(await token()), envRoto, deps());
  assert.equal(r.status, 500);
  const cuerpo = await r.json();
  assert.doesNotMatch(cuerpo.error, /acceso/i);
  assert.match(cuerpo.error, /administra|configurad/i);
});

test('SOCIOS_AUTORIZADOS vacío también responde 500', async () => {
  const r = await manejar(await pedir(await token()), { ...env, SOCIOS_AUTORIZADOS: '   ' }, deps());
  assert.equal(r.status, 500);
});

test('con la lista llena, un correo que no está en ella sigue recibiendo 403', async () => {
  const r = await manejar(await pedir(await token('ajeno@ejemplo.com')), env, deps());
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /ajeno@ejemplo\.com/);
});

test('el 403 solo devuelve el correo del que entró, y ningún otro de la lista', async () => {
  // El mensaje enseña una dirección: la de quien está leyendo, que Google ya
  // verificó como suya. La lista de los demás socios no puede asomarse ahí.
  const r = await manejar(await pedir(await token('ajeno@ejemplo.com')), env, deps());
  const { error } = await r.json();
  for (const socio of env.SOCIOS_AUTORIZADOS.split(',').map(c => c.trim()).filter(Boolean)) {
    assert.doesNotMatch(error, new RegExp(socio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      `se filtró «${socio}», que es de otro socio`);
  }
});
