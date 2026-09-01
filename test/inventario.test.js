import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validarInventario, precioDeLote, resumenInventario, lotesDisponibles
} from '../assets/js/inventario.js';

const inv = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url)));

test('el inventario es válido', () => {
  assert.doesNotThrow(() => validarInventario(inv));
});

test('las 14 áreas suman 34.921 m²', () => {
  assert.equal(resumenInventario(inv).areaTotal, 34921);
});

test('los disponibles suman 16.668 m² y valen 1.833.480.000', () => {
  const r = resumenInventario(inv);
  assert.equal(r.disponibles, 7);
  assert.equal(r.areaDisponible, 16668);
  assert.equal(r.valorDisponible, 1833480000);
});

test('los colocados suman 18.253 m² y los vendidos 15.507 m²', () => {
  const r = resumenInventario(inv);
  assert.equal(r.colocados, 7);
  assert.equal(r.areaColocada, 18253);
  assert.equal(r.vendidos, 6);
  assert.equal(r.areaVendida, 15507);
});

test('el precio se calcula, nunca se lee del archivo', () => {
  const lote12 = inv.lotes.find(l => l.n === 12);
  assert.equal(precioDeLote(lote12, inv.precioM2), 303600000);
  assert.equal('precio' in lote12, false);
});

test('los disponibles salen ordenados y con su precio calculado', () => {
  const d = lotesDisponibles(inv);
  assert.equal(d[0].n, 6);
  assert.equal(d.find(l => l.n === 7).precio, 234190000);
});

test('los números van del 1 al 14 sin huecos ni repetidos', () => {
  const ns = inv.lotes.map(l => l.n).sort((a, b) => a - b);
  assert.deepEqual(ns, Array.from({ length: 14 }, (_, i) => i + 1));
});

test('rechaza un estado inválido', () => {
  const malo = { ...inv, lotes: [{ n: 1, sector: 1, area: 100, estado: 'reservado' }] };
  assert.throws(() => validarInventario(malo), /estado/);
});

test('rechaza un lote que traiga precio escrito', () => {
  const malo = { ...inv, lotes: [{ n: 1, sector: 1, area: 100, estado: 'vendido', precio: 5 }] };
  assert.throws(() => validarInventario(malo), /precio/);
});

test('rechaza un área que no sea un entero positivo', () => {
  const malo = { ...inv, lotes: [{ n: 1, sector: 1, area: 0, estado: 'vendido' }] };
  assert.throws(() => validarInventario(malo), /área/);
});
