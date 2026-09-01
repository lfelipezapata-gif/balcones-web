// Los paneles del tablero rediseñado.
//
// Todo lo que se prueba acá entra por `construirVistaTablero`, no por el JSON
// crudo del Worker: esa es la frontera donde se escapa el texto de la hoja, y
// las pruebas de inyección de abajo existen para fijar que los paneles no la
// saltan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { construirVistaTablero } from '../assets/js/tablero.js';
import {
  construirCifras, construirVistaLotes, construirVistaGastos,
  mencionaVencido, porcentajePagado
} from '../assets/js/paneles.js';

const INV = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url), 'utf8'));
const AHORA = new Date('2026-08-31T22:00:00.000Z');

// Datos inventados, con nombres que no existen. Los números son de juguete.
const TABLERO = {
  leidoEn: '2026-08-31T21:58:00.000Z',
  desdeCache: false,
  resumen: {
    vendido: 1500000000, abonado: 515000000, porCobrar: 985000000,
    disponible: 1833480000, gastadoObra: 620000000, caja: 48000000
  },
  cartera: [
    {
      lote: 1, area: 2754, comprador: 'Compradora de prueba',
      precio: 200000000, abonado: 50000000, saldo: 150000000,
      proximaCuotaFecha: '2027-02-19', proximaCuotaValor: 54000000,
      estado: 'Promesa firmada',
      abonos: [{ fecha: '2026-08-25', valor: 50000000, medio: 'Transferencia' }]
    },
    {
      lote: 5, area: 2200, comprador: 'Comprador de prueba dos',
      precio: 100000000, abonado: 40000000, saldo: 60000000,
      proximaCuotaFecha: 'vencidos el 24-ago-2026', proximaCuotaValor: 10000000,
      estado: 'Promesa firmada', abonos: []
    }
  ],
  egresos: [
    { fecha: '2026-04-29', categoria: 'Acueducto', concepto: 'Red principal', valor: 90000000 },
    { fecha: '2026-05-10', categoria: 'Acueducto', concepto: 'Ramal', valor: 10000000 },
    { fecha: '2026-03-31', categoria: 'Adecuaciones', concepto: 'Eugenios', valor: 25000000 }
  ],
  avisos: []
};

const vistaDe = (t = TABLERO) => construirVistaTablero(t, AHORA);
const fichaDe = (n, t = TABLERO) =>
  construirVistaLotes(vistaDe(t), INV).fichas.find(f => f.n === n);

// ---- las seis cifras ----------------------------------------------------

test('las seis cifras conservan su valor y acortan los dos rótulos largos', () => {
  const c = construirCifras(vistaDe().resumen);
  assert.equal(c.length, 6);
  assert.deepEqual(c.map(x => x.etiqueta),
    ['Vendido', 'Abonado', 'Por cobrar', 'Inventario', 'Obra', 'Caja']);
  assert.equal(c.find(x => x.etiqueta === 'Inventario').texto, '$1.833.480.000');
});

test('una cifra en null llega al panel como raya, no como cero', () => {
  const roto = { ...TABLERO, resumen: { ...TABLERO.resumen, caja: null, vendido: null } };
  const c = construirCifras(vistaDe(roto).resumen);
  assert.equal(c.find(x => x.etiqueta === 'Caja').texto, '—');
  assert.equal(c.find(x => x.etiqueta === 'Vendido').texto, '—');
  assert.ok(!c.some(x => x.texto === '$0'), 'ningún null puede salir como $0');
});

test('un cero de verdad sí se muestra como $0', () => {
  const enCero = { ...TABLERO, resumen: { ...TABLERO.resumen, caja: 0 } };
  const c = construirCifras(vistaDe(enCero).resumen);
  assert.equal(c.find(x => x.etiqueta === 'Caja').texto, '$0');
});

// ---- el porcentaje pagado -----------------------------------------------

test('el porcentaje pagado se redondea y se queda entre 0 y 100', () => {
  assert.equal(porcentajePagado(50000000, 200000000), 25);
  assert.equal(porcentajePagado(1, 3), 33);
  assert.equal(porcentajePagado(0, 100), 0);
  assert.equal(porcentajePagado(500, 100), 100, 'un sobrepago no dibuja una barra más larga que la caja');
  assert.equal(porcentajePagado(-10, 100), 0);
});

