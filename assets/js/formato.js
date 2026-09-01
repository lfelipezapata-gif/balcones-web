const MILES = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

export function pesos(n) {
  return '$' + MILES.format(Math.round(n));
}

export function metros(n) {
  return MILES.format(Math.round(n)) + ' m²';
}
