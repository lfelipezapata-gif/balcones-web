// La ficha de un lote de la vitrina pública: lo que se ve al hacer clic en el
// plano o en una tarjeta.
//
// Es la hermana pública de `fichaDeLote` de assets/js/paneles.js. Aquella
// trabaja sobre la vista del tablero de socios porque ahí entra texto libre de
// una hoja de Google y hay que escaparlo. Acá no: todo sale de data/lotes.json,
// que `validarInventario` ya deja en números y estados de una lista cerrada.
// Por eso esta ficha puede armarse directo del inventario y aquella no.

import { validarInventario, precioDeLote } from './inventario.js';
import { pesos, metros } from './formato.js';

// El número de ventas. Vive acá y el pie de página de index.html lo repite;
// una prueba comprueba que sean el mismo, que es la única forma de que no se
// separen el día que lo cambien en un solo lado.
export const WHATSAPP = '573203769226';

// Cómo se titula cada estado dentro de la ficha. En mayúscula inicial porque
// va solo, como rótulo. En mapa.js hay otro mapa parecido en minúscula: ese va
// dentro de una frase que lee el lector de pantalla («Lote 2 · 2.746 m² · pago
// en especie»). Son dos presentaciones distintas del mismo dato, no una copia.
const ETIQUETA = {
  disponible: 'Disponible',
  reservado: 'Reservado',
  vendido: 'Vendido',
  especie: 'Pago en especie'
};

// Un lote entregado como pago en especie no está vendido, pero tampoco está en
// venta. Para la vitrina lo único que importa es si se puede pedir.
const seVende = (estado) => estado === 'disponible';

