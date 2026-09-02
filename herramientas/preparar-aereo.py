#!/usr/bin/env python3
"""Genera el mapa aereo: la ortofoto de la finca con los lotes VIGENTES encima.

POR QUE NO SE USAN LOS LOTES QUE TRAE EL PLANO
----------------------------------------------
El plano de Mapagro («ENTREGABLE BALCONES V2.pdf», 26-abr-2026) trae su propio
loteo dibujado. NO se usa: es un loteo anterior. De sus 19 poligonos solo 6
coinciden con los 14 que se estan vendiendo, y al intentar calzarlos los
residuos daban de 8 a 42 metros -- las formas se repiten pero las posiciones
cambiaron cuando el arquitecto reloteo en junio.

De ese PDF se usan dos cosas y nada mas: LA FOTO y LA CUADRICULA DE
COORDENADAS. Los linderos salen del CAD del arquitecto, que es el vigente.

LA GEORREFERENCIACION, COMPROBADA POR TRES VIAS QUE NO DEPENDEN ENTRE SI
-----------------------------------------------------------------------
  1. El perimetro rojo del plano mide 206.034 m2 contra los 206.034 m2 que
     declara el rotulo.
  2. La cuadricula va a 472,41 pt cada 150 m -> 3,14940 pt/m.
  3. Proyectando con esa escala, los 14 lotes del CAD caen dentro del marco.

Las tres escalas coinciden dentro del 0,01 %.

      x_pagina = 396,4  + 3,14940 * (Este  - 4.729.200)
      y_pagina = 2353,8 - 3,14940 * (Norte - 2.293.200)

Los dos numeros de anclaje se leyeron de los rotulos del plano: «4729200E» en
la vertical de x=396,4 y «2293200N» en la horizontal de y=2353,8.

HACEN FALTA LOS DOS DWG
-----------------------
Cada DWG trae los lotes DOS VECES: una copia en posicion de layout, a 1,1 km
al sur, y otra en la posicion topografica real. Hay que quedarse con la
segunda -- la que cae dentro del marco de la ortofoto.

Y ninguno de los dos archivos alcanza solo:
  BALCONES 11 LOTES V1.dwg -> Sector 1 georreferenciado (lotes 1 a 11)
  BALCONES 3 LOTES V1.dwg  -> Sector 2 georreferenciado (lotes 12, 13, 14)

Uso:
  BALCONES_CAD_11=~/ruta/BALCONES\\ 11\\ LOTES\\ V1.dwg \\
  BALCONES_CAD_3=~/ruta/BALCONES\\ 3\\ LOTES\\ V1.dwg \\
  BALCONES_ORTOFOTO=~/ruta/ENTREGABLE\\ BALCONES\\ V2.pdf \\
  python3 herramientas/preparar-aereo.py
"""
import io
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import fitz
    import ezdxf
    from ezdxf.path import make_path
    from PIL import Image
except ImportError as e:
    sys.exit(f"Falta una libreria: {e}. Se instalan con:  python3 -m pip install pymupdf ezdxf pillow")

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "img"

# Georreferenciacion, leida de la cuadricula del plano.
ESCALA = 472.41 / 150.0        # pt por metro
ESTE_0, X_0 = 4_729_200.0, 396.4
NORTE_0, Y_0 = 2_293_200.0, 2353.8

# Marco util del dibujo dentro de la pagina, en puntos. Fuera de esto estan el
# cajetin, la rosa de los vientos y los margenes.
MARCO = (70.0, 60.0, 2860.0, 2470.0)

MARGEN = 40.0        # puntos de aire alrededor del perimetro en el recorte
ANCHO_WEB = 1800     # px de la imagen final
CALIDAD = 78
SAGITA = 0.02        # aplanado de arcos, en metros


def proyectar(e, n):
    return (X_0 + ESCALA * (e - ESTE_0), Y_0 - ESCALA * (n - NORTE_0))


def area(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def perimetro(pts):
    return sum(math.dist(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts)))


# --------------------------------------------------------------------------
# el PDF
# --------------------------------------------------------------------------

def puntos_de(d):
    out = []
    for it in d["items"]:
        if it[0] == "l":
            out += [tuple(it[1]), tuple(it[2])]
        elif it[0] == "c":
            out += [tuple(it[1]), tuple(it[2]), tuple(it[3]), tuple(it[4])]
    limpio = []
    for q in out:
        if not limpio or math.dist(q, limpio[-1]) > 1e-6:
            limpio.append(q)
    return limpio


