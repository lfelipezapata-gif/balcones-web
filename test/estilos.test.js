// La hoja de estilos es UNA SOLA y la comparten dos páginas distintas: la
// vitrina pública (`index.html`) y el tablero de socios (`socios/index.html`).
//
// Eso ya se cobró una: el 4-sep-2026 se agregó `.ficha:not([open])
// { display: none }` para tapar un defecto real de la vitrina —su ficha es un
// <dialog> y, al ponerle `display: flex`, la versión CERRADA se dibujaba dentro
// de la página—. Pero el tablero tiene su propia ficha de lote, que es un
// `<div class="ficha">` y nunca lleva `[open]`: la regla la escondió también, y
// el socio pulsaba un lote en el plano y no pasaba nada.
//
// Nada falla cuando eso ocurre. No hay excepción, no hay aviso, las 264
// pruebas siguen en verde: simplemente desaparece una pantalla. Por eso esta
// comprobación es estática y sobre el texto del CSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../assets/css/estilos.css', import.meta.url), 'utf8');

// Los bloques de la hoja, ya sin comentarios: [selector, cuerpo].
function reglas(css) {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const fuera = [];
  for (const m of limpio.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    // Se saltan los @media y demás: su selector real está adentro y lo agarra
    // la misma expresión en la siguiente vuelta.
    if (selector.startsWith('@')) continue;
    fuera.push([selector, m[2]]);
  }
  return fuera;
}

test('ninguna regla esconde la ficha de lote del tablero', () => {
  // El tablero dibuja `<div id="ficha" class="ficha">` y lo llena por JS. No es
  // un <dialog> y no tiene `[open]`, así que cualquier regla que apunte a
  // `.ficha` sin decir `dialog` lo alcanza.
  for (const [selector, cuerpo] of reglas(CSS)) {
    if (!/display\s*:\s*none/.test(cuerpo)) continue;
    for (const parte of selector.split(',').map(s => s.trim())) {
      // Lo que se esconde es el ÚLTIMO tramo del selector, no el primero:
      // `.ficha.agrandada .ficha-cerrar-caja` esconde el botón de cerrar, que
      // está dentro de la ficha, y con eso no hay problema. Mirar el selector
      // entero marcaba esa regla y convertía la prueba en ruido.
      const objetivo = parte.split(/[\s>+~]+/).filter(Boolean).pop() ?? '';
      // `.ficha-nota`, `.ficha-datos` y compañía son otros elementos: solo
      // interesa `.ficha` a secas.
      if (!/\.ficha(?![\w-])/.test(objetivo)) continue;
      assert.match(
        objetivo, /dialog\.ficha/,
        `«${parte}» esconde un elemento con clase .ficha y no dice dialog: ` +
        'alcanza también a la ficha de lote del tablero de socios, que es un <div> ' +
        'y nunca lleva [open]. Escribí «dialog.ficha».'
      );
    }
  }
});

test('la ficha del tablero y la de la vitrina no comparten estilos por accidente', () => {
  // Las dos se llaman `.ficha` y son cosas distintas. La regla de convivencia,
  // que ya está escrita en el encabezado de esa sección del CSS, es que lo de la
  // vitrina se califique con `dialog` y lo del tablero con `.tablero`. Esta
  // prueba comprueba que la advertencia siga en el archivo: si alguien la borra
  // al reordenar, la próxima colisión llega sin nadie avisado.
  assert.match(CSS, /comparten la vitrina y el tablero de socios/,
    'se perdió la advertencia de que este archivo lo comparten las dos páginas');
});

test('el plano aéreo del tablero no tapa la ortofoto con rellenos sólidos', () => {
  // El tablero usa el MISMO plano que la vitrina, que lleva una foto debajo.
  // Los colores del plano esquemático son sólidos: si quedan mandando sobre el
  // aéreo, el socio ve polígonos planos y pierde el terreno, que es justo lo que
  // el plano aéreo vino a darle.
  const solidos = reglas(CSS)
    .filter(([s]) => /\.tablero\s+\.aereo\s+\.lote\[data-(seleccionado|atenuado)/.test(s))
    .filter(([, cuerpo]) => /fill\s*:\s*(#|var\()/.test(cuerpo));
  assert.deepEqual(solidos, [],
    'el lote seleccionado o apagado del plano aéreo se pinta con un color sólido');

  // Y que esas reglas EXISTAN: sin ellas mandan las de `.mapa`, que sí son
  // sólidas. Que no haya reglas sólidas no sirve de nada si no hay ninguna.
  const conAlfa = reglas(CSS)
    .filter(([s]) => /\.tablero\s+\.aereo\s+\.lote\[data-(seleccionado|atenuado)/.test(s));
  assert.ok(conAlfa.length >= 2,
    'faltan las reglas del lote seleccionado y del apagado sobre el plano aéreo');
});
