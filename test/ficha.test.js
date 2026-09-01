import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirFichaLote, WHATSAPP } from '../assets/js/ficha.js';
import { ESTADOS } from '../assets/js/inventario.js';

const inv = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url)));

test('la ficha trae el área y el precio ya formateados', () => {
  const f = construirFichaLote(inv, 7);
  assert.equal(f.titulo, 'Lote 7');
  assert.equal(f.sector, 1);
  assert.equal(f.areaTexto, '2.129 m²');
  assert.equal(f.precioTexto, '$234.190.000');
  assert.equal(f.precioM2Texto, '$110.000');
});

test('el precio se calcula, no se lee', () => {
  const caro = { ...inv, precioM2: 120000 };
  assert.equal(construirFichaLote(caro, 7).precioTexto, '$255.480.000');
});

test('cada estado tiene su rótulo y solo el disponible se puede pedir', () => {
  assert.deepEqual(
    [6, 1, 2].map(n => {
      const f = construirFichaLote(inv, n);
      return [f.estado, f.estadoTexto, f.disponible];
    }),
    [
      ['disponible', 'Disponible', true],
      ['vendido', 'Vendido', false],
      ['especie', 'Pago en especie', false]
    ]
  );
});

// Si mañana entra un estado nuevo en el inventario —«reservado», por ejemplo—
// la ficha lo mostraría como «undefined» en una página de venta y nada se
// quejaría. Esta prueba obliga a que el rótulo se escriba junto con el estado.
test('no hay estado del inventario sin rótulo en la ficha', () => {
  for (const estado of ESTADOS) {
    const uno = { ...inv, lotes: [{ n: 1, sector: 1, area: 2000, estado }] };
    const f = construirFichaLote(uno, 1);
    assert.equal(typeof f.estadoTexto, 'string', `el estado «${estado}» no tiene rótulo`);
    assert.ok(f.estadoTexto.length > 0, `el estado «${estado}» tiene rótulo vacío`);
  }
});

test('el enlace de WhatsApp dice cuál lote están mirando', () => {
  const f = construirFichaLote(inv, 7);
  const texto = decodeURIComponent(new URL(f.whatsapp).searchParams.get('text'));
  assert.match(texto, /lote 7/);
  assert.match(texto, /2\.129 m²/);
  assert.ok(f.whatsapp.startsWith(`https://wa.me/${WHATSAPP}?`));
});

// Un lote colocado sigue abriendo ficha —el comprador quiere ver qué se vendió
// y a cómo— pero no puede llevar un botón que invite a pedirlo.
test('un lote que ya no está en venta no trae enlace de WhatsApp', () => {
  assert.equal(construirFichaLote(inv, 1).whatsapp, null);
  assert.equal(construirFichaLote(inv, 2).whatsapp, null);
});

test('el número de WhatsApp de la ficha es el mismo del pie de página', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(
    html.includes(`https://wa.me/${WHATSAPP}`),
    `index.html no usa el número ${WHATSAPP} que usa la ficha`
  );
});

test('pedir un lote que no existe falla con el número adentro', () => {
  assert.throws(() => construirFichaLote(inv, 99), /99/);
});

// El hueco del 360: mientras no haya foto, la ficha no debe inventar nada.
test('sin panorámica la ficha viene con pano en null', () => {
  assert.equal(construirFichaLote(inv, 7).pano, null);
});

test('con panorámica la ficha la pasa tal cual', () => {
  const con = {
    ...inv,
    lotes: inv.lotes.map(l => l.n === 7 ? { ...l, pano: 'img/pano/lote-07.jpg' } : l)
  };
  assert.equal(construirFichaLote(con, 7).pano, 'img/pano/lote-07.jpg');
});
