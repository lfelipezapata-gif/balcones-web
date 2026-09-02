// El plano de lotes: geometría contra inventario.
//
// La prueba que importa de todo este archivo es la primera: el área que
// encierra cada <path> de img/mapa.svg tiene que coincidir con el área que
// declara data/lotes.json. Ese es el único amarre confiable entre el dibujo
// del arquitecto y el número comercial del lote — no el orden, no la posición.
// Este proyecto ya cruzó la numeración dos veces.
//
// El área se calcula del atributo `d` de verdad, no de un metadato al lado:
// lo que se comprueba es lo que se dibuja. Se puede porque el SVG está en
// metros — una unidad del viewBox es un metro de terreno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { construirVistaMapa, pintarMapa } from '../assets/js/mapa.js';

const SVG = readFileSync(new URL('../img/mapa.svg', import.meta.url), 'utf8');
const INV = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url), 'utf8'));

// Englobados de las escrituras. Son la cifra contra la que tiene que cerrar
// la suma de cada sector, y no es negociable.
const ENGLOBADO = { 1: 26442, 2: 8479 };
const TOLERANCIA = 0.01;

// Lee los <path class="lote"> del SVG: número de lote y lista de vértices.
// El generador escribe solo M/L/Z, así que alcanza con leer los pares.
function poligonos() {
  const salida = new Map();
  const re = /<path class="lote" id="lote-(\d+)" data-lote="(\d+)" d="([^"]+)"\/>/g;
  let m;
  while ((m = re.exec(SVG))) {
    assert.equal(m[1], m[2], `el id y el data-lote del lote ${m[1]} no coinciden`);
    const d = m[3];
    assert.match(d, /^M[-\d. L]+Z$/, `el lote ${m[1]} trae comandos que esta prueba no lee: ${d.slice(0, 40)}`);
    const pts = d.slice(1, -1).split('L').map(par => par.trim().split(/\s+/).map(Number));
    for (const [x, y] of pts) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `el lote ${m[1]} trae un vértice ilegible`);
    }
    salida.set(Number(m[1]), pts);
  }
  return salida;
}

function area(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

test('cada polígono del plano encierra el área que declara el inventario', () => {
  const polis = poligonos();
  const fuera = [];
  for (const l of INV.lotes) {
    const pts = polis.get(l.n);
    assert.ok(pts, `el lote ${l.n} no tiene <path> en img/mapa.svg`);
    const error = Math.abs(area(pts) - l.area) / l.area;
    if (error > TOLERANCIA) {
      fuera.push(`lote ${l.n}: el plano encierra ${area(pts).toFixed(1)} m² y el ` +
                 `inventario dice ${l.area} m² (${(error * 100).toFixed(2)} % de error)`);
    }
  }
  assert.deepEqual(fuera, [],
    'El plano no cuadra con el inventario. Está mal emparejado y no se publica:\n  ' +
    fuera.join('\n  '));
});

test('las áreas del plano suman los englobados de las escrituras', () => {
  const polis = poligonos();
  let total = 0;
  for (const [s, cerrar] of Object.entries(ENGLOBADO)) {
    const suma = INV.lotes
      .filter(l => l.sector === Number(s))
      .reduce((t, l) => t + area(polis.get(l.n)), 0);
    total += suma;
    assert.ok(Math.abs(suma - cerrar) / cerrar <= TOLERANCIA,
      `el sector ${s} suma ${suma.toFixed(0)} m² en el plano y el englobado dice ${cerrar} m²`);
  }
  const cerrarTodo = Object.values(ENGLOBADO).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - cerrarTodo) / cerrarTodo <= TOLERANCIA,
    `el plano suma ${total.toFixed(0)} m² y los englobados suman ${cerrarTodo} m²`);
});

test('hay un polígono por lote del inventario, y ninguno de más', () => {
  const enElPlano = [...poligonos().keys()].sort((a, b) => a - b);
  const enElDato = INV.lotes.map(l => l.n).sort((a, b) => a - b);
  assert.deepEqual(enElPlano, enElDato);
});