test('sin datos para calcularlo, el porcentaje es null y no una barra en cero', () => {
  // Una barra en 0 % afirma «no ha pagado nada». Eso no es lo mismo que
  // «no se sabe», y es la misma regla de la raya contra el $0.
  assert.equal(porcentajePagado(null, 200000000), null);
  assert.equal(porcentajePagado(50000000, null), null);
  assert.equal(porcentajePagado(50000000, 0), null);
  assert.equal(porcentajePagado(50000000, -1), null);
  assert.equal(porcentajePagado(undefined, undefined), null);
  assert.equal(porcentajePagado('50', '200'), null);
});

// ---- «vencido» en el calendario del saldo -------------------------------

test('mencionaVencido reconoce la mora escrita en palabras', () => {
  assert.equal(mencionaVencido('$10.000.000 vencidos el 24-ago-2026'), true);
  assert.equal(mencionaVencido('Cuota VENCIDA'), true);
  assert.equal(mencionaVencido('cuota vencída'), true, 'con acento cuenta igual');
  assert.equal(mencionaVencido('$54.000.000 el 2027-02-19'), false);
  assert.equal(mencionaVencido('Sin cuota programada'), false);
  assert.equal(mencionaVencido(null), false);
  assert.equal(mencionaVencido(undefined), false);
});

// ---- la ficha de un lote ------------------------------------------------

test('la ficha de un lote vendido trae comprador, cifras, barra y calendario', () => {
  const f = fichaDe(1);
  assert.equal(f.estado, 'vendido');
  assert.equal(f.etiqueta, 'Vendido');
  assert.equal(f.numeroTexto, '1');

  const por = Object.fromEntries(f.filas.map(x => [x.etiqueta, x.valor]));
  assert.equal(por.Comprador, 'Compradora de prueba');
  assert.equal(por.Estado, 'Promesa firmada');
  assert.equal(por['Área'], '2.754 m²');
  assert.equal(por.Precio, '$200.000.000');
  assert.equal(por.Abonado, '$50.000.000');
  assert.equal(por.Saldo, '$150.000.000');

  assert.deepEqual(f.progreso, { porcentaje: 25, texto: '25 % pagado' });
  assert.equal(f.calendario.vencido, false);
  assert.match(f.calendario.texto, /2027-02-19/);
  assert.equal(f.nota, null);
});

test('el calendario del lote con mora queda marcado como vencido', () => {
  const f = fichaDe(5);
  assert.equal(f.calendario.vencido, true);
  assert.match(f.calendario.texto, /vencidos/);
});

test('la ficha de un lote disponible muestra el precio de lista y dice que no tiene promesa', () => {
  const f = fichaDe(6);
  assert.equal(f.estado, 'disponible');
  assert.equal(f.etiqueta, 'Disponible');
  const por = Object.fromEntries(f.filas.map(x => [x.etiqueta, x.valor]));
  assert.equal(por['Área'], '2.140 m²');
  // 2.140 m² × $110.000 el metro, calculado, no escrito a mano.
  assert.equal(por['Precio de lista'], '$235.400.000');
  assert.match(f.nota, /a la venta/i);
  assert.equal(f.progreso, null);
  assert.equal(f.calendario, null);
  assert.ok(!f.filas.some(x => ['Saldo', 'Abonado', 'Comprador'].includes(x.etiqueta)));
});

test('el lote en especie no lleva precio, ni saldo, ni barra, ni se llama vendido', () => {
  const f = fichaDe(2);
  assert.equal(f.estado, 'especie');
  assert.equal(f.etiqueta, 'En especie');
  assert.equal(f.progreso, null);
  assert.equal(f.calendario, null);
  assert.match(f.nota, /pago en especie/i);
  const etiquetas = f.filas.map(x => x.etiqueta);
  assert.deepEqual(etiquetas, ['Área']);
  for (const x of f.filas) {
    assert.doesNotMatch(x.valor, /\$/, 'por un lote en especie no entra ni sale plata');
  }
});

