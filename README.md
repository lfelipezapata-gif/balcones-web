# Balcones — vitrina y tablero de socios

Dos cosas en un mismo repositorio, sin framework y sin paso de compilación:

- **La vitrina** (`index.html`) — la página pública del loteo: portada, mapa, lotes
  disponibles con su área y su precio, y el botón de WhatsApp. Es el destino de la
  pauta, así que se abre casi siempre en celular. Los precios **no están escritos**:
  salen de `data/lotes.json` (área × precio del metro cuadrado), y
  `assets/js/inventario.js` rechaza cualquier lote que traiga un precio a mano.
- **El tablero de socios** (`socios/index.html` + `worker/`) — página privada, sin
  indexar. Se entra con Google y muestra el resumen del proyecto, la cartera de
  compradores con sus abonos y los egresos de obra por categoría. Los datos vienen
  de una hoja espejo de Google Sheets, que lee un Worker de Cloudflare.

La regla que manda en todo el proyecto: **ningún dato ilegible o ausente puede
mostrarse como una cifra en pesos que parezca real.** Un valor que no se pudo leer
sale como raya `—`, un total sumado sobre filas incompletas sale marcado, y si la
hoja no se puede leer se sirve la última lectura buena —marcada como tal— o un
error; nunca ceros.

## Estructura

```
index.html            la vitrina
socios/index.html     el tablero privado
assets/js/            módulos ES compartidos (formato, inventario, vitrina, tablero, config)
assets/css/           una sola hoja de estilos
data/lotes.json       el inventario: la única fuente de áreas, estados y precio del m²
img/                  logo, portada, mapa, favicons
herramientas/         scripts de preparación de imágenes (Python, se corren a mano)
test/                 pruebas del sitio
worker/               el Worker de Cloudflare del tablero
worker/test/          pruebas del Worker
```

## Pruebas

Hacen falta **Node 22 o superior** (usan `node:test`) y nada más para la raíz.

```bash
npm test                              # el sitio
cd worker && npm install && npm test  # el Worker (instala jose)
```

Las dos suites corren solas en CI (`.github/workflows/pruebas.yml`) en cada push.

Entre ellas está `test/secretos.test.js`, que escanea **todo lo versionado** buscando
llaves privadas, credenciales de cuenta de servicio, correos personales, cédulas y
celulares. Si falla, se saca el dato del archivo — no se relaja la prueba.

## Cuando se vende un lote

Casi todo se actualiza solo. En `data/lotes.json` se le cambia el `estado` al lote,
de `disponible` a `vendido`, y con eso la vitrina recalcula el titular, el área
disponible y el listado. **El precio nunca se escribe:** sale de `área × precioM2`.

Lo único que **no** se actualiza solo es el plano, `img/mapa.jpg`, porque el color
verde y gris de cada lote vive dentro de la imagen. No se puede pintar desde los
datos: el plano del brochure trae los lotes vecinos del mismo color fusionados en
una sola mancha —el Sector 1 tiene 11 lotes y solo 4 manchas—, así que no hay
geometría individual que recolorear.

Para que eso no se vuelva una mentira en pantalla, `img/mapa-estado.json` guarda con
qué inventario se generó el plano, y una prueba compara las dos cosas. Si se vende un
lote y no se regenera el plano, **la suite falla** y dice cuál lote quedó mal, en vez
de que el sitio siga mostrando en verde algo que ya tiene dueño.

Regenerarlo, después de rehacer el plano en el brochure:

```bash
BALCONES_MAPA_ORIGEN=<ruta al plano del brochure> python3 herramientas/preparar-mapa.py
```

Para que el plano se pinte solo desde `data/lotes.json` habría que partir de los
planos del arquitecto, donde cada lote sí es un polígono propio.

## Servir la vitrina

En local hace falta un servidor: la página carga `data/lotes.json` con `fetch` y usa
módulos ES, y las dos cosas fallan abriendo el archivo con doble clic (`file://`).

```bash
python3 -m http.server 8000     # desde la raíz del repositorio
```

Abrir `http://localhost:8000/` para la vitrina y `http://localhost:8000/socios/` para
el tablero. Se baja con `Ctrl-C`.

En producción es un sitio estático: se publica tal cual en cualquier hosting de
archivos (GitHub Pages, por ejemplo). No hay build ni dependencias de navegador.

## Desplegar

El tablero es lo único que necesita despliegue. Son cuatro pasos y hay que hacerlos
en orden, porque el último necesita la URL que sale del tercero.

### 1. Variables públicas — `worker/wrangler.toml`, bloque `[vars]`

Van en el archivo, versionadas. Ninguna es secreta.

