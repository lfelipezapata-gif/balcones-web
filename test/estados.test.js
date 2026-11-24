// El plano del tablero de socios toma el estado de cada lote de la app de ventas (24-nov-2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aplicarEstados, pedirEstados, URL_ESTADOS } from '../assets/js/estados.js';
import { validarInventario } from '../assets/js/inventario.js';

// Inventario mínimo: dos de los sectores 1 y 2 (uno en especie) y dos del Sector 3.
const base = () => ({ lotes: [
  { n: 1, sector: 1, area: 2500, estado: 'disponible', precio: 275000000 },
  { n: 2, sector: 1, area: 2400, estado: 'especie', precio: 264000000 },
  { n: 1, sector: 3, area: 2049.42, estado: 'disponible', precio: 225436200 },
  { n: 15, sector: 3, area: 2100.5, estado: 'disponible', precio: 231055000 }
] });
const de = (inv, sector, n) => inv.lotes.find(l => l.sector === sector && l.n === n);

test('la URL es la de la app de ventas', () => {
  assert.equal(URL_ESTADOS, 'https://ventas.urbansas.com.co/api/estados');
});

test('aplicarEstados: la app manda, por la clave del plano, sin confundir el 1 del Sector 3 con el 1', () => {
  const { inv, cambiados } = aplicarEstados(base(), [
    { id: '1', estado: 'vendido' }, { id: '3-15', estado: 'reservado' }, { id: '3-1', estado: 'disponible' }
  ]);
  assert.equal(de(inv, 1, 1).estado, 'vendido');
  assert.equal(de(inv, 3, 15).estado, 'reservado');
  assert.equal(de(inv, 3, 1).estado, 'disponible');
  assert.equal(cambiados, 2);
});

test('aplicarEstados sobre el inventario de verdad: lo que sale sigue pasando la validación del tablero', () => {
  const real = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url), 'utf8'));
  const { inv, cambiados } = aplicarEstados(real, [{ id: '3-15', estado: 'reservado' }, { id: '3-20', estado: 'vendido' }]);
  assert.equal(cambiados, 2);
  assert.equal(inv.precioM2, real.precioM2);
  validarInventario(inv);
});

test('aplicarEstados: solo cambia el estado; el área y el precio siguen siendo los del inventario', () => {
  const { inv } = aplicarEstados(base(), [{ id: '3-15', estado: 'vendido' }]);
  assert.deepEqual({ ...de(inv, 3, 15), estado: 'disponible' }, de(base(), 3, 15));
});

test('aplicarEstados: no toca el inventario que recibe', () => {
  const b = base();
  aplicarEstados(b, [{ id: '1', estado: 'vendido' }]);
  assert.equal(de(b, 1, 1).estado, 'disponible');
});

test('aplicarEstados: para los socios el lote en especie sigue en especie aunque la app lo dé «vendido»; si lo devuelve a la venta, sí cambia', () => {
  assert.equal(de(aplicarEstados(base(), [{ id: '2', estado: 'vendido' }]).inv, 1, 2).estado, 'especie');
  assert.equal(de(aplicarEstados(base(), [{ id: '2', estado: 'disponible' }]).inv, 1, 2).estado, 'disponible');
});

test('aplicarEstados: lo que no se entiende se ignora y queda el inventario', () => {
  for (const malo of [null, undefined, {}, 'x', [{ id: 1, estado: 'vendido' }], [{ id: '1', estado: 'bloqueado' }], [{ id: '1' }], [null]]) {
    const { inv, cambiados } = aplicarEstados(base(), malo);
    assert.equal(cambiados, 0, JSON.stringify(malo));
    assert.deepEqual(inv, base());
  }
});

const respuesta = (cuerpo, ok = true) => ({ ok, json: async () => cuerpo });

test('pedirEstados: devuelve la lista y no manda cookies', async () => {
  let opciones;
  const lista = [{ id: '1', estado: 'vendido' }];
  assert.deepEqual(await pedirEstados(URL_ESTADOS, 3000, async (_u, o) => { opciones = o; return respuesta(lista); }), lista);
  assert.equal(opciones.credentials, 'omit');
});

test('pedirEstados: un error, un estado distinto de 2xx o un cuerpo roto dan null', async () => {
  assert.equal(await pedirEstados(URL_ESTADOS, 3000, async () => { throw new TypeError('Failed to fetch'); }), null);
  assert.equal(await pedirEstados(URL_ESTADOS, 3000, async () => respuesta([], false)), null);
  assert.equal(await pedirEstados(URL_ESTADOS, 3000, async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } })), null);
});

test('pedirEstados: si la app no contesta en el plazo, se rinde y da null', async () => {
  const colgado = (_u, { signal }) => new Promise((_, no) => signal.addEventListener('abort', () => no(new DOMException('abort', 'AbortError'))));
  const t0 = Date.now();
  assert.equal(await pedirEstados(URL_ESTADOS, 50, colgado), null);
  assert.ok(Date.now() - t0 < 1000);
});

test('el tablero pide el inventario en un solo lugar, ya con los estados de la app, para el plano y para el detalle de las cifras', () => {
  const html = readFileSync(new URL('../socios/index.html', import.meta.url), 'utf8');
  assert.match(html, /import \{ pedirEstados, aplicarEstados \} from '\.\.\/assets\/js\/estados\.js\?v=[0-9a-f]{8}'/);
  assert.equal((html.match(/fetch\('\.\.\/data\/lotes\.json/g) ?? []).length, 1);
  assert.match(html, /aplicarEstados\(base, estados\)/);
  assert.equal((html.match(/await inventarioAlDia\(\)/g) ?? []).length, 2);
});
