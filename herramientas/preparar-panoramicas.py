#!/usr/bin/env python3
"""Deja listas para la web las panorámicas esféricas que salen del DJI Mini 5 Pro.

CÓMO SE USA
-----------
1. Volá la esférica sobre cada lote y bajá la panorámica YA COSIDA desde la app
   DJI Fly al teléfono. En la microSD solo quedan las 33 fotos sueltas dentro de
   DCIM/Panorama; la cosida vive en la app.

2. Pasá esos archivos a una carpeta del computador y renombrá cada uno con el
   NÚMERO DEL LOTE, nada más:

       ~/Desktop/panoramicas/6.jpg
       ~/Desktop/panoramicas/7.jpg
       ...

   Ese paso se hace el mismo día del vuelo, mientras te acordás cuál es cuál.
   Siete potreros verdes son idénticos a la semana siguiente, y no hay forma de
   que un programa lo adivine.

3. Corré:

       python3 herramientas/preparar-panoramicas.py ~/Desktop/panoramicas

   Muestra qué haría, sin escribir nada. Para que escriba de verdad:

       python3 herramientas/preparar-panoramicas.py ~/Desktop/panoramicas --escribir

QUÉ HACE
--------
Baja cada panorámica a 4096x2048 y calidad 80, que es ~1 MB en vez de los 6 a
10 MB que trae. En un celular con datos la diferencia entre 1 MB y 8 MB es la
diferencia entre que la miren y que cierren la página; en pantalla, entre una y
otra no se nota. Las deja en img/pano/lote-NN.jpg y le agrega el campo «pano» a
data/lotes.json.
"""

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit('Falta Pillow. Instalalo con:  python3 -m pip install Pillow')

RAIZ = Path(__file__).resolve().parent.parent
INVENTARIO = RAIZ / 'data' / 'lotes.json'
DESTINO = RAIZ / 'img' / 'pano'

ANCHO, ALTO = 4096, 2048
CALIDAD = 80

# Una equirectangular es 2:1 exacto. Se deja pasar un 3 % de desvío por si un
# modelo recorta distinto, pero una foto normal (4:3, o sea 1,33) se rechaza:
# estirada a 2:1 se ve como un espejo de feria y nadie se da cuenta hasta que
# está publicada.
PROPORCION = 2.0
TOLERANCIA = 0.03


def mide(ruta):
    return ruta.stat().st_size / 1024 / 1024


def cargar_inventario():
    if not INVENTARIO.exists():
        sys.exit(f'No encuentro {INVENTARIO}')
    return json.loads(INVENTARIO.read_text(encoding='utf-8'))


def revisar(origen, inv):
    """Empareja los archivos de la carpeta con los lotes. Falla antes de tocar
    nada: más vale saber que falta el 11 antes de procesar los otros seis."""
    numeros = {l['n']: l for l in inv['lotes']}
    trabajos, problemas = [], []

    archivos = sorted(
        p for p in origen.iterdir()
        if p.suffix.lower() in ('.jpg', '.jpeg') and not p.name.startswith('.')
    )
    if not archivos:
        sys.exit(f'No hay ningún .jpg en {origen}')

    for ruta in archivos:
        if not re.fullmatch(r'\d+', ruta.stem):
            problemas.append(
                f'{ruta.name}: el nombre tiene que ser solo el número del lote '
                f'(6.jpg, 7.jpg). Renombralo.'
            )
            continue

        n = int(ruta.stem)
        lote = numeros.get(n)
        if lote is None:
            problemas.append(f'{ruta.name}: el inventario no tiene ningún lote {n}.')
            continue

        with Image.open(ruta) as im:
            im = ImageOps.exif_transpose(im)
            ancho, alto = im.size

        proporcion = ancho / alto
        if abs(proporcion - PROPORCION) > PROPORCION * TOLERANCIA:
            problemas.append(
                f'{ruta.name}: mide {ancho}x{alto} (proporción {proporcion:.2f}). '
                f'Una esférica es 2:1. ¿Bajaste la panorámica cosida de la app, '
                f'o una de las 33 fotos sueltas de la tarjeta?'
            )
            continue

        trabajos.append({
            'n': n, 'ruta': ruta, 'estado': lote['estado'],
            'ancho': ancho, 'alto': alto, 'mb': mide(ruta)
        })

    return trabajos, problemas


def procesar(trabajo, escribir):
    salida = DESTINO / f'lote-{trabajo["n"]:02d}.jpg'
    if not escribir:
        return salida, None

    DESTINO.mkdir(parents=True, exist_ok=True)
    with Image.open(trabajo['ruta']) as im:
        im = ImageOps.exif_transpose(im).convert('RGB')
        im = im.resize((ANCHO, ALTO), Image.LANCZOS)
        im.save(salida, 'JPEG', quality=CALIDAD, optimize=True, progressive=True)
    return salida, mide(salida)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('carpeta', type=Path, help='carpeta con 6.jpg, 7.jpg, ...')
    ap.add_argument('--escribir', action='store_true',
                    help='sin esto solo muestra qué haría')
    args = ap.parse_args()

    origen = args.carpeta.expanduser()
    if not origen.is_dir():
        sys.exit(f'{origen} no es una carpeta')

    inv = cargar_inventario()
    trabajos, problemas = revisar(origen, inv)

    if problemas:
        print('No se procesó nada. Hay que arreglar esto primero:\n')
        for p in problemas:
            print(f'  x  {p}')
        sys.exit(1)

    if not args.escribir:
        print('PRUEBA — no se escribe nada. Agregá --escribir para que lo haga.\n')

    for t in sorted(trabajos, key=lambda t: t['n']):
        salida, mb = procesar(t, args.escribir)
        aviso = '' if t['estado'] == 'disponible' else f'   (ojo: está «{t["estado"]}»)'
        destino = salida.relative_to(RAIZ)
        if mb is None:
            print(f'  lote {t["n"]:>2}  {t["ancho"]}x{t["alto"]}  {t["mb"]:.1f} MB  ->  {destino}{aviso}')
        else:
            print(f'  lote {t["n"]:>2}  {t["mb"]:.1f} MB  ->  {destino}  {mb:.1f} MB{aviso}')

    if args.escribir:
        conPano = {t['n'] for t in trabajos}
        for lote in inv['lotes']:
            if lote['n'] in conPano:
                lote['pano'] = f'img/pano/lote-{lote["n"]:02d}.jpg'
        INVENTARIO.write_text(
            json.dumps(inv, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
        )
        print(f'\ndata/lotes.json actualizado con {len(conPano)} panorámicas.')
        print('Falta: npm test, mirarlo en el navegador y subirlo.')
    else:
        faltan = sorted(
            l['n'] for l in inv['lotes']
            if l['estado'] == 'disponible' and l['n'] not in {t['n'] for t in trabajos}
        )
        if faltan:
            print(f'\nLotes disponibles todavía sin panorámica: {", ".join(map(str, faltan))}')


if __name__ == '__main__':
    main()
