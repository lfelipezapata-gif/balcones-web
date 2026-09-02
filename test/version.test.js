// Guarda del versionado de archivos.
//
// GitHub Pages sirve todo con el mismo nombre siempre, así que el navegador de
// quien ya entró ese día sigue usando el CSS o el JS que tiene guardado. Pasó
// el 2-sep-2026: el botón de WhatsApp aparecía flotando en mitad de la ficha
// mientras los archivos publicados eran idénticos a los locales.
//
// herramientas/versionar.py le pega `?v=TOKEN` a cada referencia, con el token
// sacado del contenido. Esta prueba comprueba que esté al día: publicar con el
// token viejo es exactamente el defecto que el versionado viene a cerrar, y un
// paso manual que nadie vigila se olvida el día que hay afán.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('las versiones de los archivos están al día', () => {
  try {
    execFileSync('python3', ['herramientas/versionar.py'], { encoding: 'utf8' });
  } catch (e) {
    assert.fail(
      'Hay archivos con la versión desactualizada. Corré:\n' +
      '  python3 herramientas/versionar.py --escribir\n\n' +
      (e.stdout || e.message)
    );
  }
});
