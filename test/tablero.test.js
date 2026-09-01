import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haceCuanto, construirVistaTablero, escapar } from '../assets/js/tablero.js';

const AHORA = new Date('2026-08-31T22:00:00.000Z');

const TABLERO = {
  leidoEn: '2026-08-31T21:58:00.000Z',
  desdeCache: false,
  resumen: { vendido: 1500000000, abonado: 515000000, porCobrar: 985000000,
             disponible: 1833480000, gastadoObra: 620000000, caja: 48000000 },
  cartera: [{ lote: 1, area: 2754, comprador: 'Comprador de prueba uno',
              precio: 300000000, abonado: 30000000, saldo: 270000000,
              proximaCuotaFecha: '2027-02-19', proximaCuotaValor: 54000000,
              estado: 'Promesa',
              abonos: [{ fecha: '2026-08-25', valor: 30000000, medio: 'Transferencia' }] }],
  egresos: [
    { fecha: '2026-04-29', categoria: 'Acueducto', concepto: 'Red principal', valor: 99527738 },
    { fecha: '2026-03-31', categoria: 'Adecuaciones', concepto: 'Eugenios', valor: 8000000 },
    { fecha: '2026-05-10', categoria: 'Acueducto', concepto: 'Ramal', valor: 500000 }
  ],
  avisos: []
};

test('haceCuanto habla en español y en minutos', () => {
  assert.equal(haceCuanto('2026-08-31T21:58:00.000Z', AHORA), 'hace 2 minutos');
  assert.equal(haceCuanto('2026-08-31T21:59:30.000Z', AHORA), 'hace menos de un minuto');
  assert.equal(haceCuanto('2026-08-31T21:59:00.000Z', AHORA), 'hace 1 minuto');
  assert.equal(haceCuanto('2026-08-31T19:00:00.000Z', AHORA), 'hace 3 horas');
});

test('el sello de frescura siempre está', () => {
  assert.equal(construirVistaTablero(TABLERO, AHORA).frescura, 'Datos de hace 2 minutos');
});

test('si viene de caché lo dice de frente', () => {
  const v = construirVistaTablero({ ...TABLERO, desdeCache: true }, AHORA);
  assert.match(v.alerta, /no se pudo actualizar/i);
  assert.match(v.alerta, /hace 2 minutos/);
});

test('sin problemas no hay alerta', () => {
  assert.equal(construirVistaTablero(TABLERO, AHORA).alerta, null);
});

test('los seis números salen formateados en pesos', () => {
  const v = construirVistaTablero(TABLERO, AHORA);
  assert.equal(v.resumen.length, 6);
  assert.deepEqual(v.resumen[0], { etiqueta: 'Vendido', texto: '$1.500.000.000' });
  assert.equal(v.resumen.find(r => r.etiqueta === 'Disponible').texto, '$1.833.480.000');
});

test('un número en null se muestra como raya, jamás como cero', () => {
  const roto = { ...TABLERO, resumen: { ...TABLERO.resumen, caja: null } };
  const v = construirVistaTablero(roto, AHORA);
  assert.equal(v.resumen.find(r => r.etiqueta === 'Caja').texto, '—');
});

test('los egresos se agrupan por categoría y se ordenan de mayor a menor', () => {
  const g = construirVistaTablero(TABLERO, AHORA).egresosPorCategoria;
  assert.equal(g[0].categoria, 'Acueducto');
  assert.equal(g[0].total, 100027738);
  assert.equal(g[0].movimientos.length, 2);
  assert.equal(g[1].categoria, 'Adecuaciones');
});

test('la cartera trae sus abonos formateados', () => {
  const c = construirVistaTablero(TABLERO, AHORA).cartera[0];
  assert.equal(c.saldoTexto, '$270.000.000');
  assert.equal(c.abonos[0].valorTexto, '$30.000.000');
});

// El worker (worker/src/sheets.js) emite tres formas de aviso, no una sola:
//   - 'ilegible'        trae pestana, fila, columna y valor.
//   - 'pestana-vacia'   trae SOLO pestana. Sin fila, sin columna, sin valor.
//   - 'clave-faltante'  trae pestana y concepto. Tampoco trae fila, columna ni valor.
// Si se les da a las tres el mismo texto armado para 'ilegible', las otras dos
// salen en pantalla como "fila undefined, la columna undefined dice «undefined»".
// Cada tipo necesita su propio mensaje, en español claro, que le diga al socio
// qué revisar en su hoja.

