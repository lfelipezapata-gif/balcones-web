import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pesos, metros, pesosConSigno, porcentaje } from '../assets/js/formato.js';

test('pesos usa punto de miles y no lleva decimales', () => {
  assert.equal(pesos(1833480000), '$1.833.480.000');
  assert.equal(pesos(0), '$0');
});

test('metros usa punto de miles y lleva la unidad', () => {
  assert.equal(metros(16668), '16.668 m²');
  assert.equal(metros(2140), '2.140 m²');
});

test('pesosConSigno pone el signo al frente, no detrás del signo de pesos', () => {
  assert.equal(pesosConSigno(5000000), '+$5.000.000');
  assert.equal(pesosConSigno(-5000000), '-$5.000.000');
  assert.notEqual(pesosConSigno(-5000000), '$-5.000.000');
});

test('pesosConSigno deja el cero sin signo: no es de más ni de menos', () => {
  assert.equal(pesosConSigno(0), '$0');
  assert.equal(pesosConSigno(-0), '$0');
  assert.equal(pesosConSigno(0.4), '$0', 'menos de un peso redondea a cero, sin signo');
  assert.equal(pesosConSigno(-0.4), '$0');
});

test('porcentaje convierte la fracción de la hoja en algo legible', () => {
  assert.equal(porcentaje(0.33), '33 %');
  assert.equal(porcentaje(0.11), '11 %');
  assert.equal(porcentaje(0.06), '6 %');
  assert.equal(porcentaje(1), '100 %');
  assert.equal(porcentaje(0), '0 %');
});

test('porcentaje conserva hasta dos decimales en vez de redondearlos a un entero', () => {
  assert.equal(porcentaje(0.115), '11,5 %');
  assert.equal(porcentaje(0.0625), '6,25 %');
});
