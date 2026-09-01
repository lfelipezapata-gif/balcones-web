const MILES = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

export function pesos(n) {
  return '$' + MILES.format(Math.round(n));
}

export function metros(n) {
  return MILES.format(Math.round(n)) + ' m²';
}

// Una diferencia se lee por el signo antes que por la cifra: «+$5.000.000» dice
// puso de más y «-$5.000.000» dice puso de menos. `pesos` sola devolvería
// «$-5.000.000», con el menos escondido detrás del signo de pesos justo en la
// columna donde el signo ES el dato.
//
// El cero sale como «$0», sin signo: no es de más ni de menos. Y es un cero de
// verdad — el «no se pudo calcular» se muestra como raya y ni siquiera llega
// hasta acá.
export function pesosConSigno(n) {
  const r = Math.round(n);
  if (r === 0) return pesos(0);
  return (r > 0 ? '+' : '-') + pesos(Math.abs(r));
}

// La hoja guarda la participación como fracción (0,33) porque así la usa en sus
// propias fórmulas. En pantalla eso no se lee: un socio espera «33 %».
//
// Hasta dos decimales, para que un 11,5 % no se redondee a 12 % y deje de
// cuadrar con el resto. El multiplicar por 100 deja ruido de coma flotante
// (0,33 × 100 = 33,000000000000004); los dos decimales lo cortan.
const PORCENTAJE = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

export function porcentaje(fraccion) {
  return PORCENTAJE.format(fraccion * 100) + ' %';
}
