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

// ── La pista: decirle a la gente qué hacer con el plano ─────────────────────
// Sin esto el plano es un dibujo bonito y nadie lo toca. La frase sale del
// dato y no escrita a mano, porque lo que promete —la vista en 360°— depende
// de que las panorámicas existan de verdad.

// Se quitan primero las panorámicas que el inventario real ya trae y después
// se ponen solo las que pide la prueba. Sin ese borrado, pedir «solo dos» deja
// las seis de verdad y la prueba mide otra cosa.
const conPanos = (ns) => ({
  ...inv,
  lotes: inv.lotes.map(({ pano, ...l }) =>
    ns.includes(l.n) ? { ...l, pano: `img/pano/lote-${String(l.n).padStart(2, '0')}.jpg` } : l)
});

test('si todos los disponibles tienen 360, la pista lo promete sin condiciones', () => {
  const v = construirVistaVitrina(conPanos([6, 7, 8, 9, 11, 13]));
  assert.match(v.pista, /360/);
  assert.doesNotMatch(v.pista, /\d+ de \d+/, 'no hay por qué matizar si están todas');
});

test('si solo algunos tienen 360, la pista dice cuántos', () => {
  const v = construirVistaVitrina(conPanos([6, 7]));
  assert.match(v.pista, /360/);
  assert.match(v.pista, /2 de 6/);
});

// El día que se venda todo lo que tiene panorámica, prometer una vista que no
// existe es peor que no prometer nada.
test('sin ninguna panorámica la pista no promete 360', () => {
  const v = construirVistaVitrina(conPanos([]));
  assert.doesNotMatch(v.pista, /360/);
  assert.match(v.pista, /precio/);
});

test('cada tarjeta sabe si su lote tiene vista en 360', () => {
  const v = construirVistaVitrina(conPanos([6, 7]));
  assert.equal(v.tarjetas.find(t => t.n === 6).tiene360, true);
  assert.equal(v.tarjetas.find(t => t.n === 9).tiene360, false);
});
