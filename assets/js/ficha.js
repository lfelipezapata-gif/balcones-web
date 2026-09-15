// La ficha de un lote de la vitrina pública: lo que se ve al hacer clic en el
// plano o en una tarjeta.
//
// Es la hermana pública de `fichaDeLote` de assets/js/paneles.js. Aquella
// trabaja sobre la vista del tablero de socios porque ahí entra texto libre de
// una hoja de Google y hay que escaparlo. Acá no: todo sale de data/lotes.json,
// que `validarInventario` ya deja en números y estados de una lista cerrada.
// Por eso esta ficha puede armarse directo del inventario y aquella no.

import { validarInventario, precioDeLote, validarCasa } from './inventario.js?v=4cc9b193';
import { pesos, metros } from './formato.js?v=4cc9b193';

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

// El alfiler en Google Maps. Se usa la forma documentada de la API de enlaces
// (`/maps/search/?api=1&query=`) y no una URL con parametros internos: esa es
// la unica que Google se compromete a mantener, abre la app en el telefono en
// vez del navegador, y clava el alfiler en el punto exacto.
//
// Se pone Maps y no Earth aunque el pedido fuera Earth: el enlace de Earth web
// no tiene forma documentada y en un telefono no abre la app. Desde Maps, ver
// el satelite es un toque.
function enlaceMapa(lat, lon) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

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

  // El área que se entrega, cuando no es la misma que se escritura. El precio
  // NO se toca: se calcula sobre la escriturable. Cobrar por metros que el
  // folio no va a decir es prometer lo que no se puede firmar.
  const hayMas = Number.isInteger(lote.areaReal) && lote.areaReal > lote.area;
  const demas = hayMas ? lote.areaReal - lote.area : 0;

  return {
    n: lote.n,
    sector: lote.sector,
    titulo: `Lote ${lote.n}`,
    areaTexto,
    // Cuando hay dos áreas, la etiqueta de la primera deja de ser «Área» a
    // secas: una fila que dice «Área 2.140» encima de otra que dice 2.394 se
    // lee como un error del sitio, no como dos cosas distintas.
    areaEtiqueta: hayMas ? 'Área escriturable' : 'Área',
    areaRealTexto: hayMas ? metros(lote.areaReal) : null,
    notaArea: hayMas
      ? `Se escrituran ${metros(lote.area)} y se entregan ${metros(lote.areaReal)}: ` +
        `la subdivisión se radicó antes del movimiento de tierra, y el lote quedó ` +
        `${metros(demas)} más grande en terreno. El folio dirá ${metros(lote.area)}.`
      : null,
    precioTexto: pesos(precioDeLote(lote, json.precioM2)),
    precioM2Texto: pesos(json.precioM2),
    estado: lote.estado,
    estadoTexto: ETIQUETA[lote.estado],
    disponible,
    // Sin foto, `null`. La ficha no muestra pestaña de 360 y no se carga nada:
    // una panorámica pesa lo que pesan todas las demás imágenes juntas, así que
    // no puede entrar al vuelo con la página.
    pano: lote.pano ?? null,
    // La página de anteproyecto, si el lote tiene una. Solo en un lote que
    // todavía se vende: enseñarle a alguien lo que se puede construir en un
    // lote con dueño es enseñarle algo que no puede comprar.
    casa: disponible ? (lote.casa ?? null) : null,
    whatsapp: disponible ? enlaceWhatsApp(lote.n, areaTexto) : null,
    // Un lote colocado tambien lleva alfiler: quien mira quiere saber donde
    // quedo lo que se vendio. Lo que no lleva es el boton de pedirlo.
    mapa: (typeof lote.lat === 'number' && typeof lote.lon === 'number')
      ? enlaceMapa(lote.lat, lote.lon)
      : null
  };
}

