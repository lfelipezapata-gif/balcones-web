import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirFichaLote, configPano, loteDelEnlace, WHATSAPP } from '../assets/js/ficha.js';
import { ESTADOS } from '../assets/js/inventario.js';
import { existsSync, statSync } from 'node:fs';

const inv = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url)));

test('la ficha trae el área y el precio ya formateados', () => {
  const f = construirFichaLote(inv, 7);
  assert.equal(f.titulo, 'Lote 7');
  assert.equal(f.sector, 1);
  assert.equal(f.areaTexto, '2.129 m²');
  assert.equal(f.precioTexto, '$234.190.000');
  assert.equal(f.precioM2Texto, '$110.000');
});

test('el precio se calcula, no se lee', () => {
  const caro = { ...inv, precioM2: 120000 };
  assert.equal(construirFichaLote(caro, 7).precioTexto, '$255.480.000');
});

test('cada estado tiene su rótulo y solo el disponible se puede pedir', () => {
  assert.deepEqual(
    [6, 1, 2].map(n => {
      const f = construirFichaLote(inv, n);
      return [f.estado, f.estadoTexto, f.disponible];
    }),
    [
      ['disponible', 'Disponible', true],
      ['vendido', 'Vendido', false],
      ['especie', 'Pago en especie', false]
    ]
  );
});

// Si mañana entra un estado nuevo en el inventario —«reservado», por ejemplo—
// la ficha lo mostraría como «undefined» en una página de venta y nada se
// quejaría. Esta prueba obliga a que el rótulo se escriba junto con el estado.
test('no hay estado del inventario sin rótulo en la ficha', () => {
  for (const estado of ESTADOS) {
    const uno = { ...inv, lotes: [{ n: 1, sector: 1, area: 2000, estado }] };
    const f = construirFichaLote(uno, 1);
    assert.equal(typeof f.estadoTexto, 'string', `el estado «${estado}» no tiene rótulo`);
    assert.ok(f.estadoTexto.length > 0, `el estado «${estado}» tiene rótulo vacío`);
  }
});

test('el enlace de WhatsApp dice cuál lote están mirando', () => {
  const f = construirFichaLote(inv, 7);
  const texto = decodeURIComponent(new URL(f.whatsapp).searchParams.get('text'));
  assert.match(texto, /lote 7/);
  assert.match(texto, /2\.129 m²/);
  assert.ok(f.whatsapp.startsWith(`https://wa.me/${WHATSAPP}?`));
});

// Un lote colocado sigue abriendo ficha —el comprador quiere ver qué se vendió
// y a cómo— pero no puede llevar un botón que invite a pedirlo.
test('un lote que ya no está en venta no trae enlace de WhatsApp', () => {
  assert.equal(construirFichaLote(inv, 1).whatsapp, null);
  assert.equal(construirFichaLote(inv, 2).whatsapp, null);
});

test('el número de WhatsApp de la ficha es el mismo del pie de página', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(
    html.includes(`https://wa.me/${WHATSAPP}`),
    `index.html no usa el número ${WHATSAPP} que usa la ficha`
  );
});

test('pedir un lote que no existe falla con el número adentro', () => {
  assert.throws(() => construirFichaLote(inv, 99), /99/);
});

// Estos dos inventarios se arman a mano en vez de retocar data/lotes.json. Si
// se apoyaran en el archivo real, el día que entre la panorámica del lote 7 la
// prueba «sin panorámica» empezaría a fallar sola, sin que nada esté mal.
const sinPano = { ...inv, lotes: [{ n: 7, sector: 1, area: 2129, estado: 'disponible' }] };
const conPano = { ...sinPano, lotes: [{ ...sinPano.lotes[0], pano: 'img/pano/lote-07.jpg' }] };

// El hueco del 360: mientras no haya foto, la ficha no debe inventar nada.
test('sin panorámica la ficha viene con pano en null', () => {
  assert.equal(construirFichaLote(sinPano, 7).pano, null);
});

test('con panorámica la ficha la pasa tal cual', () => {
  assert.equal(construirFichaLote(conPano, 7).pano, 'img/pano/lote-07.jpg');
});

// ── El visor 360 ────────────────────────────────────────────────────────────

test('el visor recibe la panorámica como equirectangular', () => {
  const c = configPano(construirFichaLote(conPano, 7));
  assert.equal(c.type, 'equirectangular');
  assert.equal(c.panorama, 'img/pano/lote-07.jpg');
});

