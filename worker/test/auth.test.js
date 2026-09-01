import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { verificarIdentidad, estaAutorizado, autorizar, ErrorAuth, ErrorConfiguracion } from '../src/auth.js';

const CLIENTE = '123-abc.apps.googleusercontent.com';
const EMISOR = 'https://accounts.google.com';
const LISTA = 'Luis@Ejemplo.com, socia@ejemplo.com ,otro@ejemplo.com';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const jwks = createLocalJWKSet({ keys: [jwk] });

async function token(extra = {}, opciones = {}) {
  return new SignJWT({ email: 'luis@ejemplo.com', email_verified: true, ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opciones.iss ?? EMISOR)
    .setAudience(opciones.aud ?? CLIENTE)
    .setIssuedAt()
    .setExpirationTime(opciones.exp ?? '5m')
    .sign(opciones.llave ?? privateKey);
}

test('acepta un token bien firmado y devuelve el correo', async () => {
  const { email } = await verificarIdentidad(await token(), { clientId: CLIENTE, jwks });
  assert.equal(email, 'luis@ejemplo.com');
});

test('rechaza un token de otra aplicación', async () => {
  const t = await token({}, { aud: 'otra-app.apps.googleusercontent.com' });
  await assert.rejects(() => verificarIdentidad(t, { clientId: CLIENTE, jwks }), ErrorAuth);
});

test('rechaza un token de otro emisor', async () => {
  const t = await token({}, { iss: 'https://malicioso.example' });
  await assert.rejects(() => verificarIdentidad(t, { clientId: CLIENTE, jwks }), ErrorAuth);
});

test('rechaza un token vencido', async () => {
  const t = await token({}, { exp: '-1m' });
  await assert.rejects(() => verificarIdentidad(t, { clientId: CLIENTE, jwks }), ErrorAuth);
});

test('rechaza un token firmado con otra llave', async () => {
  const otra = await generateKeyPair('RS256');
  const t = await token({}, { llave: otra.privateKey });
  await assert.rejects(() => verificarIdentidad(t, { clientId: CLIENTE, jwks }), ErrorAuth);
});

test('rechaza un correo sin verificar', async () => {
  const t = await token({ email_verified: false });
  await assert.rejects(() => verificarIdentidad(t, { clientId: CLIENTE, jwks }), ErrorAuth);
});

test('rechaza que no haya token', async () => {
  await assert.rejects(() => verificarIdentidad(undefined, { clientId: CLIENTE, jwks }), ErrorAuth);
});

test('el error de identidad es 401', async () => {
  try {
    await verificarIdentidad('basura', { clientId: CLIENTE, jwks });
    assert.fail('debió lanzar');
  } catch (e) {
    assert.equal(e.estado, 401);
  }
});

test('la lista no distingue mayúsculas ni espacios', () => {
  assert.equal(estaAutorizado('luis@ejemplo.com', LISTA), true);
  assert.equal(estaAutorizado('SOCIA@EJEMPLO.COM', LISTA), true);
  assert.equal(estaAutorizado('ajeno@ejemplo.com', LISTA), false);
});

test('una lista vacía no autoriza a nadie', () => {
  assert.equal(estaAutorizado('luis@ejemplo.com', ''), false);
  assert.equal(estaAutorizado('luis@ejemplo.com', undefined), false);
});

// --- Cabo suelto: un correo que no es texto nunca autoriza ---
// `String(undefined)` da la cadena "undefined". Si la lista trajera esa palabra
// como correo (typo, copia mal hecha), un correo ausente pasaría igual. Hoy no hay
// forma de llegar hasta acá con el email en `undefined`, pero el contrato de la
// función no puede depender de que el llamador nunca cometa ese error.
test('un correo que no es una cadena no vacía nunca autoriza, ni con la lista contaminada', () => {
  const listaContaminada = 'undefined, luis@ejemplo.com';
  assert.equal(estaAutorizado(undefined, listaContaminada), false);
  assert.equal(estaAutorizado(null, listaContaminada), false);
  assert.equal(estaAutorizado('', listaContaminada), false);
  assert.equal(estaAutorizado(123, listaContaminada), false);
});

test('autorizar lanza 403 con token bueno y correo fuera de lista', async () => {
  const t = await token({ email: 'ajeno@ejemplo.com' });
  try {
    await autorizar(t, { clientId: CLIENTE, jwks, listaCruda: LISTA });
    assert.fail('debió lanzar');
  } catch (e) {
    assert.equal(e.estado, 403);
  }
});

test('autorizar deja pasar a un socio de la lista', async () => {
  const { email } = await autorizar(await token(), { clientId: CLIENTE, jwks, listaCruda: LISTA });
  assert.equal(email, 'luis@ejemplo.com');
});

// --- Hallazgo 1 (crítico) ---
// Con clientId vacío jose deja de revisar el destinatario y entra cualquier token de Google.
// Tiene que fallar CERRADO, y no como ErrorAuth 401: no es culpa de quien entra sino
// configuración rota, así que el tablero no puede servirse.
test('un clientId vacío o ausente no deja verificar nada', async () => {
  const t = await token();
  for (const clientId of ['', '   ', undefined, null, 123]) {
    await assert.rejects(
      () => verificarIdentidad(t, { clientId, jwks }),
      (e) => {
        assert.ok(e instanceof ErrorConfiguracion, `con ${JSON.stringify(clientId)} debió ser ErrorConfiguracion`);
        assert.ok(!(e instanceof ErrorAuth), 'no puede pasar por error de la persona que entra');
        assert.equal(e.estado, 500);
        return true;
      }
    );
  }
});

test('autorizar tampoco deja pasar con el clientId vacío', async () => {
  const t = await token();
  await assert.rejects(
    () => autorizar(t, { clientId: '', jwks, listaCruda: LISTA }),
    ErrorConfiguracion
  );
});

// --- Hallazgo 2 (importante): confusión de algoritmo ---
test('rechaza confusión de algoritmo: alg none y HS256', async () => {
  // alg: none, firma vacía
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sinFirma =
    b64({ alg: 'none', typ: 'JWT' }) + '.' +
    b64({
      email: 'atacante@malo.com', email_verified: true,
      iss: EMISOR, aud: CLIENTE,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300
    }) + '.';
  await assert.rejects(() => verificarIdentidad(sinFirma, { clientId: CLIENTE, jwks }), ErrorAuth);

  // HS256 firmado con un secreto, y ese mismo secreto entregado como llave de verificación.
  // Sin `algorithms: ['RS256']` esto verifica y entra: la restricción no puede depender de
  // que la llave venga envuelta en un JWKS.
  const secreto = new TextEncoder().encode('secreto compartido de treinta y dos bytes largo');
  const conSecreto = await new SignJWT({ email: 'atacante@malo.com', email_verified: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(EMISOR)
    .setAudience(CLIENTE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secreto);
  await assert.rejects(
    () => verificarIdentidad(conSecreto, { clientId: CLIENTE, jwks: secreto }),
    ErrorAuth
  );
});

// --- Hallazgo 3 (importante): antigüedad ---
test('rechaza un token sin exp', async () => {
  const t = await new SignJWT({ email: 'atacante@malo.com', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(EMISOR)
    .setAudience(CLIENTE)
    .setIssuedAt()
    .sign(privateKey);
  await assert.rejects(() => verificarIdentidad(t, { clientId: CLIENTE, jwks }), ErrorAuth);
});

test('rechaza un token emitido hace mucho aunque su exp esté en el futuro', async () => {
  const hace10Anios = Math.floor(Date.now() / 1000) - 10 * 365 * 24 * 3600;
  const t = await new SignJWT({ email: 'atacante@malo.com', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(EMISOR)
    .setAudience(CLIENTE)
    .setIssuedAt(hace10Anios)
    .setExpirationTime('10y')
    .sign(privateKey);
  await assert.rejects(() => verificarIdentidad(t, { clientId: CLIENTE, jwks }), ErrorAuth);
});

// --- Menor 10 ---
test('el correo se devuelve recortado, no solo en minúsculas', async () => {
  const t = await token({ email: '  Luis@Ejemplo.com  ' });
  const { email } = await verificarIdentidad(t, { clientId: CLIENTE, jwks });
  assert.equal(email, 'luis@ejemplo.com');
});

test('los mensajes de error no distinguen entre las formas de fallar', async () => {
  const casos = [
    'basura',
    await token({}, { aud: 'otra-app.apps.googleusercontent.com' }),
    await token({}, { exp: '-1m' }),
    await token({}, { llave: (await generateKeyPair('RS256')).privateKey }),
    await token({ email_verified: false })
  ];
  const mensajes = new Set();
  for (const t of casos) {
    try {
      await verificarIdentidad(t, { clientId: CLIENTE, jwks });
      assert.fail('debió lanzar');
    } catch (e) {
      assert.equal(e.estado, 401);
      mensajes.add(e.message);
    }
  }
  assert.equal(mensajes.size, 1, 'el mensaje al usuario tiene que ser siempre el mismo');
});

// --- Revisión final, hallazgo 5: la lista de socios sin llenar ---
// Con SOCIOS_AUTORIZADOS ausente o vacío, los seis socios legítimos recibían
// 403 «No tenés acceso a este tablero»: un secreto olvidado en el despliegue
// disfrazado de rechazo personal. Es exactamente la confusión que
// ErrorConfiguracion ya resuelve para GOOGLE_CLIENT_ID, en la variable de al lado.
test('una lista de socios ausente o vacía es error de configuración, no un rechazo al socio', async () => {
  const t = await token();
  for (const listaCruda of [undefined, null, '', '   ', ',', ' , , ', 123]) {
    await assert.rejects(
      () => autorizar(t, { clientId: CLIENTE, jwks, listaCruda }),
      (e) => {
        assert.ok(e instanceof ErrorConfiguracion, `con ${JSON.stringify(listaCruda)} debió ser ErrorConfiguracion`);
        assert.ok(!(e instanceof ErrorAuth), 'no puede pasar por culpa de quien entra');
        assert.equal(e.estado, 500);
        assert.doesNotMatch(e.message, /acceso/i, 'no puede decirle al socio que no tiene acceso');
        return true;
      }
    );
  }
});

test('una lista con contenido pero sin el correo sigue siendo 403', async () => {
  const t = await token({ email: 'ajeno@ejemplo.com' });
  await assert.rejects(
    () => autorizar(t, { clientId: CLIENTE, jwks, listaCruda: LISTA }),
    (e) => {
      assert.ok(e instanceof ErrorAuth);
      assert.equal(e.estado, 403);
      return true;
    }
  );
});

test('una lista mal escrita no autoriza a nadie: nunca abre por error', () => {
  for (const lista of ['', '   ', ',', ',,,', ' , , ', undefined, null, 123, 'undefined']) {
    assert.equal(estaAutorizado('luis@ejemplo.com', lista), false, `la lista ${JSON.stringify(lista)} no puede autorizar`);
  }
});
