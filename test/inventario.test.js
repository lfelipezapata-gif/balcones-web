import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  validarInventario, validarCasa, precioDeLote, resumenInventario, lotesDisponibles, ESTADOS,
  idLote, nombreLote
} from '../assets/js/inventario.js';

const inv = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url)));

// Los sectores 1 y 2 (lotes 1 a 14, plano radicado el 21-sep-2026) y el Sector 3
// (lotes 1 a 64, plano de José Andrés del 6-nov-2026, radicado el 20-nov-2026).
// Las cifras de siempre se prueban sobre los dos primeros; el 3 tiene las suyas.
const s12 = { ...inv, lotes: inv.lotes.filter(l => l.sector <= 2) };
const s3 = { ...inv, lotes: inv.lotes.filter(l => l.sector === 3) };
const lote = (sector, n) => inv.lotes.find(l => l.sector === sector && l.n === n);
// Las áreas del Sector 3 traen centésimas: las sumas se comparan redondeadas.
const r2 = (x) => Math.round(x * 100) / 100;

test('el inventario es válido', () => {
  assert.doesNotThrow(() => validarInventario(inv));
});

test('las 14 áreas de los sectores 1 y 2 suman 34.921 m²', () => {
  assert.equal(resumenInventario(s12).areaTotal, 34921);
});

// El englobado del Sector 3 según el plano de José Andrés del 6-nov-2026: los
// 64 lotes sin vías ni parque. El 37 no traía área escrita y va con la medida.
test('los 64 lotes del Sector 3 suman 144.326,93 m²', () => {
  assert.equal(s3.lotes.length, 64);
  assert.equal(r2(resumenInventario(s3).areaTotal), 144326.93);
  assert.equal(r2(resumenInventario(inv).areaTotal), 179247.93);
});

test('los disponibles suman 16.668 m² y valen 1.833.480.000 en los sectores 1 y 2', () => {
  const r = resumenInventario(s12);
  assert.equal(r.disponibles, 7);
  assert.equal(r.areaDisponible, 16668);
  assert.equal(r.valorDisponible, 1833480000);
});

test('el Sector 3 sale entero a la venta y vale 15.875.962.300 a precio de lista', () => {
  const r = resumenInventario(s3);
  assert.equal(r.disponibles, 64);
  assert.equal(r.valorDisponible, 15875962300);
  const todo = resumenInventario(inv);
  assert.equal(todo.disponibles, 71);
  assert.equal(todo.valorDisponible, 1833480000 + 15875962300);
});

// El lote 12 estuvo reservado unas horas el 2-sep-2026 y volvió a la venta el
// mismo día. El estado «reservado» se queda: existe, está probado y sirve el
// día que se reserve otro.
test('hoy no hay ningún lote reservado', () => {
  const r = resumenInventario(inv);
  assert.equal(r.reservados, 0);
  assert.equal(lote(2, 12).estado, 'disponible');
});

test('los colocados suman 18.253 m² y los vendidos 15.507 m²', () => {
  // Todos son de los sectores 1 y 2: el Sector 3 no ha vendido nada.
  const r = resumenInventario(inv);
  assert.equal(r.colocados, 7);
  assert.equal(r.areaColocada, 18253);
  assert.equal(r.vendidos, 6);
  assert.equal(r.areaVendida, 15507);
});

test('el precio se calcula, nunca se lee del archivo', () => {
  const lote12 = lote(2, 12);
  assert.equal(precioDeLote(lote12, inv.precioM2), 303600000);
  assert.equal('precio' in lote12, false);
  // Con centésimas el precio sale al peso, sin ruido de coma flotante.
  assert.equal(precioDeLote(lote(3, 15), inv.precioM2), 225436200);
});

test('los disponibles salen ordenados y con su precio calculado', () => {
  const d = lotesDisponibles(inv);
  assert.equal(d[0].n, 6);
  assert.equal(d.find(l => l.id === '7').precio, 234190000);
  // Primero los sectores 1 y 2, después el 3 en orden.
  assert.equal(d.length, 71);
  assert.equal(d[7].id, '3-1');
  assert.equal(d[7].nombre, 'Sector 3 · Lote 1');
  assert.equal(d.at(-1).id, '3-64');
});