test('un lote que el plano da por vendido y la cartera no trae no inventa cifras', () => {
  const f = fichaDe(10);
  assert.equal(f.etiqueta, 'Vendido');
  assert.deepEqual(f.filas.map(x => x.etiqueta), ['Área']);
  assert.equal(f.progreso, null);
  assert.equal(f.calendario, null);
  assert.match(f.nota, /no trae su fila/i);
  for (const x of f.filas) assert.doesNotMatch(x.valor, /\$0/);
});

test('hay una ficha por lote del plano y arranca en el primero con cartera', () => {
  const v = construirVistaLotes(vistaDe(), INV);
  assert.equal(v.fichas.length, INV.lotes.length);
  assert.deepEqual(v.fichas.map(f => f.n), INV.lotes.map(l => l.n).sort((a, b) => a - b));
  assert.equal(v.inicial, 1);
  assert.deepEqual(v.avisos, []);
});

test('un precio en null deja la ficha con raya y sin barra, jamás con $0', () => {
  const roto = {
    ...TABLERO,
    cartera: [{ ...TABLERO.cartera[0], precio: null, abonado: null, saldo: null }]
  };
  const f = fichaDe(1, roto);
  const por = Object.fromEntries(f.filas.map(x => [x.etiqueta, x.valor]));
  assert.equal(por.Precio, '—');
  assert.equal(por.Abonado, '—');
  assert.equal(por.Saldo, '—');
  assert.equal(f.progreso, null, 'sin precio no se puede dibujar cuánto se pagó');
  for (const x of f.filas) assert.notEqual(x.valor, '$0');
});

test('un abonado de $0 real sí se muestra en cero, con su barra vacía', () => {
  const enCero = { ...TABLERO, cartera: [{ ...TABLERO.cartera[0], abonado: 0 }] };
  const f = fichaDe(1, enCero);
  const por = Object.fromEntries(f.filas.map(x => [x.etiqueta, x.valor]));
  assert.equal(por.Abonado, '$0');
  assert.deepEqual(f.progreso, { porcentaje: 0, texto: '0 % pagado' });
});

test('un comprador vacío sale como raya y no como el texto «undefined»', () => {
  const sinNombre = { ...TABLERO, cartera: [{ ...TABLERO.cartera[0], comprador: '', estado: '' }] };
  const f = fichaDe(1, sinNombre);
  const por = Object.fromEntries(f.filas.map(x => [x.etiqueta, x.valor]));
  assert.equal(por.Comprador, '—');
  assert.equal(por.Estado, '—');
});

test('una cuota ilegible no dice que no hay cuota ni la pinta como plata', () => {
  const roto = {
    ...TABLERO,
    cartera: [{
      ...TABLERO.cartera[0],
      proximaCuotaValor: null, proximaCuotaIlegible: true, proximaCuotaFecha: '2027-03-01'
    }]
  };
  const f = fichaDe(1, roto);
  assert.match(f.calendario.texto, /no se pudo leer/i);
  assert.doesNotMatch(f.calendario.texto, /\$/);
  assert.equal(f.calendario.vencido, false);
});

// ---- lo que no cuadra entre el plano y la cartera -----------------------

test('una fila de cartera de un lote que no existe en el plano se avisa, no se pierde', () => {
  const conFantasma = {
    ...TABLERO,
    cartera: [...TABLERO.cartera, { ...TABLERO.cartera[0], lote: 99 }]
  };
  const v = construirVistaLotes(vistaDe(conFantasma), INV);
  assert.equal(v.fichas.length, INV.lotes.length);
  assert.equal(v.avisos.length, 1);
  assert.match(v.avisos[0], /99/);
  assert.match(v.avisos[0], /no existe en el plano/i);
});

test('un lote con comprador que el plano sigue mostrando disponible se avisa', () => {
  // Es el caso caro: la vitrina pública lo está anunciando en verde.
  const v = construirVistaLotes(
    vistaDe({ ...TABLERO, cartera: [{ ...TABLERO.cartera[0], lote: 6 }] }),
    INV
  );
  assert.equal(v.avisos.length, 1);
  assert.match(v.avisos[0], /vitrina/i);
  assert.equal(v.fichas.find(f => f.n === 6).etiqueta, 'Vendido');
});

