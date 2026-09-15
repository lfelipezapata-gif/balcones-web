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
import { readFileSync } from 'node:fs';

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

// El token solo protege lo que pesa en él. El manifiesto de un anteproyecto se
// pide en tiempo de ejecución con el token pegado, así que si su contenido no
// entra en el hash, cambiarlo no mueve el token y quien ya abrió esa ficha ese
// día sigue viendo la versión vieja — sin error y sin señal de nada. Pasó el
// 15-sep-2026 con `data/casa-lote-7.json`, que se publicó sin agregarlo a la
// lista. Ahora entran por patrón; esta prueba es la que avisa si el patrón deja
// de cubrirlos.
test('todo manifiesto que nombra el inventario pesa en el token', () => {
  const versionados = execFileSync('python3', ['herramientas/versionar.py', '--lista'],
    { encoding: 'utf8' }).trim().split('\n');
  const inv = JSON.parse(readFileSync(new URL('../data/lotes.json', import.meta.url)));
  for (const l of inv.lotes) {
    if (!l.casa) continue;
    assert.ok(versionados.includes(l.casa),
      `el lote ${l.n} apunta a ${l.casa} y ese archivo no entra en el token: ` +
      'cambiarlo no invalida la copia guardada en el navegador');
  }
});