test('los números van del 1 al 14 en los sectores 1 y 2 y del 1 al 64 en el 3', () => {
  const ns = (ls) => ls.map(l => l.n).sort((a, b) => a - b);
  assert.deepEqual(ns(s12.lotes), Array.from({ length: 14 }, (_, i) => i + 1));
  assert.deepEqual(ns(s3.lotes), Array.from({ length: 64 }, (_, i) => i + 1));
});

// La clave es sector + número: el lote 1 del sector 1 y el 1 del Sector 3 son
// dos lotes, pero dos «1» del Sector 3 son un repetido.
test('un lote repetido se mira por sector y número', () => {
  const uno = { n: 1, sector: 1, area: 100, estado: 'vendido' };
  const tres = { n: 1, sector: 3, area: 100, estado: 'disponible' };
  assert.doesNotThrow(() => validarInventario({ ...inv, lotes: [uno, tres] }));
  assert.throws(() => validarInventario({ ...inv, lotes: [uno, tres, { ...tres }] }), /repetido/);
  assert.equal(idLote(uno), '1');
  assert.equal(idLote(tres), '3-1');
  assert.equal(nombreLote(tres), 'Sector 3 · Lote 1');
});

test('el área acepta centésimas, no más', () => {
  const con = (area) => ({ ...inv, lotes: [{ n: 1, sector: 3, area, estado: 'disponible' }] });
  assert.doesNotThrow(() => validarInventario(con(2049.42)));
  assert.throws(() => validarInventario(con(2049.421)), /área/);
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

// ── La página de anteproyecto ───────────────────────────────────────────────
// Mismo razonamiento que la panorámica: `casa` termina como `href` en la ficha
// de venta, así que tiene que ser una página de este repositorio. Un enlace de
// afuera sacaría al visitante del sitio justo mientras decide.

const conCasa = (casa) => ({
  ...inv,
  lotes: [{ n: 1, sector: 1, area: 100, estado: 'disponible', casa }]
});

// Sin la clave, no con la clave en `undefined`: `'casa' in l` da verdadero
// igual y el validador la revisa. De un JSON nunca sale `undefined`, así que
// la única forma real de «no tener anteproyecto» es que la clave no esté.
test('acepta un lote sin página de anteproyecto', () => {
  const sin = { ...inv, lotes: [{ n: 1, sector: 1, area: 100, estado: 'disponible' }] };
  assert.doesNotThrow(() => validarInventario(sin));
});

test('acepta una página de anteproyecto del propio sitio', () => {
  assert.doesNotThrow(() => validarInventario(conCasa('data/casa-lote-6.json')));
});

test('rechaza una página de anteproyecto que apunte afuera del sitio', () => {
  for (const malo of ['https://ejemplo.com/casa.json', '//ejemplo.com/casa.json',
                      '../../secreto.json', 'data/casa-lote-6.json?x=1',
                      'data/otra-casa.json', 'casa-lote-6.json', '', 6, null]) {
    assert.throws(() => validarInventario(conCasa(malo)), /casa/,
      `debería rechazar «${malo}»`);
  }
});

// El archivo tiene que existir de verdad. Un manifiesto que no se subió da un
// 404 al abrir la ficha del único lote que hoy trae anteproyecto: la ficha
// sigue vendiendo, pero el bloque no aparece y nadie se entera de por qué.
test('el manifiesto de anteproyecto que nombra el inventario existe', () => {
  for (const l of inv.lotes) {
    if (!l.casa) continue;
    assert.ok(existsSync(new URL('../' + l.casa, import.meta.url)),
      `el lote ${l.n} apunta a ${l.casa} y ese archivo no está en el repositorio`);
  }
});

// Que el manifiesto exista no basta: adentro nombra un video, un póster y una
// docena de imágenes. Cada anteproyecto nuevo son trece archivos que se copian a
// mano, y una ruta mal escrita no rompe nada visible — la galería se salta la
// foto y el video no arranca, sin error en pantalla. Acá se revientan las dos
// cosas a la vez: que el manifiesto pase su propia validación y que todo lo que
// nombra esté de verdad en el repositorio.
test('cada anteproyecto es válido y todos sus archivos están subidos', () => {
  const manifiestos = inv.lotes.filter((l) => l.casa);
  assert.ok(manifiestos.length > 0, 'debería haber al menos un anteproyecto publicado');
  for (const l of manifiestos) {
    const casa = JSON.parse(readFileSync(new URL('../' + l.casa, import.meta.url)));
    assert.doesNotThrow(() => validarCasa(casa), `el manifiesto del lote ${l.n} no es válido`);
    for (const ruta of [casa.video, casa.poster, ...casa.imagenes.map(([src]) => src)]) {
      assert.ok(existsSync(new URL('../' + ruta, import.meta.url)),
        `el anteproyecto del lote ${l.n} nombra ${ruta} y ese archivo no está en el repositorio`);
    }
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
test('disponibles, reservados y colocados se reparten todos los lotes', () => {
  const r = resumenInventario(inv);
  assert.equal(r.disponibles + r.reservados + r.colocados, inv.lotes.length);
  assert.equal(r2(r.areaDisponible + r.areaReservada + r.areaColocada), r2(r.areaTotal));
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

// ── El área que se entrega, distinta de la que se escritura ─────────────────
// Lote 6: la subdivisión se radicó antes del movimiento de tierra, así que la
// escritura dice 2.140 m² y el lote en terreno mide 2.394. Se entrega completo.
//
// Lo que estas pruebas cuidan es que ese dato NO se cuele a ninguna de las tres
// cosas que dependen del área escriturable: el precio, los totales del sitio y
// los englobados de las escrituras. El día que alguien lo «arregle» poniendo
// 2.394 en `area`, el sector 1 se pasa 254 m² de lo que dice la matriz.

const conReal = (area, areaReal) => ({
  ...inv,
  lotes: [{ n: 1, sector: 1, area, areaReal, estado: 'disponible' }]
});

test('acepta un área entregada mayor que la escriturable', () => {
  assert.doesNotThrow(() => validarInventario(conReal(2140, 2394)));
});

test('rechaza un área entregada que no supere a la escriturable', () => {
  for (const malo of [2140, 2000, 0, -5]) {
    assert.throws(() => validarInventario(conReal(2140, malo)), /areaReal/,
      `debería rechazar areaReal=${malo}`);
  }
});

test('rechaza un área entregada que no sea entero', () => {
  for (const malo of [2394.5, '2394', null, {}]) {
    assert.throws(() => validarInventario(conReal(2140, malo)), /areaReal/,
      `debería rechazar areaReal=${JSON.stringify(malo)}`);
  }
});

// Esta es la prueba que de verdad importa. El lote 6 declara 2.394 m² de área
// entregada y el sitio NO puede cobrar por ellos ni contarlos en ningún total:
// el folio va a decir 2.140 y la escritura de la matriz no da para más.
test('el área entregada no toca el precio ni los totales', () => {
  const seis = lote(1, 6);
  assert.equal(seis.areaReal, 2394, 'el lote 6 declara el área que se entrega');
  assert.equal(seis.area, 2140, 'y escritura la que dice el plano radicado');
  assert.equal(precioDeLote(seis, inv.precioM2), 235400000,
    'el precio se calcula sobre la escriturable, no sobre la entregada');
  const r = resumenInventario(s12);
  assert.equal(r.areaTotal, 34921, 'los totales siguen siendo los escriturables');
  assert.equal(r.areaDisponible, 16668);
  assert.equal(r.valorDisponible, 1833480000);
});

// El dato llega hasta la tarjeta, que es lo que se ve antes de abrir nada.
test('los disponibles llevan el área entregada cuando la hay', () => {
  const d = lotesDisponibles(inv);
  assert.equal(d.find(l => l.id === '6').areaReal, 2394);
  assert.equal(d.find(l => l.id === '7').areaReal, null, 'el 7 no declara área entregada');
});
