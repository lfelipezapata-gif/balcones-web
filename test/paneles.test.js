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
  construirCifras, construirVistaLotes, construirVistaGastos, construirVistaSocios,
  construirTotalesLotes, mencionaVencido, porcentajePagado
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

// ---- los totales por grupo del plano ------------------------------------
//
// El filtro de la pestaña «Los lotes»: todos, vendidos y sin vender. Los
// números de abajo son los del inventario de verdad (data/lotes.json) porque
// esa es media prueba: el grupo «Sin vender» tiene que dar la misma cifra que
// la vitrina pública anuncia y que la cabecera muestra en «Inventario».

// La cartera completa de los seis lotes que el plano da por vendidos. Cifras
// de juguete, iguales entre sí para que el total se pueda verificar de cabeza.
const CARTERA_COMPLETA = [1, 3, 4, 5, 10, 14].map(lote => ({
  lote, comprador: `Comprador de prueba ${lote}`, estado: 'Promesa firmada',
  precio: 200000000, abonado: 50000000, saldo: 150000000,
  proximaCuotaFecha: '2027-02-19', proximaCuotaValor: 10000000, abonos: []
}));
const TABLERO_COMPLETO = { ...TABLERO, cartera: CARTERA_COMPLETA };

const gruposDe = (t = TABLERO, inv = INV) => {
  const g = construirTotalesLotes(vistaDe(t), inv);
  return { lista: g, por: Object.fromEntries(g.map(x => [x.clave, x])) };
};
const cifrasPorEtiqueta = (grupo) =>
  Object.fromEntries(grupo.cifras.map(c => [c.etiqueta, c]));

test('son tres grupos, en el orden de los botones y con sus rótulos', () => {
  const { lista } = gruposDe();
  assert.deepEqual(lista.map(g => g.clave), ['todos', 'vendidos', 'sinVender']);
  assert.deepEqual(lista.map(g => g.etiqueta), ['Todos', 'Colocados', 'Sin vender']);
});

test('«Todos» se queda como está hoy: todos los lotes y ningún resumen', () => {
  const { por } = gruposDe();
  assert.equal(por.todos.muestraResumen, false);
  assert.deepEqual(por.todos.cifras, []);
  assert.equal(por.todos.nota, null);
  assert.equal(por.todos.conteo, INV.lotes.length);
  assert.deepEqual(por.todos.lotes, INV.lotes.map(l => l.n).sort((a, b) => a - b));
});

test('cada lote del plano cae en un grupo y en uno solo', () => {
  const { por } = gruposDe();
  const juntos = [...por.vendidos.lotes, ...por.sinVender.lotes].sort((a, b) => a - b);
  assert.deepEqual(juntos, por.todos.lotes, 'ningún lote puede quedarse por fuera ni contarse dos veces');
});

test('el grupo «Sin vender» da la misma cifra que la vitrina y la cabecera', () => {
  const { por } = gruposDe();
  const c = cifrasPorEtiqueta(por.sinVender);
  assert.equal(por.sinVender.conteo, 7);
  assert.equal(por.sinVender.areaTotal, 16668);
  assert.equal(c.Lotes.texto, '7');
  assert.equal(c['Área'].texto, '16.668 m²');
  // La misma cifra que muestra «Inventario» en la cabecera: 16.668 m² por el
  // valor del metro. Si esta prueba cambia sin que cambie data/lotes.json, el
  // tablero y la vitrina se separaron.
  assert.equal(c['Valor de lista'].texto, '$1.833.480.000');
  assert.equal(c['Valor de lista'].incompleto, false);
  assert.match(por.sinVender.nota, /precio de lista/i);
});

test('el grupo «Colocados» cuenta el lote en especie, con su área', () => {
  const { por } = gruposDe(TABLERO_COMPLETO);
  const c = cifrasPorEtiqueta(por.vendidos);
  // Los seis con cartera más el lote en especie, que ya tiene dueño.
  assert.equal(por.vendidos.conteo, 7);
  assert.ok(por.vendidos.lotes.includes(2), 'el lote en especie no está sin vender');
  assert.equal(por.sinVender.lotes.includes(2), false);
  assert.equal(por.vendidos.areaTotal, 18253);
  assert.equal(c.Lotes.texto, '7');
  assert.equal(c['Área'].texto, '18.253 m²');
});

