import { idLote } from './inventario.js?v=8af9bab6';

// Desde el 24-nov-2026 el estado de cada lote lo manda la app de ventas de
// Balcones (https://ventas.urbansas.com.co), que usan los socios y el asesor de
// Urban. data/lotes.json sigue trayendo el área, el sector y el precio de lista,
// pero su estado es el de la última vez que alguien lo editó a mano. Al abrirse,
// el tablero le pregunta a la app el estado de hoy y lo pone encima.
//
// La app solo contesta `{ id, estado }` con los tres estados públicos: un lote
// bloqueado o separado sale «reservado», y uno en promesa, escriturado o en
// especie sale «vendido». Ni nombres, ni precios, ni clientes.
//
// Se hace en el navegador y no con una rutina que reescriba data/lotes.json
// porque así el plano está al día en el momento, sin depender de que el M5 esté
// prendido y sin un commit cada vez que un socio bloquea un lote.
export const URL_ESTADOS = 'https://ventas.urbansas.com.co/api/estados';

const PUBLICOS = new Set(['disponible', 'reservado', 'vendido']);

// Pone encima del inventario lo que diga la app. Devuelve una copia: el
// inventario que recibe no se toca, y de cada lote solo cambia el estado. Lo que
// no se entienda se ignora, y un lote que la app no traiga se queda como estaba.
//
// El lote en especie es la excepción: la app lo da «vendido» porque de cara al
// público no se distinguen, pero en el tablero de socios va aparte, porque por
// él no entró plata. Si la app lo devuelve a disponible, sí se aplica.
export function aplicarEstados(inv, estados) {
  if (!Array.isArray(estados)) return { inv, cambiados: 0 };
  const porId = new Map();
  for (const e of estados) {
    if (e && typeof e.id === 'string' && PUBLICOS.has(e.estado)) porId.set(e.id, e.estado);
  }
  let cambiados = 0;
  const lotes = inv.lotes.map((l) => {
    const nuevo = porId.get(idLote(l));
    if (!nuevo || nuevo === l.estado) return l;
    if (l.estado === 'especie' && nuevo === 'vendido') return l;
    cambiados++;
    return { ...l, estado: nuevo };
  });
  return { inv: { ...inv, lotes }, cambiados };
}

// Le pide los estados a la app. Si no contesta en `ms` milisegundos, contesta
// con error o manda algo que no es JSON, devuelve null y el tablero se queda con
// data/lotes.json. No manda cookies: la app no necesita saber quién mira.
export async function pedirEstados(url = URL_ESTADOS, ms = 3000, pedir = fetch) {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ms);
  try {
    const r = await pedir(url, { signal: corte.signal, credentials: 'omit' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}