test('un lote en especie que aparece en la cartera se avisa y sigue sin mostrar plata', () => {
  const v = construirVistaLotes(
    vistaDe({ ...TABLERO, cartera: [{ ...TABLERO.cartera[0], lote: 2 }] }),
    INV
  );
  assert.equal(v.avisos.length, 1);
  assert.match(v.avisos[0], /especie/i);
  const f = v.fichas.find(x => x.n === 2);
  assert.equal(f.etiqueta, 'En especie');
  assert.equal(f.progreso, null);
});

test('sin cartera el panel igual arma las catorce fichas y elige la primera', () => {
  const v = construirVistaLotes(vistaDe({ ...TABLERO, cartera: [] }), INV);
  assert.equal(v.fichas.length, INV.lotes.length);
  assert.equal(v.inicial, 1);
});

// ---- inyección desde la hoja -------------------------------------------

test('un comprador con HTML llega a la ficha escapado, no interpretado', () => {
  const malicioso = {
    ...TABLERO,
    cartera: [{
      ...TABLERO.cartera[0],
      comprador: `<img src=x onerror="window.__xss=1"> "comillas"`,
      estado: '<script>alert(1)</script>'
    }]
  };
  const f = fichaDe(1, malicioso);
  const por = Object.fromEntries(f.filas.map(x => [x.etiqueta, x.valor]));
  assert.doesNotMatch(por.Comprador, /<img/);
  assert.match(por.Comprador, /&lt;img/);
  assert.match(por.Comprador, /&quot;/);
  assert.doesNotMatch(por.Estado, /<script>/);
  assert.match(por.Estado, /&lt;script&gt;/);
});

test('una fecha con HTML llega al calendario escapada y sin romper la marca de vencido', () => {
  const malicioso = {
    ...TABLERO,
    cartera: [{
      ...TABLERO.cartera[0],
      proximaCuotaFecha: '<svg onload=alert(1)> vencidos el 24-ago-2026'
    }]
  };
  const f = fichaDe(1, malicioso);
  assert.doesNotMatch(f.calendario.texto, /<svg/);
  assert.match(f.calendario.texto, /&lt;svg/);
  assert.equal(f.calendario.vencido, true, 'escapar no cambia las letras');
});

test('ningún valor de ninguna ficha sale con HTML crudo', () => {
  const CARGA = `<img src=x onerror=alert(1)>'"`;
  const malicioso = {
    ...TABLERO,
    cartera: [{
      lote: 1, area: 2754, comprador: CARGA, precio: 1, abonado: 1, saldo: 1,
      proximaCuotaFecha: CARGA, proximaCuotaValor: 1, estado: CARGA,
      promesa: CARGA, abonos: []
    }]
  };
  const v = construirVistaLotes(vistaDe(malicioso), INV);
  for (const f of v.fichas) {
    for (const x of f.filas) assert.doesNotMatch(x.valor, /<img|<svg|<script/, `${f.n}/${x.etiqueta}`);
    if (f.calendario) assert.doesNotMatch(f.calendario.texto, /<img|<svg|<script/);
  }
});

// ---- el panel de gastos -------------------------------------------------

test('las categorías van de mayor a menor con su barra proporcional a la mayor', () => {
  const g = construirVistaGastos(vistaDe().egresosPorCategoria);
  assert.deepEqual(g.categorias.map(c => c.categoria), ['Acueducto', 'Adecuaciones']);
  assert.equal(g.categorias[0].proporcion, 100);
  assert.equal(g.categorias[1].proporcion, 25); // 25 de 100 millones
  assert.deepEqual(g.categorias.map(c => c.indice), [0, 1]);
});

test('cada categoría se lleva sus movimientos para poder abrirlos', () => {
  const g = construirVistaGastos(vistaDe().egresosPorCategoria);
  const acueducto = g.categorias[0];
  assert.equal(acueducto.movimientos.length, 2);
  assert.equal(acueducto.movimientos[0].concepto, 'Red principal');
  assert.equal(acueducto.movimientos[0].valorTexto, '$90.000.000');
});

test('el total general suma las categorías', () => {
  const g = construirVistaGastos(vistaDe().egresosPorCategoria);
  assert.equal(g.total, 125000000);
  assert.equal(g.totalTexto, '$125.000.000');
  assert.equal(g.incompleto, false);
});

