import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirVistaVitrina } from '../assets/js/vitrina.js';

const inv = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url)));

test('el titular sale del inventario, no está escrito a mano', () => {
  const v = construirVistaVitrina(inv);
  assert.equal(v.titular, 'Los 7 que quedan');
});

test('si se vende uno, el titular baja solo', () => {
  const menos = { ...inv, lotes: inv.lotes.map(l => l.n === 6 ? { ...l, estado: 'vendido' } : l) };
  assert.equal(construirVistaVitrina(menos).titular, 'Los 6 que quedan');
});

test('con un solo lote el titular va en singular', () => {
  const uno = { ...inv, lotes: inv.lotes.map(l => l.n === 6 ? l : ({ ...l, estado: 'vendido' })) };
  assert.equal(construirVistaVitrina(uno).titular, 'Queda 1');
});

test('el subtítulo trae área y valor de lo disponible', () => {
  const v = construirVistaVitrina(inv);
  assert.match(v.subtitulo, /16\.668 m²/);
  assert.match(v.subtitulo, /\$110\.000/);
});

test('hay una tarjeta por lote disponible, con su precio formateado', () => {
  const v = construirVistaVitrina(inv);
  assert.equal(v.tarjetas.length, 7);
  const doce = v.tarjetas.find(t => t.n === 12);
  assert.equal(doce.precioTexto, '$303.600.000');
  assert.equal(doce.areaTexto, '2.760 m²');
});

test('los lotes vendidos y el de especie no aparecen como disponibles', () => {
  const ns = construirVistaVitrina(inv).tarjetas.map(t => t.n);
  assert.deepEqual(ns, [6, 7, 8, 9, 11, 12, 13]);
});
