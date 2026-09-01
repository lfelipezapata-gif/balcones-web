import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const ruta = (f) => new URL(`../img/${f}`, import.meta.url);

// Lee ancho y alto del encabezado IHDR de un PNG, sin dependencias.
function tamanoPNG(f) {
  const b = readFileSync(ruta(f));
  assert.equal(b.subarray(1, 4).toString('ascii'), 'PNG', `${f} no es un PNG`);
  return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
}

test('están las cinco piezas de marca', () => {
  for (const f of ['logo.png', 'logo@2x.png', 'logo-sobre-oscuro.png',
                   'favicon-32.png', 'apple-touch-icon.png']) {
    assert.ok(existsSync(ruta(f)), `falta img/${f}`);
  }
});

test('el logo de encabezado mide 560 de ancho y el doble en @2x', () => {
  assert.equal(tamanoPNG('logo.png').ancho, 560);
  assert.equal(tamanoPNG('logo@2x.png').ancho, 1120);
});

test('los iconos son cuadrados y del tamaño que espera cada plataforma', () => {
  assert.deepEqual(tamanoPNG('favicon-32.png'), { ancho: 32, alto: 32 });
  assert.deepEqual(tamanoPNG('apple-touch-icon.png'), { ancho: 180, alto: 180 });
});

test('la versión sobre oscuro tiene canal alfa', () => {
  const b = readFileSync(ruta('logo-sobre-oscuro.png'));
  assert.equal(b.readUInt8(25), 6, 'el tipo de color del PNG debería ser 6 (RGBA)');
});

test('las piezas de marca pesan lo que debe pesar un logo, no una foto', () => {
  const tope = { 'logo.png': 150, 'logo@2x.png': 150, 'logo-sobre-oscuro.png': 250,
                 'favicon-32.png': 20, 'apple-touch-icon.png': 20 };
  for (const [f, kb] of Object.entries(tope)) {
    const real = Math.round(statSync(ruta(f)).size / 1024);
    assert.ok(real <= kb, `img/${f} pesa ${real} KB y el tope son ${kb} KB`);
  }
});

test('la portada pesa menos de 250 KB', () => {
  const real = Math.round(statSync(ruta('portada.jpg')).size / 1024);
  assert.ok(real <= 250, `img/portada.jpg pesa ${real} KB y el tope son 250 KB`);
});

test('el plano de lotes pesa menos de 150 KB', () => {
  const real = Math.round(statSync(ruta('mapa.jpg')).size / 1024);
  assert.ok(real <= 150, `img/mapa.jpg pesa ${real} KB y el tope son 150 KB`);
});

// El color verde/gris de cada lote vive DENTRO de img/mapa.jpg: no se puede
// pintar desde data/lotes.json porque el plano del brochure trae los lotes
// vecinos del mismo color fusionados en una sola mancha. Esta prueba es lo
// que impide que esa limitación se vuelva una mentira en pantalla: si alguien
// vende un lote y no regenera el plano, la prueba falla en vez de que el
// sitio siga mostrando en verde un lote que ya tiene dueño.
test('el plano de lotes está al día con el inventario', () => {
  const inventario = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url)));
  const huella = JSON.parse(readFileSync(ruta('mapa-estado.json')));

  const actual = Object.fromEntries(
    [...inventario.lotes].sort((a, b) => a.n - b.n).map(l => [String(l.n), l.estado])
  );

  const cambiados = Object.keys(actual)
    .filter(n => actual[n] !== huella.estados[n])
    .map(n => `lote ${n}: el plano lo muestra como «${huella.estados[n]}» y el inventario dice «${actual[n]}»`);

  assert.deepEqual(
    cambiados, [],
    'El plano de lotes quedó desactualizado:\n  ' + cambiados.join('\n  ') +
    '\n\nRegeneralo:\n' +
    '  BALCONES_MAPA_ORIGEN=<ruta al plano del brochure> python3 herramientas/preparar-mapa.py\n' +
    'Y ojo: el brochure también hay que rehacerlo antes, porque el color sale de ahí.'
  );
});
