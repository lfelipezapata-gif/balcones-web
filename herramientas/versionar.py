#!/usr/bin/env python3
"""Le pone la version del contenido a cada archivo que carga la pagina.

EL PROBLEMA. GitHub Pages sirve todo con el mismo nombre siempre. Cuando se
publica un cambio, el navegador de quien ya entro ese dia sigue usando el CSS
o el JS que tiene guardado: la pagina queda a medias, con el HTML nuevo y los
estilos viejos. Paso el 2-sep-2026 -- el boton de WhatsApp aparecia flotando
en mitad de la ficha, y los archivos publicados eran identicos a los locales.

LA SOLUCION. A cada referencia se le pega `?v=TOKEN`, donde TOKEN sale del
CONTENIDO de todos los archivos versionados. Si cambia cualquiera, cambia el
token, cambian todas las URL y el navegador vuelve a pedirlo todo. Si no
cambia nada, el token es el mismo y no se descarga nada de mas.

POR QUE UN SOLO TOKEN Y NO UNO POR ARCHIVO. Los modulos se importan entre si
(`vitrina.js` importa `inventario.js`), asi que versionar solo lo que nombra
el HTML deja los de adentro con la copia vieja -- que es peor que no versionar
nada: mezcla codigo nuevo con codigo viejo en vez de servir todo viejo. Un
token comun evita tener que rastrear ese arbol. Se baja de mas cuando cambia
un solo archivo; a este tamano no importa.

EL TOKEN SE CALCULA SOBRE EL TEXTO SIN VERSIONES, si no seria circular:
escribir el token cambiaria el contenido y por tanto el token.

Uso:
  python3 herramientas/versionar.py            comprueba y dice si esta al dia
  python3 herramientas/versionar.py --escribir escribe las versiones

`npm test` comprueba que este al dia. Publicar con el token viejo es
exactamente el defecto que esto viene a cerrar, asi que la prueba no perdona.
"""
import argparse
import hashlib
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# Lo que la pagina carga y puede quedar viejo en el navegador. El .jpg de la
# ortofoto entra porque lo referencia el SVG del plano; las panoramicas no,
# porque solo se piden al abrir una ficha y su nombre cambia cuando cambia el
# lote.
VERSIONADOS = [
    "assets/css/estilos.css",
    "assets/js/config.js",
    "assets/js/ficha.js",
    "assets/js/formato.js",
    "assets/js/inventario.js",
    "assets/js/mapa.js",
    "assets/js/paneles.js",
    "assets/js/tablero.js",
    "assets/js/vitrina.js",
    "data/lotes.json",
    "img/mapa-aereo.svg",
    "img/ortofoto.jpg",
    "vendor/pannellum.css",
    "vendor/pannellum.js",
]

# Donde se reescriben las referencias.
ESCRIBIR_EN = ["index.html", "img/mapa-aereo.svg",
               "assets/js/ficha.js", "assets/js/vitrina.js",
               "assets/js/mapa.js", "assets/js/tablero.js",
               "assets/js/paneles.js", "assets/js/inventario.js",
               "socios/index.html"]

VERSION = re.compile(r"\?v=[0-9a-f]{8}")


def sin_version(texto):
    return VERSION.sub("", texto)


def token():
    h = hashlib.sha256()
    for rel in VERSIONADOS:
        f = RAIZ / rel
        if not f.is_file():
            sys.exit(f"Falta {rel}: la lista de versionados no cuadra con el repositorio.")
        crudo = f.read_bytes()
        # Los de texto se limpian de versiones antes de pesar; los binarios no
        # las tienen y se toman tal cual.
        try:
            h.update(sin_version(crudo.decode("utf-8")).encode("utf-8"))
        except UnicodeDecodeError:
            h.update(crudo)
    return h.hexdigest()[:8]


def referencias(texto, t):
    """Le pega `?v=t` a cada referencia de un archivo versionado.

    Solo toca rutas ENTRE COMILLAS. Sin esa condicion el patron entra en la
    prosa de los comentarios: la primera version de esto dejo
    «(assets/js/tablero.js?v=1a8a0b7e)» en mitad de una explicacion de
    paneles.js, porque el nombre iba seguido de un parentesis.
    """
    salida = sin_version(texto)
    for rel in VERSIONADOS:
        nombre = re.escape(rel.split("/")[-1])
        carpeta = re.escape("/".join(rel.split("/")[:-1]))
        # Acepta 'img/mapa-aereo.svg', './assets/js/mapa.js' y './mapa.js',
        # siempre que la ruta ocupe la comilla entera.
        patron = re.compile(
            r"(['\"])((?:\.{0,2}/)?(?:" + carpeta + r"/)?" + nombre + r")\1"
        )
        salida = patron.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={t}{m.group(1)}", salida)
    return salida


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--escribir", action="store_true")
    args = ap.parse_args()

    t = token()
    pendientes = []
    for rel in ESCRIBIR_EN:
        f = RAIZ / rel
        if not f.is_file():
            continue
        antes = f.read_text(encoding="utf-8")
        despues = referencias(antes, t)
        if antes != despues:
            pendientes.append(rel)
            if args.escribir:
                f.write_text(despues, encoding="utf-8")

    print(f"version del contenido: {t}")
    if not pendientes:
        print("todo al dia.")
        return
    if args.escribir:
        print("escrito en: " + ", ".join(pendientes))
    else:
        print("SIN ACTUALIZAR: " + ", ".join(pendientes))
        print("Corré:  python3 herramientas/versionar.py --escribir")
        sys.exit(1)


if __name__ == "__main__":
    main()
