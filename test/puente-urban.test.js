import { test } from 'node:test';
import assert from 'node:assert/strict';
import puente, { DESTINO } from '../puente-urban/src/index.js';

test('el puente reenvía ruta, método, credencial y origen al Worker del tablero', async () => {
  let visto;
  const fetchImpl = async (req) => { visto = req; return new Response('ok', { status: 401 }); };
  const req = new Request('https://tablero.urbansas.com.co/api/tablero?x=1', {
    headers: { authorization: 'Bearer abc', origin: 'https://lfelipezapata-gif.github.io' },
  });
  const res = await puente.fetch(req, {}, {}, { fetchImpl });
  assert.equal(visto.url, `${DESTINO}/api/tablero?x=1`);
  assert.equal(visto.method, 'GET');
  assert.equal(visto.headers.get('authorization'), 'Bearer abc');
  assert.equal(visto.headers.get('origin'), 'https://lfelipezapata-gif.github.io');
  assert.equal(res.status, 401);
});

test('el puente deja pasar el preflight OPTIONS', async () => {
  let visto;
  const fetchImpl = async (req) => { visto = req; return new Response(null, { status: 204 }); };
  await puente.fetch(new Request('https://tablero.urbansas.com.co/api/tablero', { method: 'OPTIONS' }), {}, {}, { fetchImpl });
  assert.equal(visto.method, 'OPTIONS');
  assert.equal(visto.url, `${DESTINO}/api/tablero`);
});