test('el lote en especie no infla ninguna cifra de dinero ni marca el total como incompleto', () => {
  const { por } = gruposDe(TABLERO_COMPLETO);
  const c = cifrasPorEtiqueta(por.vendidos);
  // Seis lotes con cartera, no siete: por el lote en especie no entró un peso.
  assert.equal(c['Valor total'].texto, '$1.200.000.000');
  assert.equal(c.Abonado.texto, '$300.000.000');
  assert.equal(c['Saldo por cobrar'].texto, '$900.000.000');
  for (const cifra of por.vendidos.cifras) {
    assert.equal(cifra.incompleto, false, `${cifra.etiqueta} no tiene por qué estar marcada`);
    assert.doesNotMatch(cifra.texto, /sin cifras/);
  }
  // Y se dice, porque si no la resta no cuadra contra los siete lotes.
  assert.match(por.vendidos.nota, /especie/i);
  assert.match(por.vendidos.nota, /no entró dinero/i);
});

test('un vendido sin fila en la cartera deja las tres cifras marcadas, pegado al número', () => {
  // El TABLERO base solo trae cartera de los lotes 1 y 5: los otros cuatro
  // vendidos no tienen cifras y el total queda corto de verdad.
  const { por } = gruposDe();
  const c = cifrasPorEtiqueta(por.vendidos);
  assert.equal(por.vendidos.conteo, 7);
  for (const etiqueta of ['Valor total', 'Abonado', 'Saldo por cobrar']) {
    assert.equal(c[etiqueta].incompleto, true, etiqueta);
    assert.match(c[etiqueta].texto, /\+ 4 lotes sin cifras/);
  }
  assert.match(c['Valor total'].texto, /^\$300\.000\.000 \+/, 'suma los dos que sí tienen fila');
  assert.notEqual(c['Valor total'].texto, '$300.000.000');
});

test('un solo lote sin cifras se cuenta en singular', () => {
  const casiCompleto = { ...TABLERO, cartera: CARTERA_COMPLETA.slice(0, 5) };
  const { por } = gruposDe(casiCompleto);
  assert.match(cifrasPorEtiqueta(por.vendidos)['Valor total'].texto, /\+ 1 lote sin cifras/);
});

test('sin cartera, las cifras de plata de los vendidos salen en raya y jamás en $0', () => {
  const { por } = gruposDe({ ...TABLERO, cartera: [] });
  const c = cifrasPorEtiqueta(por.vendidos);
  for (const etiqueta of ['Valor total', 'Abonado', 'Saldo por cobrar']) {
    assert.equal(c[etiqueta].texto, '—', etiqueta);
    assert.notEqual(c[etiqueta].texto, '$0');
  }
  // El conteo y el área sí se saben: salen del plano, no de la hoja.
  assert.equal(c.Lotes.texto, '7');
  assert.equal(c['Área'].texto, '18.253 m²');
  // Y el grupo sin vender no depende de la hoja para nada.
  assert.equal(cifrasPorEtiqueta(por.sinVender)['Valor de lista'].texto, '$1.833.480.000');
});

test('un saldo en null marca la cifra del saldo y deja las otras dos completas', () => {
  const conNull = {
    ...TABLERO,
    cartera: CARTERA_COMPLETA.map(c => c.lote === 3 ? { ...c, saldo: null } : c)
  };
  const c = cifrasPorEtiqueta(gruposDe(conNull).por.vendidos);
  assert.equal(c['Saldo por cobrar'].incompleto, true);
  assert.match(c['Saldo por cobrar'].texto, /\+ 1 lote sin cifras/);
  assert.notEqual(c['Saldo por cobrar'].texto, '$750.000.000');
  assert.equal(c['Valor total'].incompleto, false);
  assert.equal(c['Valor total'].texto, '$1.200.000.000');
  assert.equal(c.Abonado.incompleto, false);
});

