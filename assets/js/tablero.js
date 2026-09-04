import { pesos, porcentaje } from './formato.js?v=f9e76070';

const ETIQUETAS = [
  ['vendido', 'Vendido'], ['abonado', 'Abonado'], ['porCobrar', 'Por cobrar'],
  ['disponible', 'Disponible'], ['gastadoObra', 'Gastado en obra'], ['caja', 'Caja']
];

const texto = (n) => (n === null || n === undefined ? '—' : pesos(n));

// Neutraliza los caracteres que convierten texto en HTML/JS ejecutable.
// socios/index.html mete el resultado de construirVistaTablero en innerHTML,
// así que cualquier texto que venga de la hoja de Google tiene que salir de
// acá ya neutralizado o se ejecuta HTML ajeno (inyección almacenada vía la
// hoja de cálculo).
export function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Escapa TODO el texto de lo que le pasen —campos, arreglos y objetos anidados—
// sin lista blanca de campos.
//
// Antes se escapaba campo por nombre después de un spread (`...c`), y así
// quedaron sin escapar los tres campos de fecha —proximaCuotaFecha,
// abonos[].fecha y egresos[].fecha— que llegaban crudos hasta innerHTML. El
// defecto era estructural, no un olvido: la lista de campos protegidos era
// implícita, así que cualquier campo nuevo del worker nacía desprotegido. Acá se
// invierte la omisión: se escapa todo lo que sea texto, y lo que no lo sea
// (números, booleanos, nulos) pasa como viene, porque no puede ser HTML.
function escaparTextos(valor) {
  if (typeof valor === 'string') return escapar(valor);
  if (Array.isArray(valor)) return valor.map(escaparTextos);
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([c, v]) => [c, escaparTextos(v)]));
  }
  return valor;
}

// La próxima cuota tiene TRES estados, no dos (ver worker/src/sheets.js):
//   - valor legible, incluido un $0 real -> se muestra la cifra y la fecha.
//     Antes se comprobaba con "c.proximaCuotaValor ?" (verdad/falsedad de JS),
//     que trata 0 igual que null: una cuota real de $0 desaparecía.
//   - celda vacía -> «Sin cuota programada». Eso sí es una afirmación cierta.
//   - celda ilegible (#REF!, "1.5", texto) -> NO se puede afirmar que no hay
//     cuota. Un dato que no se pudo leer convertido en «este comprador no tiene
//     cuota pendiente» es una afirmación de negocio falsa y definitiva, peor que
//     un número raro porque nadie va a ir a revisarla.
function textoProximaCuota(c) {
  if (c.proximaCuotaIlegible) return 'No se pudo leer la próxima cuota. Revisá la hoja.';
  if (c.proximaCuotaValor === null || c.proximaCuotaValor === undefined) return 'Sin cuota programada';
  const fecha = String(c.proximaCuotaFecha ?? '').trim();
  return fecha ? `${texto(c.proximaCuotaValor)} el ${fecha}` : texto(c.proximaCuotaValor);
}

