"""Genera img/mapa.svg con la geometria real de los 14 lotes, sacada del CAD.

Antes esto recortaba una imagen del brochure y el color verde/gris de cada
lote vivia dentro del JPG: al vender un lote habia que rehacer el brochure y
volver a correr el script, y mientras tanto el sitio mostraba en verde un lote
con dueño. Ahora el SVG solo trae geometria -- ni un color de estado, ni un
numero, ni un area escritos adentro. El color y los rotulos los pone
assets/js/mapa.js leyendo data/lotes.json, igual que el titular y los precios.

Uso:
  BALCONES_CAD_ORIGEN=~/ruta/al/plano.dwg python3 herramientas/preparar-mapa.py

El DWG del arquitecto no vive en este repositorio (el repositorio es publico y
no lleva rutas personales). Hay que pasarlo por variable de entorno.

QUE DWG: "BALCONES 3 LOTES V1.dwg". El nombre engaña -- ese archivo trae los
14 lotes, no tres: los 11 del Sector 1 estan ahi con geometria identica al
decimal a la del DWG de 11 lotes. Se comprobo contra los dos. Se usa uno solo
porque el equipo es de 8 GB y cada DXF convertido pesa mas de 30 MB.

COMO SE EMPAREJA CADA POLIGONO CON SU LOTE COMERCIAL, que es lo unico
delicado de todo esto:

  El arquitecto rotula cada poligono por dentro con dos textos en la misma
  capa RETIRO: el numero del lote y su area ("7" y "A=2.129"). El script
  emplea el numero como amarre y el area como control, y exige que los dos
  digan lo mismo.

  Sector 1: el numero del CAD es el numero comercial. Directo.
  Sector 2: NO lo es. El plano numera sus tres lotes 1, 2 y 3 y la numeracion
  comercial corre al reves -- plano 1 = lote 14, plano 2 = 13, plano 3 = 12.
  Ahi el amarre es el area, que en ese sector si distingue los tres sin
  ambiguedad (3.000 / 2.719 / 2.760, separados mas del 1 %).

  Por que no se empareja todo por area: en el Sector 1 los lotes 1 a 4 miden
  2.754, 2.746, 2.761 y 2.752 m2 -- estan a menos del 1 % entre si. El area
  sola no los distingue. Por eso manda el rotulo, y el area verifica.

  Si cualquiera de los dos controles falla, el script aborta sin escribir.
  Un lote vendido pintado de verde en una pagina de venta es un comprador
  llamando por algo que ya tiene dueño.
"""
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import ezdxf
from ezdxf.path import make_path

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "img"

# Sagita de aplanado de los arcos, en metros. Con 2 cm el error de area por
# discretizacion queda muy por debajo del 0,01 % en arcos de este radio.
SAGITA = 0.02

# Tolerancia del control de area contra data/lotes.json.
TOLERANCIA = 0.01

# Englobados de las escrituras. Son la cifra contra la que tiene que cerrar
# la suma de cada sector.
ENGLOBADO = {1: 26442, 2: 8479}

# El plano numera sus tres lotes 1, 2 y 3; la numeracion comercial corre al
# reves. Esto NO se usa para emparejar -- el emparejamiento del Sector 2 sale
# del area. Se usa para comprobar que el area y el rotulo dicen lo mismo.
ROTULO_SECTOR_2 = {"1": 14, "2": 13, "3": 12}

SEPARACION = 40.0   # metros entre los dos sectores en el lienzo
MARGEN = 14.0       # metros de aire alrededor de todo
ALTO_TITULO = 26.0  # metros reservados arriba de cada sector para su titulo
PIE_PANEL = 10.0    # metros de aire debajo del ultimo lote, dentro del panel


# --------------------------------------------------------------------------
# geometria
# --------------------------------------------------------------------------

