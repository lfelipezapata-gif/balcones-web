// Guarda de despliegue.
//
// `assets/js/config.js` viaja con dos marcadores «PONER-AQUI» que hay que
// reemplazar antes de publicar. Nada en tiempo de ejecución los detecta: con el
// ID de cliente sin llenar, la pantalla de entrada queda sin botón y sin
// explicación, y con la URL del Worker sin llenar todo `fetch` muere en CORS y
// el socio lee «No hay conexión con el servidor del tablero», que apunta al
// lugar equivocado.
//
// Mientras los marcadores estén, esta prueba se SALTA con la razón a la vista en
// la salida de `npm test` — no rompe la suite, pero no deja olvidarse. Cuando se
// reemplacen, deja de saltarse sola y pasa a exigir que los dos valores tengan
// forma real. Instrucciones completas en README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CONFIG = readFileSync(new URL('../assets/js/config.js', import.meta.url), 'utf8');
const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const MARCADOR = 'PONER-AQUI';
const PENDIENTES = [
  ['GOOGLE_CLIENT_ID', 'el ID de cliente de OAuth de Google, en Google Cloud → Credenciales'],
  ['API_TABLERO', 'la URL pública del Worker desplegado, terminada en /api/tablero']
].filter(([nombre]) => new RegExp(`${nombre}\\s*=\\s*'[^']*${MARCADOR}`).test(CONFIG));

const razon = PENDIENTES.length === 0
  ? false
  : 'SIN DESPLEGAR — assets/js/config.js todavía tiene marcadores «PONER-AQUI». ' +
    'Falta llenar: ' + PENDIENTES.map(([n, q]) => `${n} (${q})`).join(' · ') +
    '. Ver README.md, sección «Desplegar».';

// El aviso se imprime aparte de la razón del salto: una prueba saltada es fácil
// de pasar por alto en una salida larga, y esta no se puede pasar por alto.
if (razon) {
  console.error(`\n*** ${razon} ***\n`);
}

test('config.js no puede quedar con marcadores sin reemplazar', { skip: razon }, () => {
  assert.ok(
    !CONFIG.includes(MARCADOR),
    `assets/js/config.js todavía dice «${MARCADOR}». Ver README.md, sección «Desplegar».`
  );
  assert.match(
    CONFIG,
    /GOOGLE_CLIENT_ID = '[\w-]+\.apps\.googleusercontent\.com'/,
    'GOOGLE_CLIENT_ID tiene que ser un ID de cliente de OAuth de Google completo'
  );
  assert.match(
    CONFIG,
    /API_TABLERO = 'https:\/\/[^']+\/api\/tablero'/,
    'API_TABLERO tiene que ser la URL https del Worker, terminada en /api/tablero'
  );
});

// El README es lo único que queda en el repositorio explicando el despliegue:
// `docs/` salió por la fuga de datos personales y se llevó las instrucciones.
test('el README documenta las variables y los secretos del Worker', () => {
  for (const nombre of ['GOOGLE_CLIENT_ID', 'ID_HOJA_ESPEJO', 'ORIGEN_PERMITIDO',
                        'SOCIOS_AUTORIZADOS', 'CUENTA_SERVICIO_JSON', 'API_TABLERO']) {
    assert.ok(README.includes(nombre), `el README no explica ${nombre}`);
  }
  assert.match(README, /wrangler secret put/, 'el README no dice cómo se cargan los dos secretos');
});