test('el total general de un panel con filas sin leer viaja marcado, pegado a la cifra', () => {
  const conIlegible = {
    ...TABLERO,
    avisos: [{ tipo: 'ilegible', pestana: 'Egresos', fila: 4, columna: 'Valor', valor: '1.5', categoria: 'Acueducto' }]
  };
  const g = construirVistaGastos(vistaDe(conIlegible).egresosPorCategoria);
  assert.equal(g.incompleto, true);
  assert.equal(g.filasSinLeer, 1);
  assert.match(g.totalTexto, /sin leer/i);
  assert.notEqual(g.totalTexto, '$125.000.000', 'un total incompleto no puede verse como uno completo');
  // Y la categoría afectada conserva su propia marca.
  assert.equal(g.categorias[0].incompleto, true);
  assert.match(g.categorias[0].totalTexto, /sin leer/i);
});

test('dos filas sin leer en el total general se cuentan en plural', () => {
  const dos = {
    ...TABLERO,
    avisos: [
      { tipo: 'ilegible', pestana: 'Egresos', fila: 4, columna: 'Valor', valor: '1.5', categoria: 'Acueducto' },
      { tipo: 'ilegible', pestana: 'Egresos', fila: 9, columna: 'Valor', valor: '#REF!', categoria: 'Adecuaciones' }
    ]
  };
  const g = construirVistaGastos(vistaDe(dos).egresosPorCategoria);
  assert.equal(g.filasSinLeer, 2);
  assert.match(g.totalTexto, /2 movimientos sin leer/i);
});

test('un panel de gastos vacío muestra raya, no $0', () => {
  const g = construirVistaGastos(vistaDe({ ...TABLERO, egresos: [] }).egresosPorCategoria);
  assert.deepEqual(g.categorias, []);
  assert.equal(g.total, null);
  assert.equal(g.totalTexto, '—');
  assert.notEqual(g.totalTexto, '$0');
});

test('sin argumento el panel de gastos tampoco inventa un cero', () => {
  assert.equal(construirVistaGastos(undefined).totalTexto, '—');
});

test('con la categoría mayor en cero ninguna barra se dibuja, en vez de inventar la escala', () => {
  const enCero = {
    ...TABLERO,
    egresos: [{ fecha: '2026-05-01', categoria: 'Anticipos', concepto: 'Devuelto', valor: 0 }]
  };
  const g = construirVistaGastos(vistaDe(enCero).egresosPorCategoria);
  assert.equal(g.categorias[0].proporcion, 0);
  assert.equal(g.categorias[0].totalTexto, '$0', 'un cero real sí es $0');
});

test('una categoría con HTML en el nombre o en el concepto llega escapada al panel', () => {
  const malicioso = {
    ...TABLERO,
    egresos: [{
      fecha: '"><svg onload=alert(3)>',
      categoria: '<img src=x onerror=alert(1)>',
      concepto: '<script>alert(2)</script>',
      valor: 1000
    }]
  };
  const g = construirVistaGastos(vistaDe(malicioso).egresosPorCategoria);
  assert.doesNotMatch(g.categorias[0].categoria, /<img/);
  assert.doesNotMatch(g.categorias[0].movimientos[0].concepto, /<script>/);
  assert.doesNotMatch(g.categorias[0].movimientos[0].fecha, /<svg/);
  assert.match(g.categorias[0].categoria, /&lt;img/);
});

test('la promesa aparece en la ficha cuando la hoja la trae, y no cuando no', () => {
  const con = { ...TABLERO, cartera: [{ ...TABLERO.cartera[0], promesa: '19/08/2026' }] };
  const f = construirVistaLotes(vistaDe(con), INV).fichas.find(x => x.n === TABLERO.cartera[0].lote);
  assert.equal(f.filas.find(x => x.etiqueta === 'Promesa')?.valor, '19/08/2026');

  const sin = { ...TABLERO, cartera: [{ ...TABLERO.cartera[0], promesa: '' }] };
  const g = construirVistaLotes(vistaDe(sin), INV).fichas.find(x => x.n === TABLERO.cartera[0].lote);
  assert.equal(g.filas.some(x => x.etiqueta === 'Promesa'), false,
    'sin fecha no debe quedar una fila «Promesa» vacía');
});