// El corte de arriba existe por el hueco del cenit: el gimbal del dron puede
// no alcanzar a mirar derecho hacia arriba y dejar un tapón donde debería ir
// el cielo. Medido sobre el vuelo del 2-sep-2026, en el Mini 5 Pro ese hueco
// es de 1 a 5 grados y está relleno de azul de cielo, así que el corte quedó
// en 85° y es casi todo el domo — pero sigue existiendo, y esta prueba lo
// sostiene para que nadie lo suba a 90 sin haber mirado una panorámica.
//
// Mirar hacia abajo sí está permitido: el dron sí fotografía el nadir, y el
// suelo es justamente el lote que está vendiendo.
test('el visor no deja llegar al hueco del cenit', () => {
  const c = configPano(construirFichaLote(conPano, 7));
  assert.ok(c.maxPitch < 90, 'maxPitch tiene que cortar antes del cenit');
  assert.ok(c.maxPitch > 0, 'maxPitch por debajo del horizonte dejaría ver solo el piso');
  assert.equal(c.minPitch, -90);
});

test('sin panorámica no hay configuración de visor', () => {
  assert.equal(configPano(construirFichaLote(sinPano, 7)), null);
});

// Pannellum va servido desde el repositorio, no desde un CDN: la página de
// venta no depende de que un tercero siga en línea, y funciona igual en el
// portátil de una reunión sin internet.
test('Pannellum está en vendor y pesa lo que debe pesar una librería', () => {
  for (const [f, kb] of Object.entries({ 'pannellum.js': 120, 'pannellum.css': 30 })) {
    const ruta = new URL(`../vendor/${f}`, import.meta.url);
    assert.ok(existsSync(ruta), `falta vendor/${f}`);
    const real = Math.round(statSync(ruta).size / 1024);
    assert.ok(real <= kb, `vendor/${f} pesa ${real} KB y el tope son ${kb} KB`);
  }
});

// La ficha se puede abrir a pantalla completa. Es lo unico que hace usable el
// 360 en un telefono: dentro del modal la vista mide ~290x360 y a pantalla
// completa 375x690, casi cuatro veces el area.
//
// Se comprueba el marcado y no el comportamiento porque el comportamiento es
// puro DOM y CSS. Lo que esta prueba impide es que alguien borre uno de los
// tres pedazos y deje el boton sin salida o la barra sin boton.
test('el marcado trae los tres pedazos de la pantalla completa', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [clase, para] of [
    ['ficha-agrandar', 'el botón que entra a pantalla completa'],
    ['ficha-reducir', 'el botón que sale de pantalla completa'],
    ['ficha-barra-texto', 'el lote, el área y el precio mientras se mira la vista']
  ]) {
    assert.ok(html.includes(`class="${clase}"`) || html.includes(`"${clase}"`),
      `index.html no trae .${clase}: falta ${para}`);
  }
});

