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
