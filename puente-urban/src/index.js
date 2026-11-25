// Puente de tablero.urbansas.com.co al Worker del tablero de socios.
//
// Por qué existe (6-nov-2026): la red de AASSA bloquea todo *.workers.dev con la
// categoría «Web Hosting» de su Fortinet, así que desde esas oficinas el tablero
// abría la página pero no cargaba datos. urbansas.com.co sí pasa el filtro.
//
// Por qué un puente y no mover el Worker: urbansas.com.co vive en la cuenta de
// Cloudflare de Urban, y el Worker con sus secretos (SOCIOS_AUTORIZADOS y la
// cuenta de servicio de Google) vive en la del Consorcio Balcones (desde el
// 25-nov-2026; antes, en la personal). Un dominio propio
// solo se le puede colgar a un Worker de la misma cuenta. El puente no guarda
// nada ni decide nada: reenvía método, ruta, encabezados (incluida la
// credencial de Google y el Origin) y cuerpo, y devuelve la respuesta tal cual,
// con los encabezados CORS que pone el Worker de verdad.
export const DESTINO = 'https://balcones-tablero.consorciobalconessro.workers.dev';

export default {
  async fetch(request, env, ctx, { fetchImpl = fetch } = {}) {
    const url = new URL(request.url);
    const destino = new URL(url.pathname + url.search, DESTINO);
    return fetchImpl(new Request(destino, request));
  },
};