test('un abonado de $0 real sí suma como cero y no ensucia la marca', () => {
  const enCero = {
    ...TABLERO,
    cartera: CARTERA_COMPLETA.map(c => ({ ...c, abonado: 0 }))
  };
  const c = cifrasPorEtiqueta(gruposDe(enCero).por.vendidos);
  assert.equal(c.Abonado.texto, '$0');
  assert.equal(c.Abonado.incompleto, false);
});

// El caso feo: se vendió todo y el filtro «Sin vender» se queda sin nada.
const INV_TODO_VENDIDO = {
  ...INV,
  lotes: INV.lotes.map(l => ({ ...l, estado: l.estado === 'disponible' ? 'vendido' : l.estado }))
};

test('«Sin vender» sin ningún lote lo dice con palabras, no con una fila de ceros', () => {
  const { por } = gruposDe(TABLERO_COMPLETO, INV_TODO_VENDIDO);
  assert.equal(por.sinVender.conteo, 0);
  assert.deepEqual(por.sinVender.lotes, []);
  assert.equal(por.sinVender.areaTotal, 0);
  assert.deepEqual(por.sinVender.cifras, [], 'un grupo vacío no tiene cifras que mostrar');
  assert.equal(por.sinVender.nota, 'No queda ningún lote sin vender.');
  assert.equal(por.vendidos.conteo, INV.lotes.length, 'todos quedaron del otro lado');
});

test('«Colocados» sin ningún lote tampoco inventa un $0', () => {
  const nadaVendido = { ...INV, lotes: INV.lotes.map(l => ({ ...l, estado: 'disponible' })) };
  const { por } = gruposDe(TABLERO, nadaVendido);
  assert.equal(por.vendidos.conteo, 0);
  assert.deepEqual(por.vendidos.cifras, []);
  assert.equal(por.vendidos.nota, 'Todavía no hay ningún lote vendido.');
  assert.equal(por.sinVender.conteo, INV.lotes.length);
});

test('un inventario inválido no arma totales a medias: revienta', () => {
  assert.throws(() => construirTotalesLotes(vistaDe(), { precioM2: 0, lotes: [] }));
  assert.throws(() => construirTotalesLotes(vistaDe(), null));
});