def area_poligono(pts):
    s = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def dentro(punto, poligono):
    """Punto en poligono por conteo de cruces."""
    x, y = punto
    adentro = False
    n = len(poligono)
    j = n - 1
    for i in range(n):
        xi, yi = poligono[i]
        xj, yj = poligono[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            adentro = not adentro
        j = i
    return adentro


def distancia_al_borde(punto, poligono):
    """Distancia del punto al borde mas cercano; negativa si esta afuera."""
    x, y = punto
    d = math.inf
    n = len(poligono)
    j = n - 1
    for i in range(n):
        xi, yi = poligono[i]
        xj, yj = poligono[j]
        dx, dy = xj - xi, yj - yi
        largo = dx * dx + dy * dy
        t = 0.0 if largo == 0 else max(0.0, min(1.0, ((x - xi) * dx + (y - yi) * dy) / largo))
        d = min(d, math.hypot(x - (xi + t * dx), y - (yi + t * dy)))
        j = i
    return d if dentro(punto, poligono) else -d


def punto_interior(poligono):
    """El punto mas adentro del poligono -- donde va el rotulo.

    El centroide no sirve: varios lotes son concavos (el 11 tiene un arco, el
    12 es un triangulo con una cola larga) y el centroide se sale o cae en la
    parte flaca. Se busca por rejilla el punto que maximiza la distancia al
    borde, primero gruesa y despues fina alrededor del mejor.
    """
    xs = [p[0] for p in poligono]
    ys = [p[1] for p in poligono]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)

    mejor, mejor_d = None, -math.inf
    for paso, (ax0, ax1, ay0, ay1) in ((2.0, (x0, x1, y0, y1)),):
        x = ax0
        while x <= ax1:
            y = ay0
            while y <= ay1:
                d = distancia_al_borde((x, y), poligono)
                if d > mejor_d:
                    mejor, mejor_d = (x, y), d
                y += paso
            x += paso

    mx, my = mejor
    paso = 0.25
    x = mx - 2.0
    while x <= mx + 2.0:
        y = my - 2.0
        while y <= my + 2.0:
            d = distancia_al_borde((x, y), poligono)
            if d > mejor_d:
                mejor, mejor_d = (x, y), d
            y += paso
        x += paso
    return mejor, mejor_d


# --------------------------------------------------------------------------
# lectura del CAD
# --------------------------------------------------------------------------

def a_dxf(dwg, carpeta):
    """Convierte el DWG a DXF en una carpeta temporal. El original no se toca."""
    if shutil.which("dwg2dxf") is None:
        raise SystemExit(
            "Falta dwg2dxf. Se instala con:  brew install libredwg"
        )
    dxf = Path(carpeta) / "plano.dxf"
    r = subprocess.run(["dwg2dxf", "-o", str(dxf), str(dwg)],
                       capture_output=True, text=True)
    if not dxf.is_file():
        raise SystemExit(f"dwg2dxf no produjo el DXF:\n{r.stderr[-2000:]}")
    return dxf


def recorrer(doc, contenedor, matriz=None, profundidad=0):
    """Entidades de un contenedor, entrando a los bloques con su transformacion.

    Los lotes no estan sueltos en el modelspace: viven dentro de un bloque
    anonimo insertado (asi los dejo AutoCAD al copiar el dibujo). Sin entrar a
    los bloques no aparece ninguno.
    """
    if profundidad > 4:
        return
    for e in contenedor:
        if e.dxftype() == "INSERT":
            bloque = doc.blocks.get(e.dxf.name)
            if bloque is None:
                continue
            propia = e.matrix44()
            yield from recorrer(doc, bloque,
                                propia if matriz is None else propia * matriz,
                                profundidad + 1)
        else:
            yield e, matriz


def transformar(matriz, x, y):
    if matriz is None:
        return (x, y)
    v = matriz.transform((x, y, 0))
    return (v.x, v.y)


def leer_lotes(dxf):
    """Poligonos y rotulos de la capa RETIRO, ya en coordenadas topograficas."""
    doc = ezdxf.readfile(str(dxf))
    poligonos, rotulos = [], []
    for e, m in recorrer(doc, doc.modelspace()):
        capa = e.dxf.layer
        if capa != "RETIRO":
            continue
        tipo = e.dxftype()
        if tipo == "LWPOLYLINE" and e.closed:
            vs = list(make_path(e).flattening(distance=SAGITA))
            pts = [transformar(m, v.x, v.y) for v in vs]
            if len(pts) > 1 and pts[0] == pts[-1]:
                pts = pts[:-1]
            if len(pts) < 3:
                continue
            a = area_poligono(pts)
            if a < 500:          # rotulos, circulos de vertice y ruido
                continue
            poligonos.append({"area": a, "pts": pts})
        elif tipo == "TEXT":
            q = e.dxf.insert
            rotulos.append((e.dxf.text.strip(), transformar(m, q.x, q.y)))
    return poligonos, rotulos