test('aviso de celda ilegible: dice la pestaña, la fila, la columna y lo que decía', () => {
  const con = { ...TABLERO, avisos: [{ tipo: 'ilegible', pestana: 'Egresos', fila: 12, columna: 'Valor', valor: 'pendiente' }] };
  const v = construirVistaTablero(con, AHORA);
  assert.equal(v.avisos.length, 1);
  assert.match(v.avisos[0], /Egresos/);
  assert.match(v.avisos[0], /12/);
  assert.match(v.avisos[0], /Valor/);
  assert.match(v.avisos[0], /pendiente/);
  assert.doesNotMatch(v.avisos[0], /undefined/);
});

test('aviso de pestaña vacía: no menciona fila, columna ni valor porque no los tiene', () => {
  const con = { ...TABLERO, avisos: [{ tipo: 'pestana-vacia', pestana: 'Cartera' }] };
  const v = construirVistaTablero(con, AHORA);
  assert.equal(v.avisos.length, 1);
  assert.match(v.avisos[0], /Cartera/);
  assert.match(v.avisos[0], /vac[íi]a/i);
  assert.doesNotMatch(v.avisos[0], /undefined/);
});

test('aviso de clave faltante: nombra el concepto del Resumen que no apareció', () => {
  const con = { ...TABLERO, avisos: [{ tipo: 'clave-faltante', pestana: 'Resumen', concepto: 'Caja' }] };
  const v = construirVistaTablero(con, AHORA);
  assert.equal(v.avisos.length, 1);
  assert.match(v.avisos[0], /Resumen/);
  assert.match(v.avisos[0], /Caja/);
  assert.doesNotMatch(v.avisos[0], /undefined/);
});

test('los tres tipos de aviso pueden convivir sin pisarse', () => {
  const con = {
    ...TABLERO,
    avisos: [
      { tipo: 'ilegible', pestana: 'Egresos', fila: 12, columna: 'Valor', valor: 'pendiente' },
      { tipo: 'pestana-vacia', pestana: 'Abonos' },
      { tipo: 'clave-faltante', pestana: 'Resumen', concepto: 'Vendido' }
    ]
  };
  const v = construirVistaTablero(con, AHORA);
  assert.equal(v.avisos.length, 3);
  v.avisos.forEach(a => assert.doesNotMatch(a, /undefined/));
});

test('aviso de tipo desconocido: no imprime undefined y avisa con lo que tenga', () => {
  const con = { ...TABLERO, avisos: [{ tipo: 'un-tipo-que-el-worker-todavía-no-tiene', pestana: 'Cartera' }] };
  const v = construirVistaTablero(con, AHORA);
  assert.equal(v.avisos.length, 1);
  assert.match(v.avisos[0], /Cartera/);
  assert.doesNotMatch(v.avisos[0], /undefined/);
});

test('aviso de tipo desconocido sin pestana tampoco imprime undefined', () => {
  const con = { ...TABLERO, avisos: [{ tipo: 'otro-tipo-raro' }] };
  const v = construirVistaTablero(con, AHORA);
  assert.equal(v.avisos.length, 1);
  assert.match(v.avisos[0], /desconocida/);
  assert.doesNotMatch(v.avisos[0], /undefined/);
});

test('proximaCuotaTexto: con cuota programada muestra el valor y la fecha', () => {
  const c = construirVistaTablero(TABLERO, AHORA).cartera[0];
  assert.equal(c.proximaCuotaTexto, '$54.000.000 el 2027-02-19');
});

test('proximaCuotaTexto: sin cuota (null) dice que no hay cuota programada', () => {
  const sinCuota = {
    ...TABLERO,
    cartera: [{ ...TABLERO.cartera[0], proximaCuotaValor: null, proximaCuotaFecha: null }]
  };
  const c = construirVistaTablero(sinCuota, AHORA).cartera[0];
  assert.equal(c.proximaCuotaTexto, 'Sin cuota programada');
});

test('proximaCuotaTexto: una cuota de $0 real no desaparece — cero real no es lo mismo que null', () => {
  const cuotaCero = {
    ...TABLERO,
    cartera: [{ ...TABLERO.cartera[0], proximaCuotaValor: 0, proximaCuotaFecha: '2027-01-01' }]
  };
  const c = construirVistaTablero(cuotaCero, AHORA).cartera[0];
  assert.equal(c.proximaCuotaTexto, '$0 el 2027-01-01');
});

