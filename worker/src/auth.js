import { jwtVerify, createRemoteJWKSet } from 'jose';

const EMISORES = ['https://accounts.google.com', 'accounts.google.com'];

export class ErrorAuth extends Error {
  constructor(mensaje, estado) {
    super(mensaje);
    this.name = 'ErrorAuth';
    this.estado = estado;
  }
}

/**
 * Falla de configuración del tablero, no de quien intenta entrar.
 * Deliberadamente NO extiende ErrorAuth: quien atrape ErrorAuth para devolver 401
 * no debe convertir esto en «tu sesión no sirve». Es 500 y el tablero no se sirve.
 */
export class ErrorConfiguracion extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorConfiguracion';
    this.estado = 500;
  }
}

export const jwksDeGoogle = () =>
  createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

// Vida de un id_token de Google. Acota por `iat` y tapa el token sin `exp`.
const ANTIGUEDAD_MAXIMA = '1h';

export async function verificarIdentidad(token, { clientId, jwks }) {
  // Va ANTES que nada: jose trata un `audience` vacío como «no revises el destinatario»,
  // así que un GOOGLE_CLIENT_ID sin llenar apagaba la única comprobación que separa
  // «un token de Google» de «un token para este tablero». Tiene que fallar cerrado.
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new ErrorConfiguracion('El tablero no está configurado. Avisale a quien lo administra.');
  }
  if (!token) throw new ErrorAuth('Falta iniciar sesión.', 401);
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: EMISORES,
      audience: clientId,
      // Explícito: sin esto la restricción dependía de que el resolvedor del JWKS
      // no encontrara una llave `oct`, no de una decisión de este módulo.
      algorithms: ['RS256'],
      // `requireExp` no funciona en jose 5.10 (probado): un token sin `exp` pasaba igual.
      // `maxTokenAge` sí acota, por `iat`.
      maxTokenAge: ANTIGUEDAD_MAXIMA
    }));
  } catch {
    throw new ErrorAuth('La sesión no es válida o ya venció.', 401);
  }
  // Cinturón sobre `maxTokenAge`: un token sin vencimiento no se acepta nunca.
  if (typeof payload.exp !== 'number') {
    throw new ErrorAuth('La sesión no es válida o ya venció.', 401);
  }
  if (payload.email_verified !== true || !payload.email) {
    throw new ErrorAuth('La sesión no es válida o ya venció.', 401);
  }
  return { email: String(payload.email).trim().toLowerCase() };
}

// Los correos que la lista deja después de limpiarla. Una lista que no es texto,
// o que solo trae comas y espacios, no deja ninguno.
export function sociosDeLista(listaCruda) {
  if (typeof listaCruda !== 'string') return [];
  return listaCruda.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
}

export function estaAutorizado(email, listaCruda) {
  // Sigue fallando cerrado: una lista sin correos no autoriza a nadie, pase lo
  // que pase. Quién distingue «lista sin llenar» de «correo fuera de la lista»
  // es `autorizar`; esta función nunca abre por error.
  const lista = sociosDeLista(listaCruda);
  if (lista.length === 0) return false;
  // Un correo que no es una cadena no vacía no autoriza nunca. Sin este freno,
  // `String(undefined)` da la cadena "undefined" y, si esa palabra apareciera en la
  // lista por error de copia, un correo ausente quedaría autorizado.
  if (typeof email !== 'string' || email.trim() === '') return false;
  return lista.includes(email.trim().toLowerCase());
}

export async function autorizar(token, { clientId, jwks, listaCruda }) {
  // Mismo trato que GOOGLE_CLIENT_ID: una lista de socios ausente, vacía o que no
  // deja ni un correo después de limpiarla es configuración rota, no un rechazo a
  // quien entra. Sin esto, un secreto olvidado en el despliegue les decía a los
  // seis socios legítimos «No tenés acceso a este tablero» — la misma confusión
  // que este módulo fue diseñado para evitar, en la variable de al lado.
  if (sociosDeLista(listaCruda).length === 0) {
    throw new ErrorConfiguracion('El tablero no está configurado. Avisale a quien lo administra.');
  }
  const { email } = await verificarIdentidad(token, { clientId, jwks });
  if (!estaAutorizado(email, listaCruda)) {
    throw new ErrorAuth('No tenés acceso a este tablero.', 403);
  }
  return { email };
}