def leer_perimetro(pagina):
    """El perimetro rojo de la finca, en puntos de pagina.

    Es la unica geometria que se toma del plano, y sirve de control: su area
    tiene que dar los 206.034 m2 del rotulo.
    """
    mejor = None
    for d in pagina.get_drawings():
        if d.get("color") != (1.0, 0.0, 0.0):
            continue
        P = puntos_de(d)
        if len(P) < 50:
            continue
        if mejor is None or area(P) > area(mejor):
            mejor = P
    if mejor is None:
        raise SystemExit("No se encontro el perimetro rojo en el plano.")
    m2 = area(mejor) / (ESCALA ** 2)
    if abs(m2 - 206_034) / 206_034 > 0.01:
        raise SystemExit(
            f"El perimetro del plano mide {m2:,.0f} m2 y deberia medir 206.034. "
            "O el plano cambio, o la georreferenciacion de este script ya no aplica."
        )
    print(f"  perimetro de la finca: {m2:,.0f} m2  (control: 206.034)")
    return mejor


def cobertura_de_teselas(pagina):
    """El rectangulo que las teselas de foto cubren de verdad."""
    doc = pagina.parent
    r = None
    for x in pagina.get_images(full=True):
        info = doc.extract_image(x[0])
        if info["width"] < 500 or info["height"] < 500:
            continue
        for q in pagina.get_image_rects(x[0]):
            r = q if r is None else (r | q)
    if r is None:
        raise SystemExit("El PDF no trae teselas de ortofoto.")
    return r


def componer_ortofoto(pagina, caja, zoom):
    """Arma la foto pegando SOLO las teselas de imagen del PDF.

    No se puede rasterizar la pagina entera: encima de la foto van dibujados
    el loteo VIEJO con sus rotulos («LOTE-11 2487 m2»), la cuadricula, la rosa
    de los vientos y el cajetin. Rasterizando, todo eso queda quemado en el
    fondo y se ve por debajo de los lotes vigentes -- dos numeraciones
    distintas sobre el mismo terreno, que es justo lo que hay que evitar.

    Las teselas son 41 imagenes de 2000x2000 con su rectangulo de colocacion.
    Pegandolas a mano queda la ortofoto limpia, sin una sola linea dibujada.
    """
    doc = pagina.parent
    ancho = max(1, round(caja.width * zoom))
    alto = max(1, round(caja.height * zoom))
    lienzo = Image.new("RGB", (ancho, alto), (255, 255, 255))
    pegadas = 0
    for x in pagina.get_images(full=True):
        info = doc.extract_image(x[0])
        if info["width"] < 500 or info["height"] < 500:
            continue                      # las tiras de rotulos del margen
        tesela = Image.open(io.BytesIO(info["image"])).convert("RGB")
        for r in pagina.get_image_rects(x[0]):
            if not r.intersects(caja):
                continue
            w = max(1, round(r.width * zoom))
            h = max(1, round(r.height * zoom))
            lienzo.paste(tesela.resize((w, h), Image.LANCZOS),
                         (round((r.x0 - caja.x0) * zoom), round((r.y0 - caja.y0) * zoom)))
            pegadas += 1
    if pegadas == 0:
        raise SystemExit("No se pego ninguna tesela: el PDF no trae la ortofoto donde se espera.")
    print(f"  ortofoto compuesta con {pegadas} teselas, sin el dibujo encima")
    return lienzo


# --------------------------------------------------------------------------
# el CAD
# --------------------------------------------------------------------------

def a_dxf(dwg, carpeta, nombre):
    if shutil.which("dwg2dxf") is None:
        sys.exit("Falta dwg2dxf. Se instala con:  brew install libredwg")
    dxf = Path(carpeta) / f"{nombre}.dxf"
    subprocess.run(["dwg2dxf", "-o", str(dxf), str(dwg)],
                   capture_output=True, text=True)
    if not dxf.is_file():
        sys.exit(f"dwg2dxf no produjo el DXF de {dwg}")
    return dxf


def recorrer(doc, contenedor, matriz=None, prof=0):
    if prof > 4:
        return
    for e in contenedor:
        if e.dxftype() == "INSERT":
            bloque = doc.blocks.get(e.dxf.name)
            if bloque is None:
                continue
            propia = e.matrix44()
            yield from recorrer(doc, bloque,
                                propia if matriz is None else propia * matriz,
                                prof + 1)
        else:
            yield e, matriz


