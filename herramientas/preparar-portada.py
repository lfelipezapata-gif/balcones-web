"""Prepara la imagen de portada desde la página 1 del brochure en PDF.

El original (1323x1871) no es un render limpio: es la portada completa del
brochure, con el título "BALCONES", el subtítulo, las cajas de cifras
("6 DISPONIBLES HOY", "57% YA VENDIDO") y un teléfono y dirección de oficina
quemados encima de la foto aérea. Esas cifras quedan desactualizadas en
cuanto se vende o reserva un lote, y el teléfono es un dato personal — nada
de eso puede ir a un repositorio público.

Este script recorta solo la franja central, que es foto pura: las tres
casas-finca con sus caballerizas a lo largo de la vía. Los márgenes de
recorte se verificaron a mano contra este archivo puntual (texto del título
termina en y≈500, las cajas de cifras empiezan en y≈1385) — no sirven como
fórmula general para otra imagen del brochure.

El JPEG original no vive en este repositorio (es público y no lleva rutas
personales). Hay que pasarlo por variable de entorno:

    BALCONES_PORTADA_ORIGEN=~/ruta/al/brochure/pagina1.jpg python3 herramientas/preparar-portada.py
"""
import os
from PIL import Image
from pathlib import Path

ORIGEN = os.environ.get("BALCONES_PORTADA_ORIGEN")
if not ORIGEN:
    raise SystemExit(
        "Falta la variable BALCONES_PORTADA_ORIGEN con la ruta a la portada del brochure.\n"
        "Ejemplo:\n"
        "  BALCONES_PORTADA_ORIGEN=~/ruta/al/brochure/pagina1.jpg python3 herramientas/preparar-portada.py"
    )
ORIGEN = Path(os.path.expanduser(ORIGEN))
if not ORIGEN.is_file():
    raise SystemExit(f"No encontré el archivo de la portada en: {ORIGEN}")

DESTINO = Path(__file__).resolve().parent.parent / "img"
DESTINO.mkdir(exist_ok=True)

# Franja vertical sin texto: por debajo del subtítulo y por encima de las
# cajas de cifras. Ancho completo — a los lados no hay texto, solo el campo.
RECORTE_ARRIBA = 520
RECORTE_ABAJO = 1360

CALIDAD = 82  # sube por debajo del tope de 250 KB pedido, con detalle nítido
              # en el follaje y las casas; a 90 pasaba el tope.

original = Image.open(ORIGEN).convert("RGB")
portada = original.crop((0, RECORTE_ARRIBA, original.width, RECORTE_ABAJO))

destino = DESTINO / "portada.jpg"
portada.save(destino, quality=CALIDAD, optimize=True)

peso_kb = destino.stat().st_size / 1024
print(f"original {original.size} -> portada {portada.size}")
print(f"  {destino.name} — {peso_kb:.1f} KB (tope 250 KB)")
