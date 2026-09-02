import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirVistaVitrina } from '../assets/js/vitrina.js';

const inv = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url)));

test('el titular sale del inventario, no está escrito a mano', () => {
  const v = construirVistaVitrina(inv);
  assert.equal(v.titular, 'Los 6 que quedan');
});

test('si se vende uno, el titular baja solo', () => {
  const menos = { ...inv, lotes: inv.lotes.map(l => l.n === 6 ? { ...l, estado: 'vendido' } : l) };
  assert.equal(construirVistaVitrina(menos).titular, 'Los 5 que quedan');
});

// El lote 12 se reservó el 2-sep-2026 y el titular bajó de 7 a 6 sin que nadie
// escribiera un número: reservar es sacar de la venta, igual que vender.
test('reservar un lote lo saca del titular igual que venderlo', () => {
  const libre = { ...inv, lotes: inv.lotes.map(l => l.n === 12 ? { ...l, estado: 'disponible' } : l) };
  assert.equal(construirVistaVitrina(libre).titular, 'Los 7 que quedan');
});

test('con un solo lote el titular va en singular', () => {
  const uno = { ...inv, lotes: inv.lotes.map(l => l.n === 6 ? l : ({ ...l, estado: 'vendido' })) };
  assert.equal(construirVistaVitrina(uno).titular, 'Queda 1');
});

test('el subtítulo trae área y valor de lo disponible', () => {
  const v = construirVistaVitrina(inv);
  assert.match(v.subtitulo, /13\.908 m²/);
  assert.match(v.subtitulo, /\$110\.000/);
});

test('hay una tarjeta por lote disponible, con su precio formateado', () => {
  const v = construirVistaVitrina(inv);
  assert.equal(v.tarjetas.length, 6);
  const trece = v.tarjetas.find(t => t.n === 13);
  assert.equal(trece.precioTexto, '$299.090.000');
  assert.equal(trece.areaTexto, '2.719 m²');
});

test('ni los colocados ni el reservado aparecen entre los disponibles', () => {
  const ns = construirVistaVitrina(inv).tarjetas.map(t => t.n);
  assert.deepEqual(ns, [6, 7, 8, 9, 11, 13]);
});