// De qué lote habla un enlace como «…/#lote-3».
//
// Es lo que deja que un comprador mande «mirá mi lote» y se abra EL SUYO, en
// vez de la página con catorce polígonos donde el familiar tiene que ponerse
// a buscar. Sin esto, mandar el link no sirve para lo que se quiere.
//
// Devuelve null ante cualquier cosa rara —un enlace viejo reenviado, un
// número cambiado a mano por curiosidad, un lote que ya no existe— y entonces
// la página abre normal. Un enlace roto no puede dejar a nadie en blanco.
export function loteDelEnlace(hash, json) {
  const m = /^#?lote-(\d{1,3})$/.exec(String(hash ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return json.lotes.some(l => l.n === n) ? n : null;
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
// MEDIDO SOBRE LAS SEIS PANORÁMICAS REALES del vuelo del 2-sep-2026, y salió
// mucho mejor de lo que suponía: el gimbal de 225° del Mini 5 Pro llena el
// cenit. La zona sin detalle va de 21 a 110 filas de 2048 —o sea que el cielo
// real empieza entre +88° y +80°— y encima está rellena de AZUL DE CIELO
// (RGB 170,192,216 en la peor), no del gris o el negro de los modelos viejos.
// Mirando la franja de arriba a ojo no se distingue nada.
//
// Por eso el corte pasó de 50° a 85°: a 50° se estaban botando treinta grados
// de cielo bueno para esconder algo que no se ve. Se deja en 85 y no en 90
// como guarda barata, por si una panorámica futura sale con un hueco de
// verdad. Si eso pasa, este es el número que se baja.
const MAX_PITCH = 85;

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

// El anteproyecto, ya listo para pintar.
//
// Va DENTRO de la ficha y no en una página aparte. Mandar al cliente a otra
// dirección en mitad de la decisión es perderlo: sale de la vitrina, deja de
// ver el precio y el botón de WhatsApp, y el camino de vuelta depende de que
// se acuerde de volver. Acá abre el lote, baja y ve lo que cabe construir sin
// moverse del mismo sitio donde está el botón para preguntar.
export function construirCasa(manifiesto) {
  validarCasa(manifiesto);
  return {
    titulo: manifiesto.titulo,
    entrada: manifiesto.entrada ?? null,
    aviso: manifiesto.aviso,
    video: manifiesto.video,
    poster: manifiesto.poster,
    duracion: manifiesto.duracion ?? null,
    datos: (manifiesto.datos ?? []).map(([cifra, glosa]) => ({ cifra, glosa })),
    imagenes: manifiesto.imagenes.map(([src, pie]) => ({ src, pie }))
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
    css.href = 'vendor/pannellum.css?v=4cc9b193';
    document.head.appendChild(css);

    const js = document.createElement('script');
    js.src = 'vendor/pannellum.js?v=4cc9b193';
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
    poner('.ficha-area-etiqueta', f.areaEtiqueta);

    // Las dos áreas y su explicación. Van juntas o no van: el número suelto
    // sin la nota es peor que no ponerlo, porque deja al comprador creyendo
    // que la escritura le va a decir 2.394.
    const filaReal = dialogo.querySelector('.ficha-area-real-fila');
    const nota = dialogo.querySelector('.ficha-nota-area');
    if (f.areaRealTexto) {
      poner('.ficha-area-real', f.areaRealTexto);
      nota.textContent = f.notaArea;
      filaReal.hidden = false;
      nota.hidden = false;
    } else {
      filaReal.hidden = true;
      nota.hidden = true;
      nota.textContent = '';
    }
    poner('.ficha-precio', f.precioTexto);
    poner('.ficha-precio-m2', `${f.precioM2Texto} el m²`);
    poner('.ficha-sector', `Sector ${f.sector}`);
    dialogo.querySelector('.ficha-estado').dataset.estado = f.estado;

    // El botón desaparece en un lote que ya no está en venta. Ocultarlo no
    // basta: un botón `display:none` sigue siendo enfocable en algunos
    // navegadores viejos, y no queremos que nadie llegue a él con el tabulador
    // y escriba pidiendo un lote con dueño.
    const alMapa = dialogo.querySelector('.ficha-mapa');
    if (f.mapa) {
      alMapa.href = f.mapa;
      alMapa.hidden = false;
    } else {
      alMapa.removeAttribute('href');
      alMapa.hidden = true;
    }

    // Salida hacia los que sí están en venta. Solo en un lote colocado: quien
    // llega por el enlace que le mandó un comprador cae en un lote con dueño y
    // sin esto no tiene a dónde seguir. Es justo el visitante que se puede
    // antojar, y hoy se quedaba sin camino.
    const haciaDisponibles = dialogo.querySelector('.ficha-hacia-disponibles');
    const quedan = json.lotes.filter(l => l.estado === 'disponible').length;
    if (!f.disponible && quedan > 0) {
      haciaDisponibles.textContent = quedan === 1
        ? 'Queda 1 lote en venta — verlo'
        : `Quedan ${quedan} lotes en venta — verlos`;
      haciaDisponibles.hidden = false;
    } else {
      haciaDisponibles.hidden = true;
    }

    const boton = dialogo.querySelector('.ficha-whatsapp');
    if (f.whatsapp) {
      boton.href = f.whatsapp;
      boton.hidden = false;
    } else {
      boton.removeAttribute('href');
      boton.hidden = true;
    }

    // La URL pasa a nombrar el lote abierto, para que se pueda copiar y
    // mandar. `replaceState` y no `pushState`: si cada lote dejara una entrada
    // en el historial, salir de la ficha con el botón de atrás obligaría a
    // pulsarlo tantas veces como lotes se hayan mirado.
    if (history.replaceState) history.replaceState(null, '', `#lote-${f.n}`);

    dialogo.showModal();
    montarPano(f);
    montarCasa(f);
  }

  // Se expone para que index.html pueda abrir el lote que pida el enlace.
  dialogo.abrirLote = abrir;

  // Un visor de Pannellum se queda con un contexto de WebGL. El navegador
  // permite unos pocos a la vez, así que abrir siete lotes seguidos sin
  // destruir el anterior deja la última panorámica en negro y sin ningún
  // error a la vista. Por eso se destruye siempre antes de crear.
  let visor = null;
  const caja = dialogo.querySelector('.ficha-pano');
  const panoCaja = dialogo.querySelector('.ficha-pano-caja');
  const barra = dialogo.querySelector('.ficha-barra-texto');

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
    panoCaja.hidden = !config;
    // Lo que se lee arriba en pantalla completa. Ahí no caben la tabla de
    // datos ni el precio en su fila: si no se resume acá, el que está mirando
    // la vista deja de ver cuánto vale, que es la mitad de la decisión.
    // Solo el lote y el precio. Con el area tambien, en un telefono la barra
    // no alcanza y lo que se corta es el final — o sea el precio, que es
    // justo lo que no puede faltar mientras alguien mira su lote. El area
    // esta a un toque de «Volver».
    barra.textContent = `${f.titulo} · ${f.precioTexto}`;
    if (!config) return;

    try {
      await cargarPannellum();
    } catch {
      // Sin visor la ficha sigue sirviendo: área, precio y el botón de
      // WhatsApp son lo que cierra la venta. Una panorámica que no cargó no
      // puede llevarse el resto de la ficha por delante.
      panoCaja.hidden = true;
      return;
    }
    if (mio !== turno || !dialogo.open) return;
    visor = window.pannellum.viewer(caja, config);
  }

  // ── El anteproyecto, dentro de la ficha ─────────────────────────────────
  //
  // El manifiesto entra por `fetch` la primera vez que alguien abre un lote
  // que lo tiene, no con la página: son doce pies de foto y un aviso legal
  // para un dato que hoy usa un solo lote de catorce.
  //
  // Se guarda en memoria por ruta. Abrir el 6, salir, y volver a entrar es lo
  // más normal del mundo mirando lotes; pedirlo otra vez cada vez sería
  // cobrarle al cliente su propia indecisión.
  const casasPedidas = new Map();
  const casaCaja = dialogo.querySelector('.ficha-casa');

  // La ruta del manifiesto sale de data/lotes.json en tiempo de ejecución, así
  // que versionar.py no puede pegarle el `?v=` como hace con las rutas
  // escritas entre comillas. Sin eso el navegador se queda con el manifiesto
  // del día que entró: se cambia un pie de foto, se publica, y el cliente
  // sigue viendo el viejo.
  //
  // El token se saca de la URL de ESTE módulo, que index.html sí importa
  // versionado. Así no hay un segundo sitio donde escribirlo a mano.
  const VERSION = new URL(import.meta.url).search;

  function soltarCasa() {
    // Pausar ANTES de vaciar. Un <video> arrancado al que se le quita el
    // padre del documento sigue sonando en varios navegadores: el cliente
    // cierra la ficha y le queda la música puesta sin nada en pantalla.
    const v = casaCaja.querySelector('video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    casaCaja.replaceChildren();
    casaCaja.hidden = true;
  }

  function pintarCasa(c) {
    const h = document.createElement('h4');
    h.className = 'casa-titulo';
    h.textContent = c.titulo;

    const partes = [h];
    if (c.entrada) {
      const p = document.createElement('p');
      p.className = 'casa-entrada';
      p.textContent = c.entrada;
      partes.push(p);
    }

    // El aviso va ARRIBA, antes del video. Abajo lo lee quien llegue hasta el
    // final, y el que se antoja con el primer render y escribe de una no llega
    // al final.
    const aviso = document.createElement('p');
    aviso.className = 'casa-aviso';
    aviso.textContent = c.aviso;
    partes.push(aviso);

    const video = document.createElement('video');
    video.className = 'casa-video';
    video.controls = true;
    // Ni `auto` ni `metadata`: en GitHub Pages no hay streaming, así que
    // `auto` se bajaría el archivo entero por abrir una ficha. Arranca cuando
    // el cliente le da play, y no antes.
    video.preload = 'none';
    video.playsInline = true;
    video.poster = c.poster;
    video.src = c.video;
    partes.push(video);

    if (c.duracion) {
      const pie = document.createElement('p');
      pie.className = 'casa-pie';
      pie.textContent = c.duracion;
      partes.push(pie);
    }

    if (c.datos.length) {
      const ul = document.createElement('ul');
      ul.className = 'casa-datos';
      for (const d of c.datos) {
        const li = document.createElement('li');
        const b = document.createElement('b');
        b.textContent = d.cifra;
        const s = document.createElement('span');
        s.textContent = d.glosa;
        li.append(b, s);
        ul.append(li);
      }
      partes.push(ul);
    }

    const galeria = document.createElement('div');
    galeria.className = 'casa-galeria';
    for (const im of c.imagenes) {
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = im.src;
      img.alt = im.pie;
      // Perezosas y con medidas. Son doce: sin `lazy` se bajan las doce por
      // abrir la ficha, y sin medidas la ficha da saltos mientras cargan y
      // mueve de sitio el botón de WhatsApp justo cuando alguien va a pulsarlo.
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 1400;
      img.height = 1045;
      const cap = document.createElement('figcaption');
      cap.textContent = im.pie;
      fig.append(img, cap);
      galeria.append(fig);
    }
    partes.push(galeria);

    const cierre = document.createElement('p');
    cierre.className = 'casa-aviso';
    cierre.textContent = c.aviso;
    partes.push(cierre);

    casaCaja.replaceChildren(...partes);
    casaCaja.hidden = false;
  }

  async function montarCasa(f) {
    const mio = turno;
    soltarCasa();
    if (!f.casa) return;
    try {
      if (!casasPedidas.has(f.casa)) {
        casasPedidas.set(f.casa, fetch(f.casa + VERSION).then(r => {
          if (!r.ok) throw new Error(`No se pudo leer ${f.casa}`);
          return r.json();
        }).then(construirCasa));
      }
      const c = await casasPedidas.get(f.casa);
      // Mientras se pedía el archivo, el cliente pudo cerrar o saltar a otro
      // lote. Sin esto, el anteproyecto del 6 aparecería dentro de la ficha
      // del 7.
      if (mio !== turno || !dialogo.open) return;
      pintarCasa(c);
    } catch {
      // Sin anteproyecto la ficha sigue vendiendo: área, precio y WhatsApp son
      // lo que cierra. Un manifiesto que no cargó no puede llevarse la ficha.
      casasPedidas.delete(f.casa);
      soltarCasa();
    }
  }

  // Pantalla completa.
  //
  // No se usa la API de pantalla completa del navegador a propósito: en iPhone
  // `requestFullscreen` no funciona sobre un div —solo sobre un <video>—, y el
  // teléfono es justamente donde el recuadro chico molesta. Esto es una clase
  // de CSS que estira el <dialog> a todo el viewport, y eso sí anda igual en
  // todas partes.
  //
  // Pannellum mide su contenedor UNA VEZ, al arrancar. Si se le cambia el
  // tamaño por CSS y no se le avisa, el lienzo se queda del tamaño viejo y la
  // imagen sale estirada. De ahí el `resize()` después de cada cambio.
  function agrandar(si) {
    dialogo.classList.toggle('agrandada', si);
    if (visor) visor.resize();
  }

  dialogo.querySelector('.ficha-agrandar').addEventListener('click', () => agrandar(true));
  dialogo.querySelector('.ficha-reducir').addEventListener('click', () => agrandar(false));
  // Cerrar del todo desde la vista grande. No se usa un <form method="dialog">
  // como la X de arriba: ese formulario vive dentro del cuerpo que se
  // desplaza, y a pantalla completa el cuerpo esta ocupado por la vista.
  dialogo.querySelector('.ficha-cerrar-todo')
    .addEventListener('click', () => dialogo.close());

  // Con Esc, primero se sale de pantalla completa y solo después se cierra la
  // ficha. Cerrar de una en el primer Esc devuelve al visitante hasta el
  // listado, dos pasos más atrás de donde quería ir.
  dialogo.addEventListener('cancel', (e) => {
    if (!dialogo.classList.contains('agrandada')) return;
    e.preventDefault();
    agrandar(false);
  });

  // Soltar el visor al cerrar NO puede depender del evento `close`.
  //
  // Se comprobo el 2-sep-2026: hay navegadores donde `dialogo.close()` cierra
  // el dialogo y el evento nunca llega. Con eso, el visor quedaba vivo con la
  // ficha cerrada — un contexto de WebGL retenido y la panoramica girando sola
  // en segundo plano, gastando bateria por una foto que nadie esta viendo.
  //
  // Mirar el atributo `open` sirve pase lo que pase: lo quita el boton de la
  // X (que es un <form method="dialog">), el Esc, `close()` y cualquier otra
  // via que aparezca. Es el estado, no el aviso de que el estado cambio.
  const observador = new MutationObserver(() => {
    if (dialogo.open) return;
    soltarPano();
    soltarCasa();
    dialogo.classList.remove('agrandada');
    // Se le quita el lote a la URL al cerrar, si no queda apuntando a una
    // ficha que ya nadie está viendo y recargar la vuelve a abrir sola.
    if (history.replaceState) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  });
  observador.observe(dialogo, { attributes: true, attributeFilter: ['open'] });

  // Se deja tambien el evento, que es lo correcto donde si llega. `soltarPano`
  // no molesta si ya se solto.
  dialogo.addEventListener('close', () => {
    soltarPano();
    soltarCasa();
    dialogo.classList.remove('agrandada');
  });

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