export function haceCuanto(iso, ahora = new Date()) {
  const minutos = Math.floor((ahora.getTime() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return 'hace menos de un minuto';
  if (minutos === 1) return 'hace 1 minuto';
  if (minutos < 60) return `hace ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas === 1) return 'hace 1 hora';
  if (horas < 24) return `hace ${horas} horas`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
}

// El worker (worker/src/sheets.js) emite tres formas de aviso y no comparten campos:
//   'ilegible'       -> pestana, fila, columna, valor (+ categoria si es de Egresos)
//   'pestana-vacia'  -> solo pestana
//   'clave-faltante' -> pestana ('Resumen'), concepto
// Cada una arma su propio mensaje. Si un tipo nuevo llega sin reconocerse, se avisa
// igual con lo que haya (pestana) en vez de imprimir "undefined" en la pantalla.
// El mensaje se arma primero con los datos crudos de la hoja y se escapa
// al final completo: la pestaña, la fila, la columna, el valor o el
// concepto pueden traer HTML si alguien pegó mal un dato, y ese texto
// termina en innerHTML en socios/index.html.
function textoAviso(a) {
  let mensaje;
  switch (a.tipo) {
    case 'ilegible':
      mensaje = `En la pestaña ${a.pestana}, fila ${a.fila}, la columna ${a.columna} dice «${a.valor}» y no es un número. Esa fila quedó por fuera del total.`;
      break;
    case 'pestana-vacia':
      mensaje = `La pestaña ${a.pestana} llegó vacía. Revisá que no se haya movido, renombrado o borrado.`;
      break;
    case 'clave-faltante':
      mensaje = `En la pestaña ${a.pestana} falta la fila «${a.concepto}». Revisá que no se haya renombrado o borrado.`;
      break;
    default:
      mensaje = `Hay un problema con la pestaña ${a.pestana ?? 'desconocida'}. Revisá la hoja.`;
  }
  return escapar(mensaje);
}

export function construirVistaTablero(tablero, ahora = new Date()) {
  const cuando = haceCuanto(tablero.leidoEn, ahora);

  const porCategoria = new Map();
  for (const e of tablero.egresos ?? []) {
    if (!porCategoria.has(e.categoria)) porCategoria.set(e.categoria, []);
    porCategoria.get(e.categoria).push(e);
  }

  // Cuántas filas quedaron por fuera de cada categoría. El worker descarta la
  // fila de egreso con valor ilegible y avisa, pero el aviso vive al final de la
  // página: sin esto, el total de la categoría se sumaba sobre las filas que
  // quedaron y salía con el mismo formato que un total completo — una cifra en
  // pesos, con separadores de miles, en negrilla, y equivocada. Era el único
  // camino que quedaba por el que un dato ilegible se mostraba como plata real.
  //
  // Una categoría en la que TODAS las filas quedaron ilegibles no arma grupo y no
  // aparece: no hay total que marcar. No se muestra un número falso —la regla se
  // cumple— y el aviso del final la reporta igual, fila por fila.
  const sinLeerPorCategoria = new Map();
  for (const a of tablero.avisos ?? []) {
    if (a.tipo !== 'ilegible' || a.pestana !== 'Egresos') continue;
    const cat = a.categoria ?? 'Sin categoría';
    sinLeerPorCategoria.set(cat, (sinLeerPorCategoria.get(cat) ?? 0) + 1);
  }

  return {
    frescura: `Datos de ${cuando}`,
    alerta: tablero.desdeCache
      ? `No se pudo actualizar la información. Estás viendo la última lectura buena, de ${cuando}.`
      : null,
    resumen: ETIQUETAS.map(([clave, etiqueta]) => ({
      etiqueta,
      texto: texto(tablero.resumen?.[clave])
    })),
    cartera: (tablero.cartera ?? []).map(c => {
      const seguro = escaparTextos(c);
      return {
        ...seguro,
        comprador: seguro.comprador ?? '',
        estado: seguro.estado ?? '',
        proximaCuotaFecha: seguro.proximaCuotaFecha ?? '',
        precioTexto: texto(c.precio),
        abonadoTexto: texto(c.abonado),
        saldoTexto: texto(c.saldo),
        proximaCuotaTexto: textoProximaCuota(seguro),
        // `seguro.abonos` ya viene escapado de raíz: escaparTextos entra a los
        // arreglos y a los objetos de adentro. Los números pasaron intactos, así
        // que `a.valor` sigue siendo el número que formatea `texto`.
        abonos: (seguro.abonos ?? []).map(a => ({
          ...a,
          fecha: a.fecha ?? '',
          medio: a.medio ?? '',
          valorTexto: texto(a.valor)
        }))
      };
    }),
    // Los socios y lo que puso cada uno por la tierra. Acá solo se escapa y se
    // formatea, fila por fila: la aritmética de la tabla —el orden, el total de
    // los seis y cuánto se aparta cada uno de lo que le tocaba— necesita ver el
    // conjunto y vive en `construirVistaSocios` (assets/js/paneles.js).
    //
    // `seguro` conserva los números intactos (escaparTextos solo toca cadenas),
    // así que `s.participacion` y `s.total` siguen sirviendo para calcular.
    socios: (tablero.socios ?? []).map(s => {
      const seguro = escaparTextos(s);
      return {
        ...seguro,
        nombre: seguro.nombre ?? '',
        participacionTexto: typeof s.participacion === 'number'
          ? porcentaje(s.participacion)
          : '—',
        pagos: (seguro.pagos ?? []).map(p => ({
          ...p,
          etiqueta: p.etiqueta ?? '',
          valorTexto: texto(p.valor)
        })),
        totalTexto: texto(s.total)
      };
    }),
    // La caja llega tal como la manda el worker —fila por fila y en el orden de
    // la hoja—, solo escapada. Acá no se formatea ninguna cifra a propósito: el
    // formato de la fila depende de su TIPO (una suma lleva su «+» delante, un
    // saldo no) y esa decisión, junto con la de qué hacer con un tipo
    // desconocido, vive completa en `construirVistaCaja` (assets/js/paneles.js).
    // Partirla en dos archivos era la forma de que una mitad contradijera a la otra.
    //
    // `escaparTextos` no toca los números, así que `f.valor` sigue sirviendo
    // para calcular del otro lado.
    caja: (tablero.caja ?? []).map(f => {
      const seguro = escaparTextos(f);
      return {
        ...seguro,
        concepto: seguro.concepto ?? '',
        texto: seguro.texto ?? '',
        tipo: seguro.tipo ?? ''
      };
    }),
    egresosPorCategoria: [...porCategoria.entries()]
      .map(([categoria, movimientos]) => {
        const total = movimientos.reduce((t, m) => t + m.valor, 0);
        // El conteo se cruza contra la categoría CRUDA, antes de escaparla: el
        // aviso viene del worker con el mismo texto original.
        const sinLeer = sinLeerPorCategoria.get(categoria) ?? 0;
        return {
          categoria: escapar(categoria ?? ''),
          total,
          incompleto: sinLeer > 0,
          filasSinLeer: sinLeer,
          // La marca va PEGADA a la cifra, no en un campo aparte: así ninguna
          // plantilla puede mostrar el número sin mostrar que está incompleto.
          totalTexto: sinLeer > 0
            ? `${texto(total)} + ${sinLeer} ${sinLeer === 1 ? 'movimiento' : 'movimientos'} sin leer`
            : texto(total),
          movimientos: movimientos.map(m => {
            const mov = escaparTextos(m);
            return { ...mov, fecha: mov.fecha ?? '', concepto: mov.concepto ?? '', valorTexto: texto(m.valor) };
          })
        };
      })
      .sort((a, b) => b.total - a.total),
    avisos: (tablero.avisos ?? []).map(textoAviso)
  };
}