function enlaceWhatsApp(n, areaTexto) {
  const texto = `¡Hola! Quiero información del lote ${n} de Balcones (${areaTexto}).`;
  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texto)}`;
}

export function construirFichaLote(json, n) {
  validarInventario(json);

  const lote = json.lotes.find(l => l.n === n);
  if (!lote) {
    throw new Error(`El inventario no tiene ningún lote ${n}.`);
  }

  const areaTexto = metros(lote.area);
  const disponible = seVende(lote.estado);

  return {
    n: lote.n,
    sector: lote.sector,
    titulo: `Lote ${lote.n}`,
    areaTexto,
    precioTexto: pesos(precioDeLote(lote, json.precioM2)),
    precioM2Texto: pesos(json.precioM2),
    estado: lote.estado,
    estadoTexto: ETIQUETA[lote.estado],
    disponible,
    // Sin foto, `null`. La ficha no muestra pestaña de 360 y no se carga nada:
    // una panorámica pesa lo que pesan todas las demás imágenes juntas, así que
    // no puede entrar al vuelo con la página.
    pano: lote.pano ?? null,
    whatsapp: disponible ? enlaceWhatsApp(lote.n, areaTexto) : null
  };
}

// El visor 360.
//
// El corte de arriba (`maxPitch`) es lo importante. El gimbal del dron no
// alcanza a apuntar derecho al cielo, así que toda esférica sale con un hueco
// en el cenit —un tapón gris o negro— que el visor mostraría feliz si se lo
// permite. Cortando la mirada antes de llegar ahí, el hueco no existe para el
// que mira. Hacia abajo no se corta: el dron sí fotografía el suelo, y el
// suelo es el lote que se está vendiendo.
//
// 50° es el punto de partida. Con la primera panorámica real hay que subirlo
// o bajarlo mirando hasta dónde llega el hueco de este dron en particular:
// el gimbal del Mini 5 Pro gira 225° y el hueco puede ser más chico que el de
// los modelos viejos.
const MAX_PITCH = 50;

export function configPano(ficha) {
  if (!ficha.pano) return null;
  return {
    type: 'equirectangular',
    panorama: ficha.pano,
    autoLoad: true,
    // Gira solo, muy despacio, hasta que alguien la toca. Sin esto se ve como
    // una foto quieta y rara: nadie adivina que se puede arrastrar.
    autoRotate: -2,
    autoRotateInactivityDelay: 3000,
    maxPitch: MAX_PITCH,
    minPitch: -90,
    hfov: 100,
    minHfov: 50,
    maxHfov: 120,
    showFullscreenCtrl: false,
    keyboardZoom: false
  };
}

// ─────────────────────────────────────────────────────────────────────────
// De acá para abajo se toca el documento. La parte de arriba es la que se
// prueba: `construirFichaLote` no sabe que existe un navegador.
// ─────────────────────────────────────────────────────────────────────────

// Pannellum entra la primera vez que se abre un lote con panorámica, no en la
// carga de la página. Son 66 KB entre las dos piezas y la gran mayoría de las
// visitas no van a abrir un 360.
let pannellum = null;

function cargarPannellum() {
  if (pannellum) return pannellum;
  pannellum = new Promise((listo, falla) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/pannellum.css';
    document.head.appendChild(css);

    const js = document.createElement('script');
    js.src = 'vendor/pannellum.js';
    js.onload = listo;
    js.onerror = () => falla(new Error('No se pudo cargar vendor/pannellum.js'));
    document.head.appendChild(js);
  });
  return pannellum;
}

// Los polígonos del plano son el blanco natural en un computador y el peor
// posible en un teléfono: el lote 7 son 2.129 m² que en una pantalla de 390 px
// quedan del tamaño de una uña. Por eso el mismo diálogo se abre también desde
// las tarjetas de abajo, que sí son un blanco de dedo. Las dos entradas van al
// mismo sitio; ninguna de las dos es la de repuesto.
export function montarFicha(json, { svg, tarjetas, dialogo }) {
  if (typeof dialogo?.showModal !== 'function') return;

  const poner = (selector, texto) => {
    dialogo.querySelector(selector).textContent = texto;
  };

  function abrir(n) {
    const f = construirFichaLote(json, Number(n));

    poner('.ficha-titulo', f.titulo);
    poner('.ficha-estado', f.estadoTexto);
    poner('.ficha-area', f.areaTexto);
    poner('.ficha-precio', f.precioTexto);
    poner('.ficha-precio-m2', `${f.precioM2Texto} el m²`);
    poner('.ficha-sector', `Sector ${f.sector}`);
    dialogo.querySelector('.ficha-estado').dataset.estado = f.estado;

    // El botón desaparece en un lote que ya no está en venta. Ocultarlo no
    // basta: un botón `display:none` sigue siendo enfocable en algunos
    // navegadores viejos, y no queremos que nadie llegue a él con el tabulador
    // y escriba pidiendo un lote con dueño.
    const boton = dialogo.querySelector('.ficha-whatsapp');
    if (f.whatsapp) {
      boton.href = f.whatsapp;
      boton.hidden = false;
    } else {
      boton.removeAttribute('href');
      boton.hidden = true;
    }

    dialogo.showModal();
    montarPano(f);
  }

  // Un visor de Pannellum se queda con un contexto de WebGL. El navegador
  // permite unos pocos a la vez, así que abrir siete lotes seguidos sin
  // destruir el anterior deja la última panorámica en negro y sin ningún
  // error a la vista. Por eso se destruye siempre antes de crear.
  let visor = null;
  const caja = dialogo.querySelector('.ficha-pano');

  // Cada apertura lleva un número. La librería se carga esperando, y en ese
  // rato el visitante puede haber cerrado o saltado a otro lote: si al volver
  // el número ya no es el suyo, esta llamada llegó tarde y no monta nada.
  let turno = 0;

  function soltarPano() {
    if (!visor) return;
    visor.destroy();
    visor = null;
    caja.innerHTML = '';
  }

  async function montarPano(f) {
    const mio = ++turno;
    soltarPano();
    const config = configPano(f);
    caja.hidden = !config;
    if (!config) return;

    try {
      await cargarPannellum();
    } catch {
      // Sin visor la ficha sigue sirviendo: área, precio y el botón de
      // WhatsApp son lo que cierra la venta. Una panorámica que no cargó no
      // puede llevarse el resto de la ficha por delante.
      caja.hidden = true;
      return;
    }
    if (mio !== turno || !dialogo.open) return;
    visor = window.pannellum.viewer(caja, config);
  }

  dialogo.addEventListener('close', soltarPano);

  for (const poligono of svg.querySelectorAll('.lote[data-lote]')) {
    poligono.setAttribute('role', 'button');
    poligono.setAttribute('tabindex', '0');
    poligono.addEventListener('click', () => abrir(poligono.dataset.lote));
    // Un <path> no es un botón de verdad: la barra y el Enter no lo activan
    // solos. La barra además desplaza la página si no se la detiene.
    poligono.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      abrir(poligono.dataset.lote);
    });
  }

  tarjetas.addEventListener('click', (e) => {
    const boton = e.target.closest('.abrir[data-lote]');
    if (boton) abrir(boton.dataset.lote);
  });
}
