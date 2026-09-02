import { validarInventario, resumenInventario } from './inventario.js';
import { metros } from './formato.js';

// El plano de lotes se pinta desde data/lotes.json.
//
// img/mapa.svg trae SOLO geometría: un <path> por lote con su data-lote, los
// paneles y los anclajes de los rótulos. Ni un color de estado, ni un número,
// ni un área escritos adentro. Todo eso lo pone este módulo.
//
// Antes el plano era un JPG con los colores quemados y una huella
// (img/mapa-estado.json) que una prueba comparaba contra el inventario para
// avisar cuando el plano había quedado desactualizado. Esa guarda existía
// porque el defecto era posible. Ahora no lo es: el color sale del mismo dato
// que el titular y los precios, así que no hay dos versiones que puedan
// separarse.

// Lo que se escribe ENCIMA del lote en el plano. Solo el vendido lleva
// palabra: sobre la ortofoto un verde translucido y un gris translucido sobre
// pasto se parecen mas de lo que uno cree, y la palabra cierra la duda.
//
// El de pago en especie NO la lleva aunque se pinte igual de gris. No se
// vendio: se entrego como pago, y por el no entro un peso. Decirle «vendido»
// en la pagina publica seria de los pocos textos que un socio puede leer y
// saber que no es cierto.
const MARCA = {
  vendido: 'VENDIDO'
};

// Cómo se lee cada estado en el plano. «especie» es un lote entregado como
// pago en especie: no está en venta, así que se ve igual que uno vendido —
// pero se conserva el estado propio para que el rótulo accesible diga la
// verdad y no lo llame «vendido».
const LEIDO = {
  disponible: 'disponible',
  reservado: 'reservado',
  vendido: 'vendido',
  especie: 'pago en especie'
};

function rangoDeSector(lotes) {
  const ns = lotes.map(l => l.n).sort((a, b) => a - b);
  const contiguo = ns.every((n, i) => i === 0 || n === ns[i - 1] + 1);
  return contiguo && ns.length > 1
    ? `lotes ${ns[0]} a ${ns[ns.length - 1]}`
    : `${ns.length} ${ns.length === 1 ? 'lote' : 'lotes'}`;
}

export function construirVistaMapa(json) {
  validarInventario(json);
  const r = resumenInventario(json);

  const sectores = [...new Set(json.lotes.map(l => l.sector))]
    .sort((a, b) => a - b)
    .map(s => ({
      sector: s,
      texto: `Sector ${s} · ${rangoDeSector(json.lotes.filter(l => l.sector === s))}`
    }));

  return {
    titulo:
      `Plano del loteo. ${r.disponibles} ` +
      `${r.disponibles === 1 ? 'lote disponible' : 'lotes disponibles'} en verde, ` +
      `${r.colocados} ${r.colocados === 1 ? 'colocado' : 'colocados'} en gris` +
      // La frase de los reservados solo aparece si hay alguno. Un plano sin
      // reservados no tiene por qué nombrar un estado que no está en pantalla.
      (r.reservados
        ? `, ${r.reservados} ${r.reservados === 1 ? 'reservado' : 'reservados'} en dorado.`
        : '.'),
    reservados: r.reservados,
    sectores,
    lotes: [...json.lotes].sort((a, b) => a.n - b.n).map(l => ({
      n: l.n,
      estado: l.estado,
      numeroTexto: String(l.n),
      areaTexto: metros(l.area),
      marcaTexto: MARCA[l.estado] ?? '',
      // Lo que lee un lector de pantalla y lo que sale al pasar el mouse.
      descripcion: `Lote ${l.n} · ${metros(l.area)} · ${LEIDO[l.estado]}`
    }))
  };
}

// Pinta el SVG ya montado en el documento. Falla fuerte si el plano y el
// inventario no hablan del mismo conjunto de lotes: es justo el caso en que
// callar deja un lote con dueño pintado de verde en una página de venta.
export function pintarMapa(svg, json) {
  const vista = construirVistaMapa(json);

  const enElPlano = new Set(
    [...svg.querySelectorAll('.lote[data-lote]')].map(p => p.dataset.lote)
  );
  const enElDato = new Set(vista.lotes.map(l => String(l.n)));

  const sinPoligono = [...enElDato].filter(n => !enElPlano.has(n));
  const sinDato = [...enElPlano].filter(n => !enElDato.has(n));
  if (sinPoligono.length || sinDato.length) {
    throw new Error(
      'El plano y el inventario no coinciden. ' +
      (sinPoligono.length ? `Sin polígono en img/mapa.svg: ${sinPoligono.join(', ')}. ` : '') +
      (sinDato.length ? `Sin dato en data/lotes.json: ${sinDato.join(', ')}. ` : '') +
      'Hay que regenerar el plano: ver herramientas/preparar-mapa.py.'
    );
  }

  const titulo = svg.querySelector('#mapa-titulo');
  if (titulo) titulo.textContent = vista.titulo;

  for (const s of vista.sectores) {
    const t = svg.querySelector(`.titulo-sector[data-sector="${s.sector}"]`);
    if (t) t.textContent = s.texto;
  }

  for (const l of vista.lotes) {
    const poligono = svg.querySelector(`.lote[data-lote="${l.n}"]`);
    poligono.setAttribute('data-estado', l.estado);
    // <title> dentro del <path>: es el globo del mouse y lo que anuncia el
    // lector de pantalla. Se reutiliza si ya está, para poder repintar.
    let rotuloAccesible = poligono.querySelector('title');
    if (!rotuloAccesible) {
      rotuloAccesible = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      poligono.appendChild(rotuloAccesible);
    }
    rotuloAccesible.textContent = l.descripcion;

    const rotulo = svg.querySelector(`.rotulo-lote[data-lote="${l.n}"]`);
    if (!rotulo) continue;
    rotulo.setAttribute('data-estado', l.estado);
    rotulo.querySelector('.numero').textContent = l.numeroTexto;
    rotulo.querySelector('.area').textContent = l.areaTexto;
    // Solo el plano aereo trae este elemento; el esquematico no lo necesita.
    const marca = rotulo.querySelector('.marca');
    if (marca) marca.textContent = l.marcaTexto;
  }

  return vista;
}