test('el plano no trae ningún color ni ningún estado escrito adentro', () => {
  // Si el color viviera en el SVG volveríamos al defecto del JPG: dos
  // versiones del mismo dato, y la de la pantalla desactualizándose sola.
  for (const patron of [/fill\s*[=:]/i, /stroke\s*[=:]/i, /style\s*=/i,
                        /#[0-9a-f]{3,6}\b/i, /\bdata-estado\b/]) {
    assert.ok(!patron.test(SVG), `img/mapa.svg trae ${patron} adentro`);
  }
  for (const estado of ['disponible', 'vendido', 'especie', 'verde', 'gris']) {
    assert.ok(!SVG.includes(estado), `img/mapa.svg menciona «${estado}»`);
  }
});

test('el plano tampoco trae los números ni las áreas escritos', () => {
  // Los rótulos salen del inventario en tiempo de pintado. Si estuvieran
  // escritos en el SVG podrían decir un área distinta a la de la tarjeta de
  // al lado.
  assert.match(SVG, /<text class="numero"[^>]*><\/text>/,
    'los <text> del número deberían venir vacíos');
  assert.match(SVG, /<text class="area"[^>]*><\/text>/,
    'los <text> del área deberían venir vacíos');
  assert.ok(!/>\s*2\.\d{3}\s*m/.test(SVG), 'img/mapa.svg trae un área escrita');
});

test('el plano pesa lo que debe pesar un dibujo vectorial', () => {
  const kb = Buffer.byteLength(SVG, 'utf8') / 1024;
  assert.ok(kb <= 40, `img/mapa.svg pesa ${kb.toFixed(1)} KB y el tope son 40 KB`);
});

test('los dos sectores van a la misma escala', () => {
  // Agrandar un sector para llenar su panel haría ver dos lotes del mismo
  // tamaño de tamaños distintos en una página de venta. La comprobación:
  // metro de terreno por unidad de dibujo, sector contra sector.
  const polis = poligonos();
  const escalas = Object.keys(ENGLOBADO).map(s => {
    const lotes = INV.lotes.filter(l => l.sector === Number(s));
    const dibujado = lotes.reduce((t, l) => t + area(polis.get(l.n)), 0);
    const real = lotes.reduce((t, l) => t + l.area, 0);
    return dibujado / real;
  });
  assert.ok(Math.abs(escalas[0] - escalas[1]) / escalas[0] < 0.02,
    `los sectores están dibujados a escalas distintas: ${escalas.join(' vs ')}`);
});

// ---- la vista que arma los rótulos y los estados ------------------------

test('la vista le pone a cada lote su estado, su número y su área', () => {
  const v = construirVistaMapa(INV);
  assert.equal(v.lotes.length, INV.lotes.length);
  const seis = v.lotes.find(l => l.n === 6);
  assert.equal(seis.estado, 'disponible');
  assert.equal(seis.numeroTexto, '6');
  assert.equal(seis.areaTexto, '2.140 m²');
  assert.equal(seis.descripcion, 'Lote 6 · 2.140 m² · disponible');
});

test('el pago en especie no se anuncia como disponible ni se llama vendido', () => {
  const v = construirVistaMapa(INV);
  const dos = v.lotes.find(l => l.n === 2);
  assert.equal(dos.estado, 'especie');
  assert.match(dos.descripcion, /pago en especie/);
  assert.ok(!dos.descripcion.includes('disponible'));
});

test('si se vende un lote, el plano lo pinta gris sin tocar el SVG', () => {
  const antes = construirVistaMapa(INV);
  assert.equal(antes.lotes.find(l => l.n === 6).estado, 'disponible');

  const vendido = { ...INV, lotes: INV.lotes.map(l => l.n === 6 ? { ...l, estado: 'vendido' } : l) };
  const despues = construirVistaMapa(vendido);
  assert.equal(despues.lotes.find(l => l.n === 6).estado, 'vendido');
  assert.equal(despues.lotes.find(l => l.n === 6).descripcion, 'Lote 6 · 2.140 m² · vendido');
  assert.equal(despues.titulo,
    'Plano del loteo. 5 lotes disponibles en verde, 8 colocados en gris, 1 reservado en dorado.');
  // Y el archivo del plano no se tocó: la misma geometría sirve para los dos.
  assert.equal(readFileSync(new URL('../img/mapa.svg', import.meta.url), 'utf8'), SVG);
});

test('el título del plano cuenta lo mismo que el titular de la vitrina', () => {
  const v = construirVistaMapa(INV);
  const cuenta = (e) => INV.lotes.filter(l => l.estado === e).length;
  const disponibles = cuenta('disponible');
  const reservados = cuenta('reservado');
  const colocados = cuenta('vendido') + cuenta('especie');
  assert.equal(v.titulo,
    `Plano del loteo. ${disponibles} lotes disponibles en verde, ` +
    `${colocados} colocados en gris, ${reservados} reservado en dorado.`);
});

test('el título de cada sector sale del inventario, no está escrito a mano', () => {
  const v = construirVistaMapa(INV);
  assert.deepEqual(v.sectores, [
    { sector: 1, texto: 'Sector 1 · lotes 1 a 11' },
    { sector: 2, texto: 'Sector 2 · lotes 12 a 14' }
  ]);
});

test('un sector con lotes salteados no miente diciendo «de tal a tal»', () => {
  const v = construirVistaMapa({
    precioM2: 110000,
    lotes: [
      { n: 1, sector: 1, area: 100, estado: 'disponible' },
      { n: 4, sector: 1, area: 100, estado: 'vendido' }
    ]
  });
  assert.deepEqual(v.sectores, [{ sector: 1, texto: 'Sector 1 · 2 lotes' }]);
});

// ---- el pintado sobre el SVG -------------------------------------------
//
// Un SVG de mentira, con lo justo que usa pintarMapa. No hay navegador en las
// pruebas y traer uno entero para comprobar cuatro querySelector no se paga.
function svgDeMentira(numeros) {
  const nodo = (clase, datos, hijos = []) => ({
    clase, dataset: datos, hijos, textContent: '', atributos: {},
    setAttribute(k, v) { this.atributos[k] = v; },
    appendChild(h) { this.hijos.push(h); return h; },
    querySelector(sel) { return this.hijos.find(h => h.clase === sel.replace('.', '')) ?? null; }
  });
  const todos = [nodo('mapa-titulo', {})];
  for (const n of numeros) {
    todos.push(nodo('lote', { lote: String(n) }));
    todos.push(nodo('rotulo-lote', { lote: String(n) }, [nodo('numero', {}), nodo('area', {})]));
  }
  return {
    todos,
    querySelectorAll: () => todos.filter(t => t.clase === 'lote'),
    querySelector(sel) {
      if (sel === '#mapa-titulo') return todos.find(t => t.clase === 'mapa-titulo');
      const m = sel.match(/^\.(lote|rotulo-lote)\[data-lote="(\d+)"\]$/);
      if (m) return todos.find(t => t.clase === m[1] && t.dataset.lote === m[2]) ?? null;
      return null;   // los títulos de sector no hacen falta para esto
    }
  };
}

test('pintar le pone a cada polígono el estado que dice el inventario', () => {
  const svg = svgDeMentira(INV.lotes.map(l => l.n));
  globalThis.document = { createElementNS: () => ({ textContent: '' }) };
  try {
    pintarMapa(svg, INV);
  } finally {
    delete globalThis.document;
  }
  const estado = (n) => svg.todos.find(t => t.clase === 'lote' && t.dataset.lote === String(n)).atributos['data-estado'];
  assert.equal(estado(6), 'disponible');
  assert.equal(estado(1), 'vendido');
  assert.equal(estado(2), 'especie');
  assert.equal(estado(12), 'reservado');
  const verdes = svg.todos.filter(t => t.clase === 'lote' && t.atributos['data-estado'] === 'disponible');
  assert.equal(verdes.length, 6);
});

test('pintar se niega si el plano y el inventario no hablan de los mismos lotes', () => {
  // Es el caso peligroso: alguien agrega el lote 15 al inventario y no
  // regenera el plano. Callar acá deja un lote sin dibujo y, peor, invita a
  // que el siguiente cambio corra la numeración sin que nada avise.
  const faltaElPlano = svgDeMentira(INV.lotes.map(l => l.n).filter(n => n !== 9));
  assert.throws(() => pintarMapa(faltaElPlano, INV), /Sin polígono en img\/mapa\.svg: 9/);

  const sobraEnElPlano = svgDeMentira([...INV.lotes.map(l => l.n), 15]);
  assert.throws(() => pintarMapa(sobraEnElPlano, INV), /Sin dato en data\/lotes\.json: 15/);
});

test('un inventario inválido no llega a pintarse', () => {
  assert.throws(() => construirVistaMapa({ precioM2: 110000, lotes: [] }));
  assert.throws(() => construirVistaMapa({
    precioM2: 110000,
    lotes: [{ n: 1, sector: 1, area: 100, estado: 'permutado' }]
  }));
});
