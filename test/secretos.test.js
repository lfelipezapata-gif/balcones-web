// Guarda contra secretos y datos personales.
//
// Escanea TODO lo versionado, sin excepciones de carpeta. `docs/` sí trae el
// nombre del dueño, el correo real y los seis socios con sus porcentajes —
// por eso `docs/` está en .gitignore y ya no viaja con el repositorio. Una
// prueba que excluyera la única carpeta con la fuga sería decorativa.
//
// La única exclusión es este mismo archivo: contiene los patrones como texto
// literal (direcciones de ejemplo, el propio nombre a buscar) y se
// autodetectaría.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const archivos = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter(f => f !== 'test/secretos.test.js');

const leer = (f) => {
  try { return readFileSync(f, 'utf8'); } catch { return null; }
};

// Dominios de correo personal más comunes. No se limita a los cuatro
// clásicos: cualquier proveedor masivo cuenta como dato personal si aparece
// con nombre de usuario real.
const DOMINIOS_CORREO_PERSONAL =
  'gmail|hotmail|outlook|live|yahoo|icloud|me|protonmail|proton|aol|msn|yandex|gmx|zoho';

const PROHIBIDO = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'una llave privada'],
  // El nombre del campo solo no basta: worker/test construye credenciales
  // falsas con ese campo para probar la firma del JWT sin tocar Google de
  // verdad. Lo que delata una llave real es el tamaño del valor, no el
  // nombre de la propiedad.
  [/"private_key"\s*:\s*"[^"]{40,}"/, 'una credencial de cuenta de servicio con una llave larga adentro'],
  [/\.iam\.gserviceaccount\.com/, 'el correo de una cuenta de servicio de Google'],
  [/\bGOCSPX-[\w-]+/, 'un secreto de cliente de OAuth'],
  [/\bya29\.[\w.-]{20,}/, 'un token de acceso de Google'],
  [new RegExp(`[\\w.+-]+@(?:${DOMINIOS_CORREO_PERSONAL})\\.[a-z.]{2,}`, 'i'), 'un correo personal real'],
  [/FELIPE\s+ZAPATA/i, 'el nombre completo del dueño del proyecto']
];

test('ningún archivo versionado trae un secreto ni el nombre del dueño', () => {
  for (const f of archivos) {
    const texto = leer(f);
    if (texto === null) continue;
    for (const [patron, que] of PROHIBIDO) {
      const m = texto.match(patron);
      assert.ok(!m, `${f} parece traer ${que} ("${m && m[0]}")`);
    }
  }
});

// Cédula colombiana: 1 a 3 dígitos + exactamente dos grupos de tres, con
// punto de miles. Se exige que sea el número COMPLETO (no un pedazo de un
// valor en pesos con más grupos, que es como se escribe la plata en este
// proyecto: "$1.833.480.000"). Por eso las exclusiones:
//   (?<![\d.$-])  no viene pegado a otro dígito/punto/signo de plata negativa
//   (?!\d)(?!\.\d)  no sigue otro dígito ni otro grupo de tres
//   (?!,\d)         no sigue una coma decimal (formato es-CO de plata)
const CEDULA = /(?<![\d.$-])\d{1,3}\.\d{3}\.\d{3}(?!\.\d)(?!,\d)(?!\d)/;

// Celular colombiano: empieza en 3, diez dígitos, con o sin espacios/guiones
// en cualquiera de los dos cortes (3XX XXX XXXX). Ya hubo una fuga así: un
// teléfono personal quemado dentro de una imagen del proyecto.
const CELULAR = /3\d{2}[ .-]?\d{3}[ .-]?\d{4}/;

// Único número de celular que SÍ puede estar en el repositorio: la línea de
// WhatsApp comercial del botón "Hablemos" de la vitrina. Es pública a
// propósito — está en la campaña de Meta y en el propio texto del sitio.
// No es una fuga, es el contacto de ventas.
const CELULAR_COMERCIAL_PERMITIDO = new Set(['3203769226', '573203769226']);

// `vendor/` queda FUERA de esta segunda prueba, y solo de esta. Son librerías
// de terceros minificadas: código sin espacios, lleno de constantes numéricas
// largas donde cualquier heurística de dígitos encuentra algo. Pannellum trae
// los decimales de pi («…3589793238») y eso pasa por celular colombiano.
//
// La primera prueba —llaves privadas, credenciales, correos personales, el
// nombre del dueño— SÍ sigue corriendo sobre vendor/, y esa es la que atrapa
// una fuga de verdad. Nadie escribe un teléfono personal dentro de una
// librería minificada que se baja de un CDN; el riesgo que justificaba
// escanearlo todo era `docs/`, no este.
// Fuera del escaneo de cedulas y celulares, y solo de ese:
//
//   vendor/  -- librerias de terceros minificadas. Pannellum trae los
//               decimales de pi («…3589793238») y eso pasa por celular.
//   binarios -- una foto no es texto. Leer un JPEG como utf-8 produce ruido
//               con rachas de digitos: img/pano/lote-08.jpg trae «3333333333»
//               en sus pixeles.
//
// ⚠️ OJO CON LO SEGUNDO. Una imagen SI puede llevar una fuga -- ya paso: un
// telefono personal quemado dentro de una imagen del proyecto. Lo que esta
// prueba nunca pudo hacer es detectarlo, porque el numero esta DIBUJADO, no
// escrito en los bytes. Excluir los binarios no baja la vigilancia: quita un
// falso positivo que daba una seguridad que no existia. Un numero dentro de
// una imagen hay que verlo con los ojos.
const BINARIO = /\.(jpe?g|png|gif|webp|ico|pdf|zip|woff2?|ttf|mp4|mov)$/i;
const paraDatosPersonales = archivos.filter(
  f => !f.startsWith('vendor/') && !BINARIO.test(f)
);

test('ningún archivo versionado trae cédulas ni celulares personales', () => {
  for (const f of paraDatosPersonales) {
    const texto = leer(f);
    if (texto === null) continue;

    const cedula = texto.match(CEDULA);
    assert.ok(!cedula, `${f} trae algo con forma de cédula ("${cedula && cedula[0]}")`);

    const regexCelular = new RegExp(CELULAR, 'g');
    let m;
    while ((m = regexCelular.exec(texto))) {
      const limpio = m[0].replace(/[ .-]/g, '');
      assert.ok(
        CELULAR_COMERCIAL_PERMITIDO.has(limpio),
        `${f} trae un número con forma de celular ("${m[0]}")`
      );
    }
  }
});
