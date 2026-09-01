import { autorizar, ErrorAuth, ErrorConfiguracion, jwksDeGoogle } from './auth.js';
import { tokenDeAcceso, leerEspejo, normalizarTablero } from './sheets.js';

const CLAVE_CACHE = 'https://balcones.interno/tablero';

// env.ORIGEN_PERMITIDO puede faltar del todo (no solo venir vacío). Si se deja pasar tal cual,
// `new Headers(...)` lo serializa como el string literal "undefined", un estado confuso que no
// es un comodín pero tampoco dice nada. Ausente se trata como cadena vacía: un origen que ningún
// navegador va a igualar, así que el efecto es negar, no abrir.
const cabeceras = (env) => ({
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': env.ORIGEN_PERMITIDO ?? '',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,OPTIONS',
  'cache-control': 'no-store',
  'vary': 'origin'
});

const responder = (cuerpo, estado, env) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: cabeceras(env) });

export async function manejar(request, env, deps) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cabeceras(env) });
  }
  if (new URL(request.url).pathname !== '/api/tablero') {
    return responder({ error: 'Esa dirección no existe.' }, 404, env);
  }

  try {
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    await autorizar(token, {
      clientId: env.GOOGLE_CLIENT_ID,
      jwks: deps.jwks,
      listaCruda: env.SOCIOS_AUTORIZADOS
    });
  } catch (e) {
    // ErrorConfiguracion va ANTES que el genérico y con su propio estado (500), a
    // propósito: es una falla de quien administra el tablero, no de quien intenta
    // entrar. Si cayera en el catch genérico de 401, un socio legítimo vería
    // "sesión inválida" cuando el problema real es un GOOGLE_CLIENT_ID vacío —
    // exactamente la confusión que auth.js diseñó para evitar. El mensaje no
    // repite el detalle interno (no dice qué variable falta) para no contarle
    // nada a un extraño; sí es identificable por quien opera el Worker.
    if (e instanceof ErrorConfiguracion) return responder({ error: e.message }, e.estado, env);
    if (e instanceof ErrorAuth) return responder({ error: e.message }, e.estado, env);
    return responder({ error: 'No se pudo verificar la sesión.' }, 401, env);
  }

  let tablero;
  try {
    tablero = await deps.leerTablero(env, deps);
  } catch {
    // El tablero nunca muestra $0 por una falla de lectura: si hay una lectura
    // buena guardada se sirve esa, marcada como tal; si no hay ninguna, se
    // responde un error — nunca un cuerpo con ceros.
    let guardado = null;
    try {
      guardado = await deps.cacheLeer();
    } catch {
      // Doble falla: Sheets cayó Y leer el caché también falló (cuota, hiccup
      // de la Cache API). Ninguna ruta de manejar() puede lanzar — se trata
      // igual que "no hay nada que servir" y se responde el mismo 503, nunca
      // se deja escapar la excepción sin capturar.
      guardado = null;
    }
    if (guardado) return responder({ ...guardado, desdeCache: true }, 200, env);
    return responder(
      { error: 'No se pudo leer la información del proyecto. Volvé a intentar en un momento.' },
      503, env
    );
  }

  // La lectura fresca ya está en mano: se sirve pase lo que pase con el
  // guardado en caché. Guardar es un efecto secundario para una degradación
  // futura, no una condición para responder — si cacheGuardar falla, eso no
  // puede tirar a la basura un dato bueno de ahora ni hacer que se sirva el
  // viejo marcado desdeCache.
  const hayPestanaVacia = (tablero.avisos ?? []).some((aviso) => aviso.tipo === 'pestana-vacia');
  if (!hayPestanaVacia) {
    try {
      await deps.cacheGuardar(tablero);
    } catch {
      // Una hoja vacía nunca llega aquí, y una falla de escritura tampoco
      // degrada la respuesta: es solo la copia de resguardo la que no quedó.
    }
  }
  return responder({ ...tablero, desdeCache: false }, 200, env);
}

async function leerTableroReal(env, deps) {
  const credenciales = JSON.parse(env.CUENTA_SERVICIO_JSON);
  const acceso = await tokenDeAcceso(credenciales, { ahora: deps.ahora() });
  const crudo = await leerEspejo({ idHoja: env.ID_HOJA_ESPEJO, tokenAcceso: acceso });
  return normalizarTablero(crudo, { ahora: deps.ahora() });
}

async function cacheLeer() {
  const r = await caches.default.match(CLAVE_CACHE);
  return r ? await r.json() : null;
}

async function cacheGuardar(tablero) {
  await caches.default.put(CLAVE_CACHE, new Response(JSON.stringify(tablero), {
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=86400' }
  }));
}

export default {
  fetch: (request, env) => manejar(request, env, {
    jwks: jwksDeGoogle(),
    ahora: () => new Date(),
    leerTablero: leerTableroReal,
    cacheLeer,
    cacheGuardar
  })
};