// Sin `.agrandada` el <dialog> se queda del tamaño del modal y la vista no
// crece: el boton quedaria puesto y sin efecto.
test('el CSS define el modo agrandado del diálogo', () => {
  const css = readFileSync(new URL('../assets/css/estilos.css', import.meta.url), 'utf8');
  assert.match(css, /\.ficha\.agrandada\s*\{/, 'falta la regla .ficha.agrandada');
  assert.match(css, /\.ficha\.agrandada\s+\.ficha-pano\b/, 'la vista no se estira al agrandar');
});

// El boton de WhatsApp tiene que quedarse a la vista mientras se desplaza la
// ficha. Con la vista 360 vertical en un telefono queda bajo el pliegue, y el
// momento de escribir es justo despues de mirar el lote, no dos deslizadas
// despues.
test('el botón de WhatsApp queda pegado al borde inferior de la ficha', () => {
  const css = readFileSync(new URL('../assets/css/estilos.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // El botón tiene que estar FUERA del cuerpo que se desplaza.
  const cuerpo = html.match(/<div class="ficha-cuerpo">[\s\S]*?<\/div>\s*<a class="boton ficha-whatsapp"/);
  assert.ok(cuerpo, 'el botón de WhatsApp quedó dentro de .ficha-cuerpo o falta el cuerpo');
  assert.match(css, /\.ficha \{[^}]*display:\s*flex/, '.ficha tiene que ser columna');
  assert.match(css, /\.ficha-cuerpo \{[^}]*overflow:\s*auto/, 'el cuerpo es el que se desplaza');
});

// ── El enlace al mapa ───────────────────────────────────────────────────────
// «A 3,5 km del parque» no le dice nada a alguien que no conoce Santa Rosa.
// El alfiler sí: abre Google Maps en el punto exacto del lote y desde ahí se
// ve el satélite, la vía de llegada y cuánto hay hasta el pueblo.
const conCoords = {
  ...inv,
  lotes: [{ n: 7, sector: 1, area: 2129, estado: 'disponible',
            lat: 6.650564, lon: -75.44552 }]
};

test('la ficha arma el enlace al mapa con la coordenada del lote', () => {
  const f = construirFichaLote(conCoords, 7);
  const u = new URL(f.mapa);
  assert.equal(u.host, 'www.google.com');
  assert.equal(u.searchParams.get('query'), '6.650564,-75.44552');
});

test('sin coordenada no hay enlace, en vez de uno que caiga en el mar', () => {
  const sin = { ...inv, lotes: [{ n: 7, sector: 1, area: 2129, estado: 'disponible' }] };
  assert.equal(construirFichaLote(sin, 7).mapa, null);
});

// Un lote colocado también se puede ubicar: quien mira quiere saber dónde
// quedó lo que se vendió. Lo que no lleva es el botón de pedirlo.
test('un lote vendido también trae su enlace al mapa', () => {
  const vend = { ...conCoords, lotes: [{ ...conCoords.lotes[0], estado: 'vendido' }] };
  const f = construirFichaLote(vend, 7);
  assert.equal(f.whatsapp, null);
  assert.ok(f.mapa);
});

// ⚠️ La regla que esconde la ficha cerrada.
//
// El navegador esconde un <dialog> cerrado con `dialog:not([open]) { display:
// none }`. En cuanto `.ficha` gano `display: flex` para ser columna, esa regla
// quedo pisada y la ficha CERRADA se dibujaba dentro de la pagina: una tarjeta
// vacia con «Area / Precio / Valor / Ubicacion» sin valores y una X, en mitad
// del listado de lotes. Se vio en el telefono, al cerrar el visor 360.
//
// Cualquiera que vuelva a tocar el `display` de `.ficha` reabre el mismo hueco.
test('la ficha cerrada no se dibuja dentro de la página', () => {
  const css = readFileSync(new URL('../assets/css/estilos.css', import.meta.url), 'utf8');
  assert.match(css, /\.ficha:not\(\[open\]\)\s*\{[^}]*display:\s*none/,
    'falta .ficha:not([open]) { display: none } y la ficha cerrada se va a ver');
});

// Desde la vista 360 a pantalla completa TIENE que poderse cerrar.
//
// Antes no se podia: la X de arriba se esconde en ese modo y el unico boton
// era «Salir», que solo achicaba y dejaba la ficha abierta. El visitante que
// abria la vista grande quedaba sin salida — «no cierra cuando se ve la foto
// 360», textual.
//
// Ahora la barra lleva dos, y son dos cosas distintas: «Volver» devuelve a la
// ficha y la X cierra todo.
test('la vista a pantalla completa tiene con qué cerrar, no solo con qué volver', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="ficha-reducir"/, 'falta el botón que vuelve a la ficha');
  assert.match(html, /class="ficha-cerrar-todo"/, 'falta el botón que cierra desde la vista grande');

  const css = readFileSync(new URL('../assets/css/estilos.css', import.meta.url), 'utf8');
  assert.match(css, /\.ficha\.agrandada \.ficha-cerrar-todo[^}]*display:\s*block/,
    'el botón de cerrar no se muestra a pantalla completa');

  const js = readFileSync(new URL('../assets/js/ficha.js', import.meta.url), 'utf8');
  assert.match(js, /ficha-cerrar-todo[\s\S]{0,160}dialogo\.close\(\)/,
    'el botón de cerrar de la barra no cierra el diálogo');
});

// ── El enlace directo a un lote ─────────────────────────────────────────────
// Para que un comprador pueda mandar «mirá mi lote» y se abra el suyo, no la
// página genérica con catorce polígonos que el familiar tiene que buscar.

test('el enlace #lote-3 abre el lote 3', () => {
  assert.equal(loteDelEnlace('#lote-3', inv), 3);
  assert.equal(loteDelEnlace('lote-14', inv), 14);
});

test('sin enlace, o con uno que no dice nada, no se abre nada', () => {
  for (const h of ['', '#', '#lote-', '#otra-cosa', '#lote-abc', null, undefined]) {
    assert.equal(loteDelEnlace(h, inv), null, `«${h}» no debería abrir ninguna ficha`);
  }
});

// Un enlace a un lote que no existe abre la página normal, no revienta. Puede
// llegar de un mensaje viejo reenviado, o de alguien que cambió el número a
// mano por curiosidad.
test('un lote que no existe no abre nada y no revienta', () => {
  assert.equal(loteDelEnlace('#lote-99', inv), null);
  assert.equal(loteDelEnlace('#lote-0', inv), null);
});

// ── La página de anteproyecto en la ficha ───────────────────────────────────
// El lote 6 es el único que hoy tiene paquete de render. El enlace sale del
// inventario, no de una condición escrita a mano, para que el día que el 7
// tenga el suyo baste con tocar data/lotes.json.