def sin_repetidos(poligonos):
    """El dibujo del Sector 2 aparece dos veces en el archivo, en dos posiciones
    del layout. Es el mismo poligono trasladado.

    El parecido se mide con area, perimetro y numero de vertices, que no
    cambian al trasladar. Con margen: las dos copias del lote 14 dan 3.000,50 y
    3.000,51 m2 -- la traslacion pasa por una matriz de coma flotante y deja
    ese centesimo de ruido. Comparar por igualdad exacta las dejaba pasar a
    las dos.
    """
    def perimetro(pts):
        return sum(math.dist(pts[i], pts[(i + 1) % len(pts)])
                   for i in range(len(pts)))

    unicos = []
    for p in poligonos:
        per = perimetro(p["pts"])
        gemelo = any(
            len(q["pts"]) == len(p["pts"])
            and abs(q["area"] - p["area"]) < 0.1
            and abs(q["_per"] - per) < 0.1
            for q in unicos
        )
        if gemelo:
            continue
        p["_per"] = per
        unicos.append(p)
    return unicos


def agrupar(poligonos, holgura=20.0):
    """Agrupa los poligonos que se tocan. Cada sector es un grupo."""
    def caja(p):
        xs = [q[0] for q in p["pts"]]
        ys = [q[1] for q in p["pts"]]
        return (min(xs), min(ys), max(xs), max(ys))

    cajas = [caja(p) for p in poligonos]
    grupo = list(range(len(poligonos)))

    def raiz(i):
        while grupo[i] != i:
            grupo[i] = grupo[grupo[i]]
            i = grupo[i]
        return i

    for i in range(len(poligonos)):
        for j in range(i + 1, len(poligonos)):
            ax0, ay0, ax1, ay1 = cajas[i]
            bx0, by0, bx1, by1 = cajas[j]
            if ax0 - holgura <= bx1 and bx0 - holgura <= ax1 and \
               ay0 - holgura <= by1 and by0 - holgura <= ay1:
                grupo[raiz(i)] = raiz(j)

    grupos = {}
    for i, p in enumerate(poligonos):
        grupos.setdefault(raiz(i), []).append(p)
    return list(grupos.values())


# --------------------------------------------------------------------------
# emparejamiento
# --------------------------------------------------------------------------

def emparejar(poligonos, rotulos, inventario):
    """Le pone su numero comercial a cada poligono. Aborta si algo no cuadra."""
    area_de = {l["n"]: l["area"] for l in inventario["lotes"]}
    sector_de = {l["n"]: l["sector"] for l in inventario["lotes"]}

    grupos = agrupar(poligonos)
    tamanos = sorted(len(g) for g in grupos)
    esperados = sorted(
        len([l for l in inventario["lotes"] if l["sector"] == s])
        for s in sorted({l["sector"] for l in inventario["lotes"]})
    )
    if tamanos != esperados:
        raise SystemExit(
            f"Los poligonos del CAD se agrupan en {tamanos} y el inventario "
            f"espera sectores de {esperados}. No se escribe nada."
        )

    # El sector se identifica por cuantos lotes trae el grupo, no por donde
    # cae en el plano: la posicion de las copias del dibujo cambia de version
    # a version, la cantidad de lotes no.
    por_cantidad = {}
    for s in sorted({l["sector"] for l in inventario["lotes"]}):
        n = len([l for l in inventario["lotes"] if l["sector"] == s])
        if n in por_cantidad:
            raise SystemExit(
                "Dos sectores tienen la misma cantidad de lotes: el grupo ya "
                "no alcanza para saber cual es cual. Hay que revisar el script."
            )
        por_cantidad[n] = s

    asignados = []
    for grupo in grupos:
        sector = por_cantidad[len(grupo)]
        numeros = sorted(n for n, s in sector_de.items() if s == sector)

        for p in grupo:
            p["rotulo_num"] = [t for t, q in rotulos
                               if t.isdigit() and dentro(q, p["pts"])]
            p["rotulo_area"] = [t for t, q in rotulos
                                if t.startswith("A=") and dentro(q, p["pts"])]
            if len(p["rotulo_num"]) != 1:
                raise SystemExit(
                    f"Un poligono de {p['area']:.0f} m2 del sector {sector} tiene "
                    f"{len(p['rotulo_num'])} rotulos de numero adentro "
                    f"({p['rotulo_num']}). Sin un rotulo unico no hay amarre."
                )

        # Amarre por area, uno a uno: cada poligono se usa una sola vez y cada
        # numero tambien. Se resuelve por costo minimo sobre |dif| relativa.
        import itertools
        mejor, mejor_costo = None, math.inf
        for perm in itertools.permutations(numeros):
            costo = sum(abs(p["area"] - area_de[n]) / area_de[n]
                        for p, n in zip(grupo, perm))
            if costo < mejor_costo:
                mejor, mejor_costo = perm, costo

        for p, n in zip(grupo, mejor):
            error = abs(p["area"] - area_de[n]) / area_de[n]
            if error > TOLERANCIA:
                raise SystemExit(
                    f"El lote {n} dice {area_de[n]} m2 y el poligono que le toco "
                    f"mide {p['area']:.1f} m2 ({error * 100:.2f} % de error, el "
                    f"tope es {TOLERANCIA * 100:.0f} %). Emparejamiento malo: "
                    "no se escribe nada."
                )
            # Control cruzado: el rotulo que el arquitecto puso adentro del
            # poligono tiene que decir lo mismo que dijo el area.
            rot = p["rotulo_num"][0]
            esperado = int(rot) if sector == 1 else ROTULO_SECTOR_2.get(rot)
            if esperado != n:
                raise SystemExit(
                    f"El area dice que este poligono es el lote {n}, pero el "
                    f"rotulo del CAD adentro dice «{rot}» (= lote {esperado}). "
                    "Los dos controles no coinciden: no se escribe nada."
                )
            p["n"] = n
            p["sector"] = sector
            p["error"] = error
            asignados.append(p)

    for s, cerrar in ENGLOBADO.items():
        suma = sum(p["area"] for p in asignados if p["sector"] == s)
        if abs(suma - cerrar) / cerrar > TOLERANCIA:
            raise SystemExit(
                f"Las areas del sector {s} suman {suma:.0f} m2 y el englobado "
                f"de la escritura dice {cerrar} m2. No se escribe nada."
            )

    asignados.sort(key=lambda p: p["n"])
    return asignados