def transformar(m, x, y):
    if m is None:
        return (x, y)
    v = m.transform((x, y, 0))
    return (v.x, v.y)


def leer_poligonos(dxf):
    """Poligonos cerrados de la capa RETIRO, en coordenadas topograficas."""
    doc = ezdxf.readfile(str(dxf))
    out = []
    for e, m in recorrer(doc, doc.modelspace()):
        if e.dxf.layer != "RETIRO" or e.dxftype() != "LWPOLYLINE" or not e.closed:
            continue
        vs = list(make_path(e).flattening(distance=SAGITA))
        pts = [transformar(m, v.x, v.y) for v in vs]
        if len(pts) > 1 and math.dist(pts[0], pts[-1]) < 1e-9:
            pts = pts[:-1]
        if len(pts) < 3 or area(pts) < 500:
            continue
        out.append(pts)
    return out


def dentro_del_marco(pts):
    xs = [proyectar(*p)[0] for p in pts]
    ys = [proyectar(*p)[1] for p in pts]
    x0, y0, x1, y1 = MARCO
    return x0 < min(xs) and max(xs) < x1 and y0 < min(ys) and max(ys) < y1


def numerar(georref, inventario):
    """Le pone su numero comercial a cada poligono georreferenciado.

    El amarre es la FIRMA DE FORMA -- area y perimetro juntos-- contra el
    poligono que ya numero `preparar-mapa.py` y que vive en img/mapa.svg. El
    area sola no basta: los lotes 1, 2, 4 y 12 miden 2.754, 2.746, 2.752 y
    2.760 m2, a menos del 0,3 % entre si, y emparejar por area los confunde.
    Se comprobo: con area sola, cuatro lotes caian sobre el mismo poligono.
    """
    import re
    svg = (DESTINO / "mapa.svg").read_text(encoding="utf-8")
    firmas = {}
    for m in re.finditer(r'<path class="lote"[^>]*data-lote="(\d+)"[^>]*d="([^"]+)"', svg):
        nums = [float(x) for x in re.findall(r"-?\d+\.?\d+", m.group(2))]
        pts = list(zip(nums[0::2], nums[1::2]))
        firmas[int(m.group(1))] = (area(pts), perimetro(pts))
    if not firmas:
        sys.exit("img/mapa.svg no trae poligonos. Corre antes preparar-mapa.py.")

    asignado = {}
    for pts in georref:
        a, p = area(pts), perimetro(pts)
        for n, (fa, fp) in firmas.items():
            if n in asignado:
                continue
            if abs(a - fa) / fa < 0.001 and abs(p - fp) / fp < 0.002:
                asignado[n] = pts
                break

    esperados = {l["n"] for l in inventario["lotes"]}
    faltan = esperados - set(asignado)
    if faltan:
        sys.exit(
            f"No se pudo ubicar en la ortofoto el/los lote(s) {sorted(faltan)}. "
            "Sin eso el mapa aereo mostraria el loteo incompleto y no se escribe nada."
        )
    return asignado


# --------------------------------------------------------------------------
# salida
# --------------------------------------------------------------------------

def d_de(pts):
    return "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + "Z"


