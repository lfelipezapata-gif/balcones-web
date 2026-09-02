import { resumenInventario, lotesDisponibles } from './inventario.js';
import { pesos, metros } from './formato.js';

// Lo que se lee ARRIBA del plano, antes de verlo.
//
// Un plano de lotes sin una frase que diga qué hacer con él es un dibujo: la
// gente lo mira y sigue de largo. Y la frase tiene que prometer lo que hay
// —la vista desde el lote— y no «la ficha», que no significa nada para quien
// está pensando en comprar una casa-finca.
//
// Sale del dato y no escrita a mano porque las panorámicas entran de a poco.
// Prometer una vista en 360° de un lote que no la tiene es peor que no
// prometer nada: el que toca y no la encuentra ya no vuelve a tocar.
function construirPista(disponibles) {
  const con360 = disponibles.filter(l => l.pano).length;
  if (con360 === 0) {
    return 'Tocá un lote verde del plano para ver su área y su precio.';
  }
  if (con360 === disponibles.length) {
    return 'Tocá un lote verde del plano y vas a ver la vista en 360° desde ese lote, ' +
           'con su área y su precio.';
  }
  return `Tocá un lote verde del plano para ver su área y su precio. ` +
         `${con360} de ${disponibles.length} ya tienen la vista en 360° desde el lote.`;
}

export function construirVistaVitrina(json) {
  const r = resumenInventario(json);
  const titular = r.disponibles === 1
    ? 'Queda 1'
    : `Los ${r.disponibles} que quedan`;
  const disponibles = lotesDisponibles(json);

  return {
    titular,
    // «de apertura de la primera etapa» dice por que ese es el precio y deja
    // dicho que hay mas etapas, sin prometer una fecha ni un porcentaje de
    // aumento. Es lo unico que se puede sostener: que suba y cuanto no esta
    // decidido, y una promesa que no se cumple se paga con el comprador que
    // la escucho.
    subtitulo: `${metros(r.areaDisponible)} disponibles · ${pesos(json.precioM2)} el m² ` +
               `— precio de apertura de la primera etapa`,
    pista: construirPista(disponibles),
    tarjetas: disponibles.map(l => ({
      n: l.n,
      sector: l.sector,
      area: l.area,
      areaTexto: metros(l.area),
      precio: l.precio,
      precioTexto: pesos(l.precio),
      tiene360: Boolean(l.pano)
    }))
  };
}