const sinCasa = { ...inv, lotes: [{ n: 1, sector: 1, area: 2000, estado: 'disponible' }] };
const conCasa = { ...inv, lotes: [{ ...sinCasa.lotes[0], casa: 'casa-lote-6.html' }] };

test('sin anteproyecto la ficha viene con casa en null', () => {
  assert.equal(construirFichaLote(sinCasa, 1).casa, null);
});

test('con anteproyecto la ficha pasa la ruta tal cual', () => {
  assert.equal(construirFichaLote(conCasa, 1).casa, 'casa-lote-6.html');
});

// Un lote colocado no puede ofrecer el anteproyecto: es enseñarle a alguien lo
// que se podría construir en algo que ya no puede comprar. El alfiler del mapa
// sí se deja —quien mira quiere saber dónde quedó lo que se vendió—, pero esto
// es material de venta y no tiene a dónde llevar.
test('un lote que ya no se vende no ofrece el anteproyecto', () => {
  for (const estado of ['vendido', 'reservado', 'especie']) {
    const colocado = { ...inv, lotes: [{ ...conCasa.lotes[0], estado }] };
    assert.equal(construirFichaLote(colocado, 1).casa, null,
      `el estado «${estado}» no debería ofrecer el anteproyecto`);
  }
});

// El enlace tiene que existir en el documento, si no `montarFicha` revienta al
// abrir un lote con anteproyecto y se lleva la ficha entera por delante.
test('index.html trae el enlace al anteproyecto, escondido de nacimiento', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="ficha-casa"[^>]*hidden/,
    'falta el <a class="ficha-casa"> o no nace escondido');
});

// ── La página de anteproyecto en sí ─────────────────────────────────────────
// Es la única página del sitio que muestra algo que no se vende. El aviso de
// que el lote va sin construcción no es una formalidad: es lo que separa una
// propuesta de una promesa. Va dos veces, arriba y abajo.

const CASA = readFileSync(new URL('../casa-lote-6.html', import.meta.url), 'utf8');

test('la página de anteproyecto avisa dos veces que el lote va sin construcción', () => {
  const avisos = CASA.match(/sin construcci[óo]n/gi) ?? [];
  assert.ok(avisos.length >= 2,
    `el aviso aparece ${avisos.length} vez/veces y tiene que aparecer arriba y abajo`);
});

test('el video de la página existe y trae poster', () => {
  assert.match(CASA, /<source src="video\/casa-lote-6\.mp4"/);
  assert.match(CASA, /poster="img\/casa-lote-6\/poster\.jpg"/);
  for (const rel of ['video/casa-lote-6.mp4', 'img/casa-lote-6/poster.jpg']) {
    assert.ok(existsSync(new URL('../' + rel, import.meta.url)), `falta ${rel}`);
  }
});

// Un <img> sin archivo detrás es un hueco gris en una página de venta, y en
// una galería de doce nadie lo nota revisando a ojo.
test('todas las imágenes de la galería están en el repositorio', () => {
  const rutas = [...CASA.matchAll(/src="(img\/casa-lote-6\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(rutas.length >= 12, `solo hay ${rutas.length} imágenes referenciadas`);
  for (const r of rutas) {
    assert.ok(existsSync(new URL('../' + r, import.meta.url)), `falta ${r}`);
  }
});

// El video se sirve desde GitHub Pages, que no hace streaming: lo que pese se
// descarga. Con `preload="none"` no arranca solo, pero quien le da play espera
// todo. Por encima de unos 12 MB deja de ser razonable en datos móviles.
test('el video de la página pesa lo que se puede mandar por datos', () => {
  const kb = statSync(new URL('../video/casa-lote-6.mp4', import.meta.url)).size / 1024;
  assert.ok(kb < 12 * 1024, `el video pesa ${Math.round(kb)} KB y el techo son 12 MB`);
  assert.match(CASA, /preload="none"/, 'el video no puede precargarse solo');
});

// Todas las imágenes de la galería van con `loading="lazy"` y con medidas: sin
// medidas la página salta mientras cargan, y son doce.
test('la galería carga perezosa y con medidas', () => {
  const figs = [...CASA.matchAll(/<img src="img\/casa-lote-6\/(?!poster)[^"]+"[^>]*>/g)]
    .map(m => m[0]);
  for (const img of figs) {
    assert.match(img, /loading="lazy"/, `sin loading lazy: ${img.slice(0, 60)}`);
    assert.match(img, /width="\d+" height="\d+"/, `sin medidas: ${img.slice(0, 60)}`);
  }
});
