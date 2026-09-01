import { resumenInventario, lotesDisponibles } from './inventario.js';
import { pesos, metros } from './formato.js';

export function construirVistaVitrina(json) {
  const r = resumenInventario(json);
  const titular = r.disponibles === 1
    ? 'Queda 1'
    : `Los ${r.disponibles} que quedan`;

  return {
    titular,
    subtitulo: `${metros(r.areaDisponible)} disponibles · ${pesos(json.precioM2)} el m²`,
    tarjetas: lotesDisponibles(json).map(l => ({
      n: l.n,
      sector: l.sector,
      area: l.area,
      areaTexto: metros(l.area),
      precio: l.precio,
      precioTexto: pesos(l.precio)
    }))
  };
}
