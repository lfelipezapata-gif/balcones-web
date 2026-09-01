"""Prepara las piezas de marca desde el JPEG original del logotipo.

El original es una maqueta: 1254x1254, fondo verde quemado, sin canal alfa.
Este script recorta el aire, saca los tamanos del sitio y produce una version
con transparencia usando la luminancia como canal alfa — sirve porque el logo
es dorado claro sobre un verde casi negro.

El JPEG original no vive en este repositorio (el repositorio es público y no
lleva rutas personales). Hay que pasarlo por variable de entorno:

    BALCONES_LOGO_ORIGEN=~/ruta/al/logo.JPG python3 herramientas/preparar-logo.py
"""
import os
from PIL import Image, ImageFilter
from pathlib import Path

ORIGEN = os.environ.get("BALCONES_LOGO_ORIGEN")
if not ORIGEN:
    raise SystemExit(
        "Falta la variable BALCONES_LOGO_ORIGEN con la ruta al JPEG del logotipo.\n"
        "Ejemplo:\n"
        "  BALCONES_LOGO_ORIGEN=~/ruta/al/logo.JPG python3 herramientas/preparar-logo.py"
    )
ORIGEN = Path(os.path.expanduser(ORIGEN))
if not ORIGEN.is_file():
    raise SystemExit(f"No encontré el archivo del logotipo en: {ORIGEN}")

DESTINO = Path(__file__).resolve().parent.parent / "img"
DESTINO.mkdir(exist_ok=True)

VERDE = (2, 24, 12)          # el fondo del original, muestreado
UMBRAL = 28                  # por encima de esto ya es dorado, no fondo

def recortar(im):
    """Quita el aire de fondo alrededor del logo."""
    gris = im.convert("L")
    # El filtro de mediana borra los píxeles sueltos de ruido de compresión
    # JPEG (aparecen bien por encima del arco real, cerca de y≈157) sin tocar
    # las formas grandes del logo — sin esto, getbbox() los toma como parte
    # del logo y el recorte queda descentrado hacia arriba.
    mascara = gris.point(lambda v: 255 if v > UMBRAL else 0).filter(ImageFilter.MedianFilter(5))
    caja = mascara.getbbox()
    margen = 12
    izq, arr, der, aba = caja
    return im.crop((
        max(0, izq - margen), max(0, arr - margen),
        min(im.width, der + margen), min(im.height, aba + margen)
    ))

def a_ancho(im, ancho):
    alto = round(im.height * ancho / im.width)
    return im.resize((ancho, alto), Image.LANCZOS)

def cuadrado(im, lado):
    """Centra el logo recortado en un lienzo cuadrado del verde de la marca."""
    escalado = a_ancho(im, lado)
    lienzo = Image.new("RGB", (lado, lado), VERDE)
    lienzo.paste(escalado, (0, (lado - escalado.height) // 2))
    return lienzo

def con_alfa(im):
    """Usa la luminancia como transparencia. Sirve sobre fondos oscuros."""
    rgba = im.convert("RGBA")
    alfa = im.convert("L").point(lambda v: 0 if v <= UMBRAL else min(255, int(v * 1.6)))
    rgba.putalpha(alfa)
    return rgba

def aplanar_fondo(im):
    """Reemplaza el fondo (ruido y viñeta que trae el JPEG original) por el
    verde de marca plano. El sitio usa este mismo verde como fondo real, así
    que el cambio es invisible — y le quita al PNG el ruido que más pesa."""
    gris = im.convert("L")
    mascara = gris.point(lambda v: 255 if v > UMBRAL else 0)  # 255 = logo
    fondo = Image.new("RGB", im.size, VERDE)
    return Image.composite(im, fondo, mascara)

COLORES = 64  # 128 no bajaba lo suficiente el peso de logo@2x; a 32 ya se ve
              # bandeado en el degradado del arco. 64 es el punto sin banda visible.

def cuantizar_rgb(im, colores=COLORES):
    """Reduce a una paleta indexada, sin dither (el dorado con textura ya
    trae su propio grano; el dither de más solo suma peso sin verse mejor)."""
    return im.quantize(colors=colores, method=Image.MEDIANCUT, dither=Image.Dither.NONE)

COLORES_ALFA = 32  # menos que COLORES: al reconvertir a RGBA verdadero (ver
                    # abajo) se pierde la ventaja de la paleta indexada y el
                    # archivo pesa más que el resto a igual número de colores;
                    # con 32 el degradado del arco sigue sin bandas y entra
                    # bajo el tope de logo-sobre-oscuro.

def cuantizar_rgba(im, colores=COLORES_ALFA):
    """Cuantiza preservando el canal alfa y devuelve RGBA verdadero (tipo de
    color PNG 6), no paleta con transparencia (tipo 3) — el sitio y las
    pruebas esperan alfa real."""
    return im.quantize(colors=colores, method=Image.FASTOCTREE,
                        dither=Image.Dither.NONE).convert("RGBA")

original = Image.open(ORIGEN).convert("RGB")
logo = aplanar_fondo(recortar(original))

cuantizar_rgb(a_ancho(logo, 560)).save(DESTINO / "logo.png", optimize=True)
cuantizar_rgb(a_ancho(logo, 1120)).save(DESTINO / "logo@2x.png", optimize=True)
cuantizar_rgba(con_alfa(a_ancho(logo, 1120))).save(DESTINO / "logo-sobre-oscuro.png", optimize=True)
cuantizar_rgb(cuadrado(logo, 32)).save(DESTINO / "favicon-32.png", optimize=True)
cuantizar_rgb(cuadrado(logo, 180)).save(DESTINO / "apple-touch-icon.png", optimize=True)

print(f"original {original.size} -> recortado {logo.size}")
for f in sorted(DESTINO.glob("*.png")):
    print(" ", f.name, Image.open(f).size)