| Variable | Qué es | De dónde sale |
|---|---|---|
| `GOOGLE_CLIENT_ID` | El ID de cliente de OAuth con el que los socios inician sesión. Es público por diseño: queda amarrado al origen autorizado. | Google Cloud → APIs y servicios → Credenciales → ID de cliente de OAuth, tipo «Aplicación web». En sus orígenes autorizados de JavaScript va el mismo valor de `ORIGEN_PERMITIDO`. |
| `ID_HOJA_ESPEJO` | El identificador de la hoja de cálculo espejo que el Worker lee. | De la URL de la hoja, el tramo que va entre `/d/` y `/edit`. |
| `ORIGEN_PERMITIDO` | El origen exacto donde queda publicada la vitrina. Con esquema, sin barra final ni ruta (`https://ejemplo.com`). Es la cabecera CORS que deja al navegador hablarle al Worker. | Lo define dónde se publique el sitio. Si queda vacío o mal escrito, todo `fetch` del tablero muere en CORS y el socio lee «No hay conexión con el servidor del tablero», que apunta al lugar equivocado. |

La hoja espejo necesita cuatro pestañas, con estos nombres exactos y su fila de
encabezado: **Resumen**, **Cartera**, **Abonos** y **Egresos**. El Resumen necesita
además seis filas rotuladas `Vendido`, `Abonado`, `Por cobrar`, `Disponible`,
`Gastado en obra` y `Caja`. Si alguna se renombra o se borra, el tablero lo avisa por
su nombre en vez de mostrar un número equivocado.

### 2. Secretos — nunca en un archivo

Los dos van por línea de comandos y quedan guardados en Cloudflare, no en el
repositorio.

```bash
cd worker
npx wrangler secret put SOCIOS_AUTORIZADOS
npx wrangler secret put CUENTA_SERVICIO_JSON
```

| Secreto | Qué se pega cuando lo pide |
|---|---|
| `SOCIOS_AUTORIZADOS` | Los correos de Google de los socios que pueden entrar, **separados por coma** (`uno@ejemplo.com,otra@ejemplo.com`). No distingue mayúsculas ni espacios sobrantes. Si falta o queda vacío, el Worker responde 500 «El tablero no está configurado» a propósito: un secreto olvidado no puede leerse como «no tenés acceso». |
| `CUENTA_SERVICIO_JSON` | El JSON completo de la cuenta de servicio de Google, **en una sola línea**. Esa cuenta necesita permiso de lectura sobre la hoja espejo: hay que compartirle la hoja al correo que el propio JSON trae en su campo `client_email`. El alcance que pide el Worker es solo de lectura. |

El archivo de credenciales descargado de Google **no se guarda en el repositorio**:
`.gitignore` ya bloquea `credenciales-*.json` y `.dev.vars`.

### 3. Publicar el Worker

```bash
cd worker && npm install && npx wrangler deploy
```

Al terminar, `wrangler` imprime la URL del Worker. Esa es la que hace falta en el
paso 4, con `/api/tablero` al final.

> **Conviene un dominio propio.** La Cache API de Cloudflare —de donde sale la
> «última lectura buena» cuando Google Sheets falla— está documentada para dominios
> propios, no para `*.workers.dev`. Si esa caché no opera, toda falla de lectura le
> responde 503 al socio en vez de servirle el último dato bueno. Vale probar la
> degradación a mano antes de darle el enlace a nadie.

### 4. Llenar `assets/js/config.js`

Dos valores, los dos públicos:

| Constante | Qué se pone |
|---|---|
| `GOOGLE_CLIENT_ID` | El mismo del paso 1. |
| `API_TABLERO` | La URL del Worker del paso 3, terminada en `/api/tablero`. |

Mientras digan `PONER-AQUI`, `npm test` **salta** la prueba de
`test/despliegue.test.js` y deja el aviso a la vista en la salida. Cuando se
reemplacen, esa prueba deja de saltarse y verifica que los dos valores tengan forma
real.

### Antes de darle el enlace a los socios

- Entrar con un correo **de la lista**: tiene que cargar el tablero.
- Entrar con un correo **fuera de la lista**: tiene que decir «No tenés acceso a este
  tablero», no un error de sistema.
- Mirar la sección **Revisar** del final: ahí aparecen las celdas que no se pudieron
  leer, con su pestaña, su fila y su columna.

## Reglas del proyecto

- **Todo en español**, incluidos los comentarios del código y los mensajes de error.
- Ningún dato ilegible o ausente se muestra como plata: `null` es raya `—` y un total
  incompleto se marca junto a la cifra.
- Los mensajes de error de identidad **no distinguen** entre token inválido, vencido o
  de otra aplicación: es a propósito, y no se debe cambiar.
- Ningún dato personal ni secreto en archivos versionados.
- `jose` es la **única** dependencia de producción.