# --------------------------------------------------------------------------
# SVG
# --------------------------------------------------------------------------

def componer(asignados):
    """Traslada cada sector a su lugar en el lienzo y voltea el eje Y.

    Una unidad del SVG es un metro, y los dos sectores van a la misma escala
    -- si uno se agrandara para llenar su panel, dos lotes del mismo tamaño se
    verian distintos en una pagina de venta. El Sector 1 va a la izquierda y
    el 2 a la derecha, como en el plano que ya conocen los compradores. Norte
    arriba: en topografia el Norte crece hacia arriba y en SVG la Y crece hacia
    abajo, asi que la Y se invierte.
    """
    sectores = sorted({p["sector"] for p in asignados})
    cajas = {}
    for s in sectores:
        xs = [q[0] for p in asignados if p["sector"] == s for q in p["pts"]]
        ys = [q[1] for p in asignados if p["sector"] == s for q in p["pts"]]
        cajas[s] = (min(xs), min(ys), max(xs), max(ys))

    alto_util = max(cajas[s][3] - cajas[s][1] for s in sectores)
    alto = 2 * MARGEN + ALTO_TITULO + alto_util + PIE_PANEL

    # Cada panel abraza su propio sector y va centrado verticalmente. La
    # alternativa —un panel del alto del lienzo para los dos— dejaba el del
    # Sector 2 con media caja vacia: son 8.479 m2 al lado de 26.442 y a la
    # misma escala eso se nota. La escala no se toca; el panel si.
    desplazamiento, x = {}, MARGEN
    paneles = {}
    for s in sectores:
        x0, y0, x1, y1 = cajas[s]
        ancho_s, alto_s = x1 - x0, y1 - y0
        arriba = MARGEN + (alto_util - alto_s) / 2
        dy = arriba + ALTO_TITULO
        desplazamiento[s] = (x - x0, dy, y1)
        paneles[s] = (x, arriba, ancho_s, ALTO_TITULO + alto_s + PIE_PANEL)
        x += ancho_s + SEPARACION
    ancho = x - SEPARACION + MARGEN

    for p in asignados:
        dx, dy, ytope = desplazamiento[p["sector"]]
        p["svg"] = [(q[0] + dx, ytope - q[1] + dy) for q in p["pts"]]
        (px, py), _ = punto_interior(p["pts"])
        p["ancla"] = (px + dx, ytope - py + dy)

    return ancho, alto, paneles


def a_ruta(pts):
    d = f"M{pts[0][0]:.2f} {pts[0][1]:.2f}"
    for x, y in pts[1:]:
        d += f"L{x:.2f} {y:.2f}"
    return d + "Z"


