import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validarInventario, precioDeLote, resumenInventario, lotesDisponibles, ESTADOS
} from '../assets/js/inventario.js';

const inv = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url)));

test('el inventario es válido', () => {
  assert.doesNotThrow(() => validarInventario(inv));
});

test('las 14 áreas suman 34.921 m²', () => {
  assert.equal(resumenInventario(inv).areaTotal, 34921);
});

test('los disponibles suman 13.908 m² y valen 1.529.880.000', () => {
  const r = resumenInventario(inv);
  assert.equal(r.disponibles, 6);
  assert.equal(r.areaDisponible, 13908);
  assert.equal(r.valorDisponible, 1529880000);
});

// El lote 12 salió de la venta el 2-sep-2026 por decisión del dueño. Antes de
// eso los disponibles eran 7 y sumaban 16.668 m² por $1.833.480.000.
test('el lote 12 está reservado y sus 2.760 m² no cuentan como disponibles', () => {
  const r = resumenInventario(inv);
  assert.equal(inv.lotes.find(l => l.n === 12).estado, 'reservado');
  assert.equal(r.reservados, 1);
  assert.equal(r.areaReservada, 2760);
  assert.equal(r.areaDisponible + r.areaReservada, 16668);
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
  // Decía «reservado», que el 2-sep-2026 pasó a ser un estado real. Ahora usa
  // uno que nadie va a agregar: si algún día existe, esta prueba lo avisa.
  const malo = { ...inv, lotes: [{ n: 1, sector: 1, area: 100, estado: 'permutado' }] };
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

// La panorámica de un lote es opcional: el sitio se publica con unas pocas y
// las demás entran después. Lo que no puede entrar es una ruta de afuera —
// `pano` termina dentro de un <img>/visor en la página de venta, y el día que
// alguien actualice el JSON de afán pegando un enlace, el sitio queda cargando
// una imagen de un servidor ajeno.
const conPano = (pano) => ({
  ...inv,
  lotes: [{ n: 1, sector: 1, area: 100, estado: 'disponible', pano }]
});

test('acepta un lote sin panorámica', () => {
  assert.doesNotThrow(() => validarInventario(inv));
});

test('acepta una panorámica local en img/pano', () => {
  assert.doesNotThrow(() => validarInventario(conPano('img/pano/lote-01.jpg')));
});

test('rechaza una panorámica que apunte afuera del sitio', () => {
  for (const malo of ['https://ejemplo.com/pano.jpg', '//ejemplo.com/pano.jpg',
                      '../../secreto.jpg', 'img/pano/../../portada.jpg',
                      'img/portada.jpg', 'img/pano/lote-01.png', 7, null]) {
    assert.throws(() => validarInventario(conPano(malo)), /pano/,
      `debería rechazar «${malo}»`);
  }
});

// ── El estado «reservado» ───────────────────────────────────────────────────
// Un lote que el dueño retira de la venta por un tiempo. No se vendió, no
// entró plata y sigue siendo inventario: la diferencia con «disponible» es
// solo que hoy no se puede pedir. Decisión del 2-sep-2026, por el lote 12.

const conEstado = (estado) => ({
  ...inv,
  lotes: [
    { n: 1, sector: 1, area: 1000, estado: 'disponible' },
    { n: 2, sector: 1, area: 2000, estado }
  ]
});

test('«reservado» es un estado válido del inventario', () => {
  assert.ok(ESTADOS.includes('reservado'));
  assert.doesNotThrow(() => validarInventario(conEstado('reservado')));
});

test('un lote reservado no se cuenta como disponible ni suma a su valor', () => {
  const r = resumenInventario(conEstado('reservado'));
  assert.equal(r.disponibles, 1);
  assert.equal(r.areaDisponible, 1000);
  assert.equal(r.valorDisponible, 1000 * inv.precioM2);
});

test('un lote reservado no se cuenta como vendido ni como colocado', () => {
  const r = resumenInventario(conEstado('reservado'));
  assert.equal(r.vendidos, 0);
  assert.equal(r.colocados, 0, 'reservado no es colocado: no entró plata por él');
  assert.equal(r.reservados, 1);
  assert.equal(r.areaReservada, 2000);
});

test('un lote reservado no aparece entre los que se pueden pedir', () => {
  assert.deepEqual(lotesDisponibles(conEstado('reservado')).map(l => l.n), [1]);
});

// Los tres grupos tienen que repartirse los 14 lotes sin dejar ninguno afuera
// ni contar ninguno dos veces. Es la cuenta que se rompe cuando alguien agrega
// un estado y se olvida de meterlo en algún grupo del resumen.
test('disponibles, reservados y colocados se reparten los 14 lotes', () => {
  const r = resumenInventario(inv);
  assert.equal(r.disponibles + r.reservados + r.colocados, inv.lotes.length);
  assert.equal(r.areaDisponible + r.areaReservada + r.areaColocada, r.areaTotal);
});

// ── Las coordenadas del lote ────────────────────────────────────────────────
// Las escribe herramientas/preparar-aereo.py convirtiendo el CAD de EPSG:9377
// a WGS84. La caja de validación es Santa Rosa de Osos y sus alrededores: una
// coordenada fuera de ahí es un error de conversión, y un alfiler en el
// departamento equivocado es peor que ningún alfiler.
const conCoord = (lat, lon) => ({
  ...inv,
  lotes: [{ n: 1, sector: 1, area: 100, estado: 'disponible', lat, lon }]
});

test('acepta una coordenada dentro de Santa Rosa', () => {
  assert.doesNotThrow(() => validarInventario(conCoord(6.6505, -75.4455)));
});

test('rechaza una coordenada fuera de la zona', () => {
  for (const [lat, lon] of [[0, 0], [6.65, 75.44], [40.7, -74.0], [-6.65, -75.44]]) {
    assert.throws(() => validarInventario(conCoord(lat, lon)), /coordenada/,
      `debería rechazar ${lat}, ${lon}`);
  }
});

test('rechaza media coordenada', () => {
  const media = { ...inv, lotes: [{ n: 1, sector: 1, area: 100, estado: 'disponible', lat: 6.65 }] };
  assert.throws(() => validarInventario(media), /coordenada/);
});