// --- Inyección de HTML desde la hoja de cálculo ---
// Cualquier texto libre que venga de la hoja (comprador, estado, medio,
// categoria, concepto, y lo que se arma dentro de los avisos) tiene que
// salir de construirVistaTablero ya escapado, para que socios/index.html
// pueda meterlo en innerHTML sin correr el riesgo de ejecutar HTML ajeno.

test('escapar neutraliza los caracteres peligrosos de HTML', () => {
  assert.equal(escapar(`<script>&"'</script>`), '&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
});

test('un comprador con HTML sale escapado, no interpretado', () => {
  const malicioso = {
    ...TABLERO,
    cartera: [{ ...TABLERO.cartera[0], comprador: '<img src=x onerror="window.__xss=1">' }]
  };
  const v = construirVistaTablero(malicioso, AHORA);
  assert.doesNotMatch(v.cartera[0].comprador, /<img/);
  assert.match(v.cartera[0].comprador, /&lt;img/);
  assert.match(v.cartera[0].comprador, /&quot;/);
});

test('un estado con <script> sale escapado, no interpretado', () => {
  const malicioso = {
    ...TABLERO,
    cartera: [{ ...TABLERO.cartera[0], estado: '<script>alert(1)</script>' }]
  };
  const v = construirVistaTablero(malicioso, AHORA);
  assert.doesNotMatch(v.cartera[0].estado, /<script>/);
  assert.match(v.cartera[0].estado, /&lt;script&gt;/);
});

test('un medio de pago con HTML y comillas sale escapado, no interpretado', () => {
  const malicioso = {
    ...TABLERO,
    cartera: [{
      ...TABLERO.cartera[0],
      abonos: [{ fecha: '2026-08-25', valor: 30000000, medio: '"><img src=x onerror=alert(1)>' }]
    }]
  };
  const v = construirVistaTablero(malicioso, AHORA);
  assert.doesNotMatch(v.cartera[0].abonos[0].medio, /<img/);
  assert.match(v.cartera[0].abonos[0].medio, /&quot;&gt;&lt;img/);
});

test('una categoría de egreso con HTML sale escapada, no interpretada', () => {
  const malicioso = {
    ...TABLERO,
    egresos: [{ fecha: '2026-04-29', categoria: '<img src=x onerror=alert(1)>', concepto: 'Red', valor: 1000 }]
  };
  const v = construirVistaTablero(malicioso, AHORA);
  assert.doesNotMatch(v.egresosPorCategoria[0].categoria, /<img/);
  assert.match(v.egresosPorCategoria[0].categoria, /&lt;img/);
});

test('un concepto de egreso con HTML sale escapado, no interpretado', () => {
  const malicioso = {
    ...TABLERO,
    egresos: [{ fecha: '2026-04-29', categoria: 'Acueducto', concepto: '<script>alert(1)</script>', valor: 1000 }]
  };
  const v = construirVistaTablero(malicioso, AHORA);
  assert.doesNotMatch(v.egresosPorCategoria[0].movimientos[0].concepto, /<script>/);
  assert.match(v.egresosPorCategoria[0].movimientos[0].concepto, /&lt;script&gt;/);
});

test('un aviso con HTML en sus campos sale escapado, no interpretado', () => {
  const con = {
    ...TABLERO,
    avisos: [{
      tipo: 'ilegible', pestana: '<img src=x onerror=alert(1)>', fila: 1,
      columna: 'Valor', valor: '<script>alert(2)</script>'
    }]
  };
  const v = construirVistaTablero(con, AHORA);
  assert.doesNotMatch(v.avisos[0], /<img/);
  assert.doesNotMatch(v.avisos[0], /<script>/);
  assert.match(v.avisos[0], /&lt;img/);
  assert.match(v.avisos[0], /&lt;script&gt;/);
});

// --- Revisión final, hallazgo 1: los campos de FECHA llegaban sin escapar ---
// El comentario de assets/js/tablero.js decía que todo texto libre pasaba por
// `escapar`, y era falso: proximaCuotaFecha, abonos[].fecha y egresos[].fecha
// entraban por spread y salían crudos a innerHTML. Una prueba por cada uno, más
// una que fija el contrato: escapar en el borde, no por lista blanca de campos.

test('una proximaCuotaFecha con HTML sale escapada, no interpretada', () => {
  const malicioso = {
    ...TABLERO,
    cartera: [{
      ...TABLERO.cartera[0],
      proximaCuotaValor: 5000000,
      proximaCuotaFecha: '<img src=x onerror="window.__xss=1">'
    }]
  };
  const c = construirVistaTablero(malicioso, AHORA).cartera[0];
  assert.doesNotMatch(c.proximaCuotaFecha, /<img/);
  assert.doesNotMatch(c.proximaCuotaTexto, /<img/);
  assert.match(c.proximaCuotaTexto, /&lt;img/);
  assert.match(c.proximaCuotaTexto, /&quot;/);
});

test('la fecha de un abono con HTML sale escapada, no interpretada', () => {
  const malicioso = {
    ...TABLERO,
    cartera: [{
      ...TABLERO.cartera[0],
      abonos: [{ fecha: '<script>alert(2)</script>', valor: 30000000, medio: 'Transferencia' }]
    }]
  };
  const a = construirVistaTablero(malicioso, AHORA).cartera[0].abonos[0];
  assert.doesNotMatch(a.fecha, /<script>/);
  assert.match(a.fecha, /&lt;script&gt;/);
});

test('la fecha de un egreso con HTML sale escapada, no interpretada', () => {
  const malicioso = {
    ...TABLERO,
    egresos: [{ fecha: '"><svg onload=alert(3)>', categoria: 'Acueducto', concepto: 'Red', valor: 1000 }]
  };
  const m = construirVistaTablero(malicioso, AHORA).egresosPorCategoria[0].movimientos[0];
  assert.doesNotMatch(m.fecha, /<svg/);
  assert.match(m.fecha, /&quot;&gt;&lt;svg/);
});

test('ningún texto de la cartera, sus abonos ni los egresos sale con HTML crudo', () => {
  const CARGA = '<img src=x onerror=alert(1)>';
  const malicioso = {
    ...TABLERO,
    cartera: [{
      lote: 1, area: 2754, comprador: CARGA, precio: 1, abonado: 1, saldo: 1,
      proximaCuotaFecha: CARGA, proximaCuotaValor: 1, estado: CARGA,
      abonos: [{ fecha: CARGA, valor: 1, medio: CARGA }]
    }],
    egresos: [{ fecha: CARGA, categoria: CARGA, concepto: CARGA, valor: 1 }]
  };
  const v = construirVistaTablero(malicioso, AHORA);
  const textos = [
    ...Object.values(v.cartera[0]).filter(x => typeof x === 'string'),
    ...Object.values(v.cartera[0].abonos[0]).filter(x => typeof x === 'string'),
    ...Object.values(v.egresosPorCategoria[0]).filter(x => typeof x === 'string'),
    ...Object.values(v.egresosPorCategoria[0].movimientos[0]).filter(x => typeof x === 'string')
  ];
  assert.ok(textos.length > 0);
  for (const t of textos) assert.doesNotMatch(t, /<img/, `salió sin escapar: ${t}`);
});

test('un campo de texto nuevo del worker sale escapado por omisión, sin tener que agregarlo a una lista', () => {
  const malicioso = {
    ...TABLERO,
    cartera: [{ ...TABLERO.cartera[0], notaDelWorker: '<script>alert(9)</script>' }],
    egresos: [{ fecha: '2026-04-29', categoria: 'Acueducto', concepto: 'Red', valor: 1000, referencia: '<b>x</b>' }]
  };
  const v = construirVistaTablero(malicioso, AHORA);
  assert.doesNotMatch(v.cartera[0].notaDelWorker, /<script>/);
  assert.doesNotMatch(v.egresosPorCategoria[0].movimientos[0].referencia, /<b>/);
});

// --- Revisión final, hallazgo 2: la cuota ilegible no puede afirmar que no hay cuota ---
test('una próxima cuota ilegible no dice «Sin cuota programada»', () => {
  const roto = {
    ...TABLERO,
    cartera: [{ ...TABLERO.cartera[0], proximaCuotaValor: null, proximaCuotaIlegible: true, proximaCuotaFecha: '2027-03-01' }]
  };
  const c = construirVistaTablero(roto, AHORA).cartera[0];
  assert.doesNotMatch(c.proximaCuotaTexto, /sin cuota programada/i);
  assert.match(c.proximaCuotaTexto, /no se pudo leer/i);
  assert.doesNotMatch(c.proximaCuotaTexto, /\$/, 'un dato ilegible nunca sale como cifra en pesos');
});

test('sin la marca de ilegible, una cuota ausente sigue diciendo que no hay cuota', () => {
  const sinCuota = {
    ...TABLERO,
    cartera: [{ ...TABLERO.cartera[0], proximaCuotaValor: null, proximaCuotaIlegible: false, proximaCuotaFecha: '' }]
  };
  const c = construirVistaTablero(sinCuota, AHORA).cartera[0];
  assert.equal(c.proximaCuotaTexto, 'Sin cuota programada');
});

// --- Revisión final, hallazgo 6: un total sumado sobre filas incompletas ---
// El worker descarta la fila de egreso ilegible (con aviso) y la vista sumaba las
// que quedaron, presentándolas con el mismo formato que un total correcto. Era el
// único camino que quedaba por el que un dato ilegible se mostraba como una cifra
// en pesos que parece real. El aviso existe, pero vive al final de la página, sin
// ninguna relación visual con la categoría afectada.

const CON_CATEGORIA_INCOMPLETA = {
  ...TABLERO,
  egresos: [
    { fecha: '2026-05-01', categoria: 'Vías', concepto: 'Base', valor: 9000000 },
    { fecha: '2026-05-03', categoria: 'Vías', concepto: 'Afirmado', valor: 4000000 },
    { fecha: '2026-03-31', categoria: 'Adecuaciones', concepto: 'Eugenios', valor: 8000000 }
  ],
  avisos: [{ tipo: 'ilegible', pestana: 'Egresos', fila: 3, columna: 'Valor', valor: '1.5', categoria: 'Vías' }]
};

test('el total de una categoría con filas sin leer se muestra marcado, junto a la cifra', () => {
  const g = construirVistaTablero(CON_CATEGORIA_INCOMPLETA, AHORA)
    .egresosPorCategoria.find(x => x.categoria === 'Vías');
  assert.equal(g.incompleto, true);
  assert.equal(g.filasSinLeer, 1);
  assert.match(g.totalTexto, /\$13\.000\.000/, 'la cifra parcial sigue siendo útil');
  assert.match(g.totalTexto, /sin leer/i, 'pero nunca puede viajar sola');
  assert.notEqual(g.totalTexto, '$13.000.000');
});

test('la marca de incompleto no se le pega a las categorías sanas', () => {
  const g = construirVistaTablero(CON_CATEGORIA_INCOMPLETA, AHORA)
    .egresosPorCategoria.find(x => x.categoria === 'Adecuaciones');
  assert.equal(g.incompleto, false);
  assert.equal(g.filasSinLeer, 0);
  assert.equal(g.totalTexto, '$8.000.000');
});

test('dos filas sin leer en la misma categoría se cuentan en plural', () => {
  const dos = {
    ...CON_CATEGORIA_INCOMPLETA,
    avisos: [
      { tipo: 'ilegible', pestana: 'Egresos', fila: 3, columna: 'Valor', valor: '1.5', categoria: 'Vías' },
      { tipo: 'ilegible', pestana: 'Egresos', fila: 7, columna: 'Valor', valor: '#REF!', categoria: 'Vías' }
    ]
  };
  const g = construirVistaTablero(dos, AHORA).egresosPorCategoria.find(x => x.categoria === 'Vías');
  assert.equal(g.filasSinLeer, 2);
  assert.match(g.totalTexto, /2 movimientos sin leer/i);
});

test('un aviso de otra pestaña no marca ninguna categoría de egresos', () => {
  const otra = {
    ...CON_CATEGORIA_INCOMPLETA,
    avisos: [{ tipo: 'ilegible', pestana: 'Cartera', fila: 3, columna: 'Precio', valor: '1.5' }]
  };
  const v = construirVistaTablero(otra, AHORA);
  assert.ok(v.egresosPorCategoria.every(g => g.incompleto === false));
});

test('una categoría marcada con HTML en el nombre casa igual y sale escapada', () => {
  const con = {
    ...TABLERO,
    egresos: [{ fecha: '2026-05-01', categoria: '<b>Vías</b>', concepto: 'Base', valor: 9000000 }],
    avisos: [{ tipo: 'ilegible', pestana: 'Egresos', fila: 3, columna: 'Valor', valor: '1.5', categoria: '<b>Vías</b>' }]
  };
  const g = construirVistaTablero(con, AHORA).egresosPorCategoria[0];
  assert.equal(g.incompleto, true);
  assert.doesNotMatch(g.categoria, /<b>/);
});

// --- «Tablero Socios»: escapar en el borde y formatear las cifras ---------
// Los socios de estos datos son inventados. Los nombres reales viven en la
// hoja y no entran al repositorio (ver test/secretos.test.js).

const CON_SOCIOS = {
  ...TABLERO,
  socios: [
    {
      nombre: 'Sociedad Primera S.A.S.',
      participacion: 0.33,
      pagos: [
        { etiqueta: 'Escritura dic-2024', valor: 400000000 },
        { etiqueta: 'Compromiso jun-2025', valor: 165000000 },
        { etiqueta: 'Adicional jul-2025', valor: 100000000 },
        { etiqueta: 'Compromiso dic-2025', valor: 528000000 }
      ],
      total: 1193000000
    }
  ]
};

test('la participación de la hoja llega al front en porcentaje, no en fracción', () => {
  const s = construirVistaTablero(CON_SOCIOS, AHORA).socios[0];
  assert.equal(s.participacionTexto, '33 %');
  assert.notEqual(s.participacionTexto, '0.33');
  assert.equal(s.participacion, 0.33, 'el número crudo sigue disponible para calcular');
});

test('los aportes y el total del socio salen formateados en pesos', () => {
  const s = construirVistaTablero(CON_SOCIOS, AHORA).socios[0];
  assert.equal(s.totalTexto, '$1.193.000.000');
  assert.equal(s.pagos[0].valorTexto, '$400.000.000');
  assert.equal(s.pagos[0].etiqueta, 'Escritura dic-2024');
});

test('un aporte en null sale como raya y jamás como $0', () => {
  const roto = {
    ...CON_SOCIOS,
    socios: [{ ...CON_SOCIOS.socios[0], total: null, pagos: [{ etiqueta: 'Escritura dic-2024', valor: null }] }]
  };
  const s = construirVistaTablero(roto, AHORA).socios[0];
  assert.equal(s.totalTexto, '—');
  assert.equal(s.pagos[0].valorTexto, '—');
  assert.notEqual(s.totalTexto, '$0');
});

test('un aporte de $0 real sí sale como $0', () => {
  const enCero = {
    ...CON_SOCIOS,
    socios: [{ ...CON_SOCIOS.socios[0], pagos: [{ etiqueta: 'Escritura dic-2024', valor: 0 }] }]
  };
  const s = construirVistaTablero(enCero, AHORA).socios[0];
  assert.equal(s.pagos[0].valorTexto, '$0');
});

test('una participación ilegible sale como raya, no como 0 %', () => {
  const roto = { ...CON_SOCIOS, socios: [{ ...CON_SOCIOS.socios[0], participacion: null }] };
  const s = construirVistaTablero(roto, AHORA).socios[0];
  assert.equal(s.participacionTexto, '—');
  assert.notEqual(s.participacionTexto, '0 %');
});

test('el nombre del socio y el rótulo del aporte salen escapados, no interpretados', () => {
  const malicioso = {
    ...CON_SOCIOS,
    socios: [{
      ...CON_SOCIOS.socios[0],
      nombre: '<img src=x onerror="window.__xss=1">',
      pagos: [{ etiqueta: '"><svg onload=alert(1)>', valor: 1000 }]
    }]
  };
  const s = construirVistaTablero(malicioso, AHORA).socios[0];
  assert.doesNotMatch(s.nombre, /<img/);
  assert.match(s.nombre, /&lt;img/);
  assert.match(s.nombre, /&quot;/);
  assert.doesNotMatch(s.pagos[0].etiqueta, /<svg/);
  assert.match(s.pagos[0].etiqueta, /&quot;&gt;&lt;svg/);
});

test('sin pestaña de socios el tablero devuelve una lista vacía, no revienta', () => {
  assert.deepEqual(construirVistaTablero(TABLERO, AHORA).socios, []);
});