def escribir_svg(asignados, ancho, alto, paneles, origen):
    l = []
    l.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ancho:.2f} {alto:.2f}"\n'
        f'     class="mapa" role="img" aria-labelledby="mapa-titulo"\n'
        f'     data-generado-desde="{origen}" data-unidad="metro">'
    )
    l.append('  <!-- Una unidad de este viewBox es un metro. Los dos sectores van')
    l.append('       a la misma escala. Aca no hay ni un color de estado ni un')
    l.append('       numero ni un area: los pone assets/js/mapa.js desde')
    l.append('       data/lotes.json. -->')
    l.append('  <title id="mapa-titulo"></title>')

    for s in sorted(paneles):
        px, py, pw, ph = paneles[s]
        holgura = 10.0
        l.append(f'  <g class="sector" data-sector="{s}">')
        l.append(f'    <rect class="panel" x="{px - holgura:.2f}" y="{py:.2f}" '
                 f'width="{pw + 2 * holgura:.2f}" height="{ph:.2f}" rx="6"/>')
        l.append(f'    <text class="titulo-sector" data-sector="{s}" '
                 f'x="{px + pw / 2:.2f}" y="{py + 16:.2f}"></text>')
        for p in [q for q in asignados if q["sector"] == s]:
            l.append(f'    <path class="lote" id="lote-{p["n"]}" data-lote="{p["n"]}" '
                     f'd="{a_ruta(p["svg"])}"/>')
        for p in [q for q in asignados if q["sector"] == s]:
            ax, ay = p["ancla"]
            l.append(f'    <g class="rotulo-lote" data-lote="{p["n"]}">')
            # El ancla es el punto mas adentro del lote. El numero va un poco
            # arriba y el area debajo, para que el par quede centrado ahi.
            l.append(f'      <text class="numero" x="{ax:.2f}" y="{ay - 1.5:.2f}"></text>')
            l.append(f'      <text class="area" x="{ax:.2f}" y="{ay + 7.5:.2f}"></text>')
            l.append('    </g>')
        l.append('  </g>')
    l.append('</svg>')
    return "\n".join(l) + "\n"


# --------------------------------------------------------------------------

ORIGEN = os.environ.get("BALCONES_CAD_ORIGEN")
if not ORIGEN:
    raise SystemExit(
        "Falta la variable BALCONES_CAD_ORIGEN con la ruta al DWG del arquitecto.\n"
        "Ejemplo:\n"
        "  BALCONES_CAD_ORIGEN=~/ruta/BALCONES\\ 3\\ LOTES\\ V1.dwg python3 herramientas/preparar-mapa.py"
    )
ORIGEN = Path(os.path.expanduser(ORIGEN))
if not ORIGEN.is_file():
    raise SystemExit(f"No encontré el DWG en: {ORIGEN}")

inventario = json.loads((RAIZ / "data" / "lotes.json").read_text(encoding="utf-8"))

with tempfile.TemporaryDirectory() as tmp:
    dxf = a_dxf(ORIGEN, tmp)
    poligonos, rotulos = leer_lotes(dxf)

poligonos = sin_repetidos(poligonos)
print(f"poligonos cerrados en la capa RETIRO, sin repetir: {len(poligonos)}")
if len(poligonos) != len(inventario["lotes"]):
    raise SystemExit(
        f"El CAD trae {len(poligonos)} poligonos y el inventario {len(inventario['lotes'])} "
        "lotes. No se escribe nada."
    )

asignados = emparejar(poligonos, rotulos, inventario)

print(f"\n{'lote':>5} {'sector':>7} {'declarada':>10} {'calculada':>11} {'error':>8}  rotulo")
for p in asignados:
    dec = next(l["area"] for l in inventario["lotes"] if l["n"] == p["n"])
    print(f"{p['n']:5d} {p['sector']:7d} {dec:10d} {p['area']:11.2f} "
          f"{p['error'] * 100:7.3f}%  {p['rotulo_num'][0]:>3s} {p['rotulo_area'][0]}")
for s in sorted(ENGLOBADO):
    suma = sum(p["area"] for p in asignados if p["sector"] == s)
    print(f"sector {s}: {suma:.2f} m2 (englobado {ENGLOBADO[s]})")
print(f"total: {sum(p['area'] for p in asignados):.2f} m2 "
      f"(englobados {sum(ENGLOBADO.values())})")

ancho, alto, paneles = componer(asignados)
DESTINO.mkdir(exist_ok=True)
svg = escribir_svg(asignados, ancho, alto, paneles, ORIGEN.name)
(DESTINO / "mapa.svg").write_text(svg, encoding="utf-8")
print(f"\nimg/mapa.svg  {ancho:.0f} x {alto:.0f} m  "
      f"{len(svg.encode('utf-8')) / 1024:.1f} KB")