test('ningún texto de la hoja se cuela en los totales', () => {
  // Las etiquetas y las notas son literales del código y las cifras salen de
  // números. Una carga de inyección en la cartera no tiene por dónde entrar.
  const CARGA = `<img src=x onerror=alert(1)>'"`;
  const malicioso = {
    ...TABLERO,
    cartera: [{
      lote: 1, comprador: CARGA, estado: CARGA, promesa: CARGA,
      precio: 1, abonado: 1, saldo: 1,
      proximaCuotaFecha: CARGA, proximaCuotaValor: 1, abonos: []
    }]
  };
  for (const g of construirTotalesLotes(vistaDe(malicioso), INV)) {
    const textos = [g.etiqueta, g.nota, ...g.cifras.flatMap(c => [c.etiqueta, c.texto])];
    for (const t of textos.filter(Boolean)) {
      assert.doesNotMatch(t, /<img|<svg|<script|&lt;/, `salió texto de la hoja: ${t}`);
    }
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


// ---- la tabla de socios -------------------------------------------------
//
// Seis socios inventados con la misma FORMA que la hoja real: dos al 33 %, dos
// al 11 % y dos al 6 %, y un total de la tierra que reparten entre todos. Ni
// los nombres ni las cifras son los de verdad — no entran al repositorio, ver
// test/secretos.test.js.
//
// Uno puso cinco millones de más y otro cinco millones de menos; los otros
// cuatro están exactos. Es el caso que la pestaña existe para mostrar.

const pagos = (a, b, c, d) => [
  { etiqueta: 'Escritura dic-2024', valor: a },
  { etiqueta: 'Compromiso jun-2025', valor: b },
  { etiqueta: 'Adicional jul-2025', valor: c },
  { etiqueta: 'Compromiso dic-2025', valor: d }
];

const SOCIOS = [
  { nombre: 'Sociedad Primera S.A.S.', participacion: 0.33, pagos: pagos(264000000, 132000000, 66000000, 335000000), total: 797000000 },
  { nombre: 'Sociedad Segunda S.A.S.', participacion: 0.33, pagos: pagos(264000000, 132000000, 66000000, 330000000), total: 792000000 },
  { nombre: 'Socia Tercera', participacion: 0.11, pagos: pagos(88000000, 44000000, 22000000, 110000000), total: 264000000 },
  { nombre: 'Socio Cuarto', participacion: 0.11, pagos: pagos(88000000, 44000000, 22000000, 110000000), total: 264000000 },
  { nombre: 'Socio Quinto', participacion: 0.06, pagos: pagos(48000000, 24000000, 12000000, 60000000), total: 144000000 },
  { nombre: 'Socio Sexto', participacion: 0.06, pagos: pagos(48000000, 24000000, 12000000, 55000000), total: 139000000 }
];

const CON_SOCIOS = { ...TABLERO, socios: SOCIOS };
const sociosDe = (t = CON_SOCIOS) => construirVistaSocios(vistaDe(t).socios);

test('los socios van de mayor a menor aporte', () => {
  const s = sociosDe();
  assert.equal(s.socios.length, 6);
  assert.deepEqual(s.socios.map(x => x.total),
    [797000000, 792000000, 264000000, 264000000, 144000000, 139000000]);
});

test('el total del pie suma los seis aportes', () => {
  const s = sociosDe();
  assert.equal(s.total, 2400000000);
  assert.equal(s.totalTexto, '$2.400.000.000');
  assert.equal(s.incompleto, false);
});

test('el pie también suma cada ronda de aportes por separado', () => {
  const s = sociosDe();
  assert.deepEqual(s.etiquetasPagos,
    ['Escritura dic-2024', 'Compromiso jun-2025', 'Adicional jul-2025', 'Compromiso dic-2025']);
  assert.deepEqual(s.totalesPagos.map(t => t.total),
    [800000000, 400000000, 200000000, 1000000000]);
  assert.equal(s.totalesPagos[0].texto, '$800.000.000');
});

// El hallazgo de la pestaña: quién se apartó de lo que le tocaba por su parte.
test('la diferencia contra la participación sale con signo y solo donde la hay', () => {
  const s = sociosDe();
  const por = Object.fromEntries(s.socios.map(x => [x.nombre, x]));

  assert.equal(por['Sociedad Primera S.A.S.'].diferencia, 5000000);
  assert.equal(por['Sociedad Primera S.A.S.'].diferenciaTexto, '+$5.000.000');
  assert.equal(por['Sociedad Primera S.A.S.'].diferenciaEstado, 'de-mas');

  assert.equal(por['Socio Sexto'].diferencia, -5000000);
  assert.equal(por['Socio Sexto'].diferenciaTexto, '-$5.000.000');
  assert.equal(por['Socio Sexto'].diferenciaEstado, 'de-menos');

  for (const nombre of ['Sociedad Segunda S.A.S.', 'Socia Tercera', 'Socio Cuarto', 'Socio Quinto']) {
    assert.equal(por[nombre].diferencia, 0, `${nombre} debería estar exacto`);
    assert.equal(por[nombre].diferenciaTexto, '$0');
    assert.equal(por[nombre].diferenciaEstado, 'exacto');
  }
});

test('lo que le corresponde a cada uno se calcula, no se copia de la hoja', () => {
  const s = sociosDe();
  const primera = s.socios.find(x => x.nombre === 'Sociedad Primera S.A.S.');
  // 33 % del total de la tierra de estos datos de juguete.
  assert.equal(primera.esperado, 792000000);
  assert.equal(primera.esperadoTexto, '$792.000.000');
});

test('las diferencias suman cero cuando las participaciones cuadran en 100 %', () => {
  const s = sociosDe();
  assert.equal(s.participacionCuadra, true);
  assert.equal(s.participacionTotalTexto, '100 %');
  assert.equal(s.diferenciaTotal, 0);
  assert.equal(s.diferenciaTotalEstado, 'exacto');
});

test('unas participaciones que no suman 100 % quedan marcadas', () => {
  const mal = { ...CON_SOCIOS, socios: SOCIOS.map(x => ({ ...x, participacion: 0.1 })) };
  const s = sociosDe(mal);
  assert.equal(s.participacionCuadra, false);
  assert.equal(s.participacionTotalTexto, '60 %');
});

test('el ruido de la coma flotante no le inventa una diferencia al que está exacto', () => {
  // 0,33 por el total no da un entero redondo en binario. Sin redondear al
  // peso, un socio exacto salía con una diferencia de fracciones y se pintaba
  // del color de «puso de más» mostrando «$0».
  const s = sociosDe();
  const segunda = s.socios.find(x => x.nombre === 'Sociedad Segunda S.A.S.');
  assert.equal(segunda.diferencia, 0);
  assert.equal(segunda.diferenciaEstado, 'exacto');
});

test('el socio con un pago en null lo muestra como raya y no como $0', () => {
  const roto = {
    ...CON_SOCIOS,
    socios: [{ ...SOCIOS[0], pagos: pagos(264000000, null, 66000000, 335000000) }, ...SOCIOS.slice(1)]
  };
  const s = sociosDe(roto);
  const primera = s.socios.find(x => x.nombre === 'Sociedad Primera S.A.S.');
  assert.equal(primera.pagos[1].valorTexto, '—');
  assert.notEqual(primera.pagos[1].valorTexto, '$0');
  // El total de ESA ronda queda marcado, con la marca pegada a la cifra.
  assert.equal(s.totalesPagos[1].incompleto, true);
  assert.match(s.totalesPagos[1].texto, /sin leer/i);
  assert.notEqual(s.totalesPagos[1].texto, '$400.000.000');
  // Y el total aportado, que la hoja trae en su propia columna, sigue completo.
  assert.equal(s.incompleto, false);
  assert.equal(s.totalTexto, '$2.400.000.000');
});

test('con un total sin leer no se calcula NINGUNA diferencia: la base quedó corta', () => {
  const roto = { ...CON_SOCIOS, socios: [{ ...SOCIOS[0], total: null }, ...SOCIOS.slice(1)] };
  const s = sociosDe(roto);
  assert.equal(s.baseConfiable, false);
  for (const x of s.socios) {
    assert.equal(x.diferencia, null, `${x.nombre} no puede tener diferencia sobre una base rota`);
    assert.equal(x.diferenciaTexto, '—');
    assert.equal(x.diferenciaEstado, 'sin-dato');
    assert.notEqual(x.diferenciaTexto, '$0', 'un «no se pudo calcular» no puede leerse como «está exacto»');
  }
  assert.equal(s.diferenciaTotalTexto, '—');
});

test('el total del pie con un socio sin leer viaja marcado, pegado a la cifra', () => {
  const roto = { ...CON_SOCIOS, socios: [{ ...SOCIOS[0], total: null }, ...SOCIOS.slice(1)] };
  const s = sociosDe(roto);
  assert.equal(s.incompleto, true);
  assert.equal(s.sinLeer, 1);
  assert.match(s.totalTexto, /1 socio sin leer/i);
  assert.notEqual(s.totalTexto, '$1.603.000.000');
});

test('dos socios sin leer se cuentan en plural', () => {
  const roto = {
    ...CON_SOCIOS,
    socios: [{ ...SOCIOS[0], total: null }, { ...SOCIOS[1], total: null }, ...SOCIOS.slice(2)]
  };
  const s = sociosDe(roto);
  assert.equal(s.sinLeer, 2);
  assert.match(s.totalTexto, /2 socios sin leer/i);
});

test('el socio cuyo total no se pudo leer se va al final del orden', () => {
  const roto = { ...CON_SOCIOS, socios: [{ ...SOCIOS[0], total: null }, ...SOCIOS.slice(1)] };
  const s = sociosDe(roto);
  assert.equal(s.socios.at(-1).nombre, 'Sociedad Primera S.A.S.');
  assert.equal(s.socios[0].total, 792000000);
});

test('una participación ilegible deja sin diferencia a ese socio y no a los demás', () => {
  const roto = { ...CON_SOCIOS, socios: [{ ...SOCIOS[0], participacion: null }, ...SOCIOS.slice(1)] };
  const s = sociosDe(roto);
  const primera = s.socios.find(x => x.nombre === 'Sociedad Primera S.A.S.');
  assert.equal(primera.diferenciaEstado, 'sin-dato');
  assert.equal(primera.participacionTexto, '—');
  const segunda = s.socios.find(x => x.nombre === 'Sociedad Segunda S.A.S.');
  assert.equal(segunda.diferenciaEstado, 'exacto', 'lo de un socio no puede tumbar el cálculo del otro');
});

test('sin ningún total legible el pie muestra raya, no $0', () => {
  const roto = { ...CON_SOCIOS, socios: SOCIOS.map(x => ({ ...x, total: null })) };
  const s = sociosDe(roto);
  assert.equal(s.total, null);
  assert.equal(s.totalTexto, '—');
  assert.notEqual(s.totalTexto, '$0');
});

test('la pestaña de socios vacía no inventa un cero', () => {
  const s = sociosDe({ ...TABLERO, socios: [] });
  assert.deepEqual(s.socios, []);
  assert.equal(s.total, null);
  assert.equal(s.totalTexto, '—');
  assert.equal(s.diferenciaTotalTexto, '—');
});

test('sin argumento la tabla de socios tampoco revienta ni inventa un cero', () => {
  const s = construirVistaSocios(undefined);
  assert.deepEqual(s.socios, []);
  assert.equal(s.totalTexto, '—');
});

test('un nombre de socio con HTML llega a la tabla escapado, no interpretado', () => {
  const malicioso = {
    ...CON_SOCIOS,
    socios: [{ ...SOCIOS[0], nombre: `<img src=x onerror="window.__xss=1"> "comillas"` }, ...SOCIOS.slice(1)]
  };
  const s = sociosDe(malicioso);
  const atacante = s.socios.find(x => /img/.test(x.nombre));
  assert.doesNotMatch(atacante.nombre, /<img/);
  assert.match(atacante.nombre, /&lt;img/);
  assert.match(atacante.nombre, /&quot;/);
});

test('ningún texto de la tabla de socios sale con HTML crudo', () => {
  const CARGA = `<img src=x onerror=alert(1)>'"`;
  const malicioso = {
    ...CON_SOCIOS,
    socios: [{ nombre: CARGA, participacion: 0.5, pagos: [{ etiqueta: CARGA, valor: 1 }], total: 1 }]
  };
  const s = sociosDe(malicioso);
  const textos = [
    ...Object.values(s.socios[0]).filter(x => typeof x === 'string'),
    ...s.socios[0].pagos.flatMap(p => Object.values(p).filter(x => typeof x === 'string')),
    ...s.etiquetasPagos
  ];
  assert.ok(textos.length > 0);
  for (const t of textos) assert.doesNotMatch(t, /<img|<svg|<script/, `salió sin escapar: ${t}`);
});

test('el estado de la diferencia sale de un vocabulario cerrado, apto para un atributo', () => {
  const s = sociosDe();
  const permitidos = new Set(['exacto', 'de-mas', 'de-menos', 'sin-dato']);
  for (const x of s.socios) assert.ok(permitidos.has(x.diferenciaEstado), x.diferenciaEstado);
  assert.ok(permitidos.has(s.diferenciaTotalEstado));
});
