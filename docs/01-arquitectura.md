# 01. Arquitectura

## Por qué CesiumJS
- Soporta nativamente cuerpos no terrestres (`Ellipsoid.MOON`, rotación ICRF→fijo lunar) y teselado con LOD/streaming/cache, que Three.js obligaría a escribir a mano.
- Las teselas WMTS de Moon Trek (EPSG:4326, 2×1 en nivel 0) coinciden con `GeographicTilingScheme`. CORS abierto, verificado.
- Sin Cesium Ion ni tokens: `baseLayer: false`, solo teselas públicas de NASA.

## Módulos (`src/`)

| Archivo | Qué hace |
| --- | --- |
| `LunarGlobe.ts` | Clase principal: visor de Cesium, capas, terreno, cámara y la API pública (`setSites`, `on`…) |
| `embed.ts` | `connectToHost`: recibe y valida los mensajes del host y responde solo a orígenes permitidos ([`02`](02-protocolo-postmessage.md)) |
| `types.ts` | Tipos del protocolo y de la configuración |
| `moon.ts` | Elipsoide lunar y rotación ICRF → fijo lunar. Se importa antes de crear cualquier objeto de Cesium |
| `geo.ts` | Inversa de la proyección estereográfica polar sur (CRS de LOLA) |
| `trek.ts` | Raíz de las teselas de Moon Trek (`VITE_TREK_BASE_URL`) |
| `layers.ts` | Capas de imagen (`wac`, `lolaShade`) |
| `terrain.ts` | Terreno: DEM de Moon Trek o la malla del backend ([`03`](03-relieve-y-polo.md)) |
| `terrarium.ts` | Teselas de elevación del backend (`/terrain/tiles`) y detección de su versión |
| `hillshade.ts` | Relieve sombreado del polo sur, calculado en el navegador a partir de las teselas del backend |
| `polar.ts` | Reproyección del mosaico polar sur sobre el globo |
| `sky.ts` | Estrellas, Sol y Tierra ([`06`](06-cielo-y-camara.md)) |
| `horizonView.ts` | Vista de horizonte ([`04`](04-vista-horizonte.md)) |
| `landingScene.ts`, `vehicles.ts`, `regolith.ts` | Escena de alunizaje, módulo y astronauta, textura de regolito ([`05`](05-escena-alunizaje-y-vehiculos.md)) |
| `trackpad.ts` | Gestos de trackpad y rueda ([`06`](06-cielo-y-camara.md)) |
| `main.ts`, `data/mockSites.ts` | Demo independiente con sitios de muestra |
| `index.ts` | Exportaciones para el import directo |

## Import directo
```ts
import { LunarGlobe } from 'lunar-globe-renderer/src'
const globe = new LunarGlobe(el); globe.setSites(sites); globe.on('siteClick', s => ...)
```
Requiere servir `public/cesium` y definir `CESIUM_BASE_URL` (ver `vite.config.ts`).
