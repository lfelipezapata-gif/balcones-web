import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirFichaLote, configPano, WHATSAPP } from '../assets/js/ficha.js';
import { ESTADOS } from '../assets/js/inventario.js';
import { existsSync, statSync } from 'node:fs';

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

// Estos dos inventarios se arman a mano en vez de retocar data/lotes.json. Si
// se apoyaran en el archivo real, el día que entre la panorámica del lote 7 la
// prueba «sin panorámica» empezaría a fallar sola, sin que nada esté mal.
const sinPano = { ...inv, lotes: [{ n: 7, sector: 1, area: 2129, estado: 'disponible' }] };
const conPano = { ...sinPano, lotes: [{ ...sinPano.lotes[0], pano: 'img/pano/lote-07.jpg' }] };

// El hueco del 360: mientras no haya foto, la ficha no debe inventar nada.
test('sin panorámica la ficha viene con pano en null', () => {
  assert.equal(construirFichaLote(sinPano, 7).pano, null);
});

test('con panorámica la ficha la pasa tal cual', () => {
  assert.equal(construirFichaLote(conPano, 7).pano, 'img/pano/lote-07.jpg');
});

// ── El visor 360 ────────────────────────────────────────────────────────────

test('el visor recibe la panorámica como equirectangular', () => {
  const c = configPano(construirFichaLote(conPano, 7));
  assert.equal(c.type, 'equirectangular');
  assert.equal(c.panorama, 'img/pano/lote-07.jpg');
});

// El corte de arriba existe por el hueco del cenit: el gimbal del dron puede
// no alcanzar a mirar derecho hacia arriba y dejar un tapón donde debería ir
// el cielo. Medido sobre el vuelo del 2-sep-2026, en el Mini 5 Pro ese hueco
// es de 1 a 5 grados y está relleno de azul de cielo, así que el corte quedó
// en 85° y es casi todo el domo — pero sigue existiendo, y esta prueba lo
// sostiene para que nadie lo suba a 90 sin haber mirado una panorámica.
//
// Mirar hacia abajo sí está permitido: el dron sí fotografía el nadir, y el
// suelo es justamente el lote que está vendiendo.
test('el visor no deja llegar al hueco del cenit', () => {
  const c = configPano(construirFichaLote(conPano, 7));
  assert.ok(c.maxPitch < 90, 'maxPitch tiene que cortar antes del cenit');
  assert.ok(c.maxPitch > 0, 'maxPitch por debajo del horizonte dejaría ver solo el piso');
  assert.equal(c.minPitch, -90);
});

test('sin panorámica no hay configuración de visor', () => {
  assert.equal(configPano(construirFichaLote(sinPano, 7)), null);
});

// Pannellum va servido desde el repositorio, no desde un CDN: la página de
// venta no depende de que un tercero siga en línea, y funciona igual en el
// portátil de una reunión sin internet.
test('Pannellum está en vendor y pesa lo que debe pesar una librería', () => {
  for (const [f, kb] of Object.entries({ 'pannellum.js': 120, 'pannellum.css': 30 })) {
    const ruta = new URL(`../vendor/${f}`, import.meta.url);
    assert.ok(existsSync(ruta), `falta vendor/${f}`);
    const real = Math.round(statSync(ruta).size / 1024);
    assert.ok(real <= kb, `vendor/${f} pesa ${real} KB y el tope son ${kb} KB`);
  }
});

// La ficha se puede abrir a pantalla completa. Es lo unico que hace usable el
// 360 en un telefono: dentro del modal la vista mide ~290x360 y a pantalla
// completa 375x690, casi cuatro veces el area.
//
// Se comprueba el marcado y no el comportamiento porque el comportamiento es
// puro DOM y CSS. Lo que esta prueba impide es que alguien borre uno de los
// tres pedazos y deje el boton sin salida o la barra sin boton.
test('el marcado trae los tres pedazos de la pantalla completa', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [clase, para] of [
    ['ficha-agrandar', 'el botón que entra a pantalla completa'],
    ['ficha-reducir', 'el botón que sale de pantalla completa'],
    ['ficha-barra-texto', 'el lote, el área y el precio mientras se mira la vista']
  ]) {
    assert.ok(html.includes(`class="${clase}"`) || html.includes(`"${clase}"`),
      `index.html no trae .${clase}: falta ${para}`);
  }
});

// Sin `.agrandada` el <dialog> se queda del tamaño del modal y la vista no
// crece: el boton quedaria puesto y sin efecto.
test('el CSS define el modo agrandado del diálogo', () => {
  const css = readFileSync(new URL('../assets/css/estilos.css', import.meta.url), 'utf8');
  assert.match(css, /\.ficha\.agrandada\s*\{/, 'falta la regla .ficha.agrandada');
  assert.match(css, /\.ficha\.agrandada\s+\.ficha-pano\b/, 'la vista no se estira al agrandar');
});

// ── El enlace al mapa ───────────────────────────────────────────────────────
// «A 3,5 km del parque» no le dice nada a alguien que no conoce Santa Rosa.
// El alfiler sí: abre Google Maps en el punto exacto del lote y desde ahí se
// ve el satélite, la vía de llegada y cuánto hay hasta el pueblo.
const conCoords = {
  ...inv,
  lotes: [{ n: 7, sector: 1, area: 2129, estado: 'disponible',
            lat: 6.650564, lon: -75.44552 }]
};

test('la ficha arma el enlace al mapa con la coordenada del lote', () => {
  const f = construirFichaLote(conCoords, 7);
  const u = new URL(f.mapa);
  assert.equal(u.host, 'www.google.com');
  assert.equal(u.searchParams.get('query'), '6.650564,-75.44552');
});

test('sin coordenada no hay enlace, en vez de uno que caiga en el mar', () => {
  const sin = { ...inv, lotes: [{ n: 7, sector: 1, area: 2129, estado: 'disponible' }] };
  assert.equal(construirFichaLote(sin, 7).mapa, null);
});

// Un lote colocado también se puede ubicar: quien mira quiere saber dónde
// quedó lo que se vendió. Lo que no lleva es el botón de pedirlo.
test('un lote vendido también trae su enlace al mapa', () => {
  const vend = { ...conCoords, lotes: [{ ...conCoords.lotes[0], estado: 'vendido' }] };
  const f = construirFichaLote(vend, 7);
  assert.equal(f.whatsapp, null);
  assert.ok(f.mapa);
});
