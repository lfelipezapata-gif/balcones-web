// Guarda del aviso del navegador embebido.
//
// Google no completa su login dentro del navegador interno de WhatsApp:
// devuelve una pantalla suya que dice «400. That's an error». El socio no ve
// nada del tablero, así que no tiene ni cómo reportar qué pasó. Ocurrió dos
// veces —Arequipe el 4-sep-2026, Sergio el 12-sep— y las dos se persiguieron
// durante días como si fuera la lista de correos autorizados, cuando el login
// ni siquiera alcanza a consultarla.
//
// Dos cosas se comprueban acá, y la primera importa más que la segunda:
//
//   1. Que el aviso esté SIEMPRE visible. La detección por user agent es
//      best-effort y falla en silencio cada vez que una app cambia el suyo.
//      Si el aviso dependiera de la detección, el día que WhatsApp cambie de
//      user agent volvemos al punto de partida y nadie se entera.
//   2. Que la detección acierte en los casos conocidos, para poder destacarlo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../socios/index.html', import.meta.url), 'utf8');

test('el aviso del navegador embebido está en la página y no nace escondido', () => {
  const m = HTML.match(/<div id="aviso-webview"[^>]*>/);
  assert.ok(m, 'no está el bloque #aviso-webview en socios/index.html');
  assert.ok(
    !/\bhidden\b/.test(m[0]),
    'el aviso nace con "hidden": entonces solo lo ve quien la detección acierte, ' +
    'y la detección es justo la parte que no se puede garantizar'
  );
  // Y que diga lo que hay que hacer, no solo que algo falló.
  assert.match(HTML, /Abrir en Safari/);
  assert.match(HTML, /Abrir en el navegador/);
});

// La función vive inline en el <script type="module"> de la página. Se extrae
// del texto en vez de importarla porque sacarla a un archivo aparte obligaría
// a que la pantalla de entrada cargue un módulo más antes de poder dibujar el
// aviso, que es exactamente lo que no se quiere.
function detector() {
  const m = HTML.match(/function enNavegadorEmbebido\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, 'no se encontró enNavegadorEmbebido() en socios/index.html');
  return new Function(`${m[0]}; return enNavegadorEmbebido;`)();
}

const CASOS = [
  // [ detecta, nombre, user agent ]
  [true, 'WhatsApp en iPhone (WKWebView, sin token Safari/)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'],
  [true, 'WhatsApp en Android (WebView, token "; wv)")',
    'Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36'],
  [true, 'Facebook en iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/466.0.0.36.107]'],
  [true, 'Instagram en iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.0.31.94'],

  [false, 'Safari en iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
  [false, 'Chrome en iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1'],
  [false, 'Chrome en Android',
    'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'],
  [false, 'Chrome de escritorio',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'],
  [false, 'Safari de escritorio',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'],
];

test('la detección acierta en los navegadores conocidos', () => {
  const enNavegadorEmbebido = detector();
  const original = globalThis.navigator;
  try {
    for (const [esperado, nombre, ua] of CASOS) {
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent: ua }, configurable: true, writable: true
      });
      assert.equal(enNavegadorEmbebido(), esperado, nombre);
    }
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: original, configurable: true, writable: true
    });
  }
});

test('sin user agent no se destaca nada', () => {
  // Un falso positivo acá le pinta un recuadro de alarma a todo el mundo.
  const enNavegadorEmbebido = detector();
  const original = globalThis.navigator;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: {}, configurable: true, writable: true
    });
    assert.equal(enNavegadorEmbebido(), false);
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: original, configurable: true, writable: true
    });
  }
});
