"""Prepara el plano de lotes desde la pagina 4 del brochure.

La pagina original es una hoja de brochure completa: rotulo, titular,
parrafo explicativo, los dos planos, la leyenda, el pie y el numero de
pagina. De todo eso, al sitio solo le sirven los planos y la leyenda.

El titular dice "Los 7 que quedan" quemado en la imagen, y la vitrina ya
muestra ese mismo numero calculado desde data/lotes.json. Dos numeros
para el mismo dato es exactamente el defecto que obligo a rehacer la
portada, asi que aca se recorta.

Uso:
  BALCONES_MAPA_ORIGEN=~/ruta/al/plano.jpg python3 herramientas/preparar-mapa.py

LIMITACION CONOCIDA, y no es menor: el color verde/gris de cada lote
sigue viviendo dentro de la imagen. No se puede generar desde
data/lotes.json porque el plano del brochure no trae la geometria de
cada lote por separado: los lotes vecinos del mismo color estan
fusionados en una sola mancha. Medido -- el Sector 1 tiene 11 lotes y
solo 4 manchas; los lotes 12 y 13 son una sola mancha verde.

Consecuencia practica: cuando se venda otro lote, hay que regenerar el
plano en el brochure y volver a correr este script. Para que el mapa se
pinte solo desde los datos habria que partir de los planos del arquitecto
-- LOTE BALCONES/PRIMERA ETAPA/, version del 4-jun-2026 -- donde cada
lote si es un poligono propio.
"""
from PIL import Image
import json
import os
from pathlib import Path

ORIGEN = os.environ.get("BALCONES_MAPA_ORIGEN")
if not ORIGEN:
    raise SystemExit(
        "Falta la variable BALCONES_MAPA_ORIGEN con la ruta al JPG del plano de lotes.\n"
        "Ejemplo:\n"
        "  BALCONES_MAPA_ORIGEN=~/ruta/al/plano.jpg python3 herramientas/preparar-mapa.py"
    )
ORIGEN = Path(os.path.expanduser(ORIGEN))
if not ORIGEN.is_file():
    raise SystemExit(f"No encontré el archivo del plano en: {ORIGEN}")

DESTINO = Path(__file__).resolve().parent.parent / "img"
DESTINO.mkdir(exist_ok=True)

UMBRAL_BLANCO = 12   # cuanto se aparta del blanco para contar como contenido
CORTE_BANDAS = 15    # filas en blanco que separan una banda de la siguiente
MARGEN = 16


def bandas_de_contenido(im):
    """Filas agrupadas en bandas, separadas por franjas en blanco."""
    ancho, alto = im.size
    pix = im.load()
    con_contenido = []
    for y in range(alto):
        for x in range(0, ancho, 3):          # de a 3 pixeles: alcanza y es rapido
            r, g, b = pix[x, y]
            if max(255 - r, 255 - g, 255 - b) > UMBRAL_BLANCO:
                con_contenido.append(y)
                break

    bandas, inicio, previo = [], con_contenido[0], con_contenido[0]
    for y in con_contenido[1:]:
        if y - previo > CORTE_BANDAS:
            bandas.append((inicio, previo))
            inicio = y
        previo = y
    bandas.append((inicio, previo))
    return bandas


def franja_util(bandas):
    """Los planos y la leyenda: la banda mas alta, y la que le sigue.

    Se ubica por altura y no por indice para que el recorte no dependa
    de cuantos parrafos traiga el brochure de turno.
    """
    planos = max(bandas, key=lambda b: b[1] - b[0])
    posteriores = [b for b in bandas if b[0] > planos[1]]
    leyenda = posteriores[0] if posteriores else planos
    return planos[0], leyenda[1]


def margenes_laterales(im, arriba, abajo):
    ancho = im.size[0]
    pix = im.load()
    izq, der = ancho, 0
    for y in range(arriba, abajo, 2):
        for x in range(ancho):
            r, g, b = pix[x, y]
            if max(255 - r, 255 - g, 255 - b) > UMBRAL_BLANCO:
                izq = min(izq, x)
                break
        for x in range(ancho - 1, -1, -1):
            r, g, b = pix[x, y]
            if max(255 - r, 255 - g, 255 - b) > UMBRAL_BLANCO:
                der = max(der, x)
                break
    return izq, der


original = Image.open(ORIGEN).convert("RGB")
bandas = bandas_de_contenido(original)
arriba, abajo = franja_util(bandas)
izq, der = margenes_laterales(original, arriba, abajo)

caja = (
    max(0, izq - MARGEN),
    max(0, arriba - MARGEN),
    min(original.width, der + MARGEN),
    min(original.height, abajo + MARGEN),
)
mapa = original.crop(caja)
mapa.save(DESTINO / "mapa.jpg", quality=82, optimize=True)

# Huella del inventario con el que se genero este mapa.
# Como los colores viven dentro de la imagen, esta huella es lo que
# permite que una prueba avise cuando el mapa quedo desactualizado, en
# vez de que el sitio muestre un lote en verde que ya se vendio.
RAIZ = Path(__file__).resolve().parent.parent
inventario = json.loads((RAIZ / "data" / "lotes.json").read_text(encoding="utf-8"))
huella = {
    "generadoDesde": ORIGEN.name,
    "estados": {str(l["n"]): l["estado"] for l in sorted(inventario["lotes"], key=lambda l: l["n"])},
}
(DESTINO / "mapa-estado.json").write_text(
    json.dumps(huella, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)

print(f"original {original.size}")
print("bandas detectadas:")
for a, b in bandas:
    marca = "  <- se conserva" if a >= arriba and b <= abajo else "  (descartada)"
    print(f"   y {a}-{b}{marca}")
print(f"recorte {caja} -> mapa.jpg {mapa.size}")
print(f"peso {(DESTINO / 'mapa.jpg').stat().st_size / 1024:.1f} KB")