def main():
    dwg11 = os.environ.get("BALCONES_CAD_11")
    dwg3 = os.environ.get("BALCONES_CAD_3")
    pdf = os.environ.get("BALCONES_ORTOFOTO")
    if not (dwg11 and dwg3 and pdf):
        sys.exit(__doc__.strip().split("Uso:")[-1])

    inventario = json.loads((RAIZ / "data" / "lotes.json").read_text(encoding="utf-8"))

    print("Plano de Mapagro:")
    pagina = fitz.open(pdf)[0]
    per = leer_perimetro(pagina)

    print("CAD del arquitecto:")
    georref = []
    with tempfile.TemporaryDirectory() as tmp:
        for nombre, dwg in (("s1", dwg11), ("s2", dwg3)):
            polis = leer_poligonos(a_dxf(dwg, tmp, nombre))
            dentro = [p for p in polis if dentro_del_marco(p)]
            print(f"  {Path(dwg).name}: {len(polis)} poligonos, "
                  f"{len(dentro)} en posicion topografica")
            georref += dentro

    lotes = numerar(georref, inventario)
    print(f"  ubicados en la ortofoto: {len(lotes)} de {len(inventario['lotes'])}")

    # recorte alrededor del perimetro
    xs = [p[0] for p in per]; ys = [p[1] for p in per]
    caja = fitz.Rect(min(xs) - MARGEN, min(ys) - MARGEN,
                     max(xs) + MARGEN, max(ys) + MARGEN)
    # Acotado a donde hay foto de verdad. Sin esto el recorte se sale de las
    # teselas por una esquina y quedan franjas blancas en el mapa.
    caja = caja & cobertura_de_teselas(pagina)
    zoom = ANCHO_WEB / caja.width
    img = componer_ortofoto(pagina, caja, zoom)
    DESTINO.mkdir(exist_ok=True)
    ruta_img = DESTINO / "ortofoto.jpg"
    img.save(ruta_img, "JPEG", quality=CALIDAD, optimize=True, progressive=True)
    print(f"\nimg/ortofoto.jpg  {img.width} x {img.height}  "
          f"{ruta_img.stat().st_size/1024:.0f} KB")

    # el SVG trabaja en puntos de pagina, con el origen en la esquina del recorte
    def local(p):
        return (p[0] - caja.x0, p[1] - caja.y0)

    per_l = [local(p) for p in per]
    lotes_l = {n: [local(proyectar(*p)) for p in pts] for n, pts in lotes.items()}

    # «Lo que viene» = el perimetro MENOS los lotes actuales. No se dibuja
    # ningun lindero futuro: solo se sombrea la tierra que todavia no esta
    # loteada, que es exactamente lo que se sabe.
    resto = d_de(per_l) + "".join(d_de(v) for v in lotes_l.values())

    # La estructura es la MISMA que la de img/mapa.svg a proposito: clases
    # .lote[data-lote] y .rotulo-lote[data-lote] con sus <text> .numero y
    # .area, y el <title id="mapa-titulo">. Asi assets/js/mapa.js lo pinta sin
    # cambiar una linea, y de paso hereda su guarda: si el plano y el
    # inventario no hablan de los mismos lotes, revienta en vez de publicar un
    # lote con dueno pintado de verde.
    cx_per = sum(q[0] for q in per_l) / len(per_l)
    cy_per = sum(q[1] for q in per_l) / len(per_l)

    partes = [
        '<svg xmlns="http://www.w3.org/2000/svg"',
        f'     viewBox="0 0 {caja.width:.1f} {caja.height:.1f}" class="mapa aereo"',
        '     role="img" aria-labelledby="mapa-titulo"',
        f'     data-metros-por-unidad="{1/ESCALA:.5f}">',
        '  <title id="mapa-titulo"></title>',
        # La ruta es relativa al DOCUMENTO, no al SVG: el plano se inserta
        # dentro de index.html, no se carga como <img>.
        f'  <image href="img/ortofoto.jpg" x="0" y="0" '
        f'width="{caja.width:.1f}" height="{caja.height:.1f}"/>',
        f'  <path class="resto" fill-rule="evenodd" d="{resto}"/>',
        f'  <path class="perimetro" d="{d_de(per_l)}"/>',
        f'  <text class="rotulo-resto" x="{cx_per:.1f}" y="{cy_per:.1f}">Próximas etapas</text>',
    ]
    for n in sorted(lotes_l):
        partes.append(f'  <path class="lote" id="lote-{n}" data-lote="{n}" '
                      f'd="{d_de(lotes_l[n])}"/>')
    for n in sorted(lotes_l):
        v = lotes_l[n]
        cx = sum(q[0] for q in v) / len(v)
        cy = sum(q[1] for q in v) / len(v)
        partes.append(f'  <g class="rotulo-lote" data-lote="{n}" '
                      f'transform="translate({cx:.1f} {cy:.1f})">'
                      f'<text class="numero" y="-2"></text>'
                      f'<text class="area" y="12"></text></g>')
    partes.append("</svg>")

    ruta_svg = DESTINO / "mapa-aereo.svg"
    ruta_svg.write_text("\n".join(partes) + "\n", encoding="utf-8")
    print(f"img/mapa-aereo.svg  {caja.width:.0f} x {caja.height:.0f} pt  "
          f"{ruta_svg.stat().st_size/1024:.1f} KB")


if __name__ == "__main__":
    main()
