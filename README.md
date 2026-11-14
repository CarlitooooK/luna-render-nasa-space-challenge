# lunar-globe-renderer

Globo lunar 3D estilo Google Earth, **CesiumJS** con elipsoide lunar (`Ellipsoid.MOON`) y teselas NASA Moon Trek (LROC WAC ~100 m/px, LOLA). Proyecto separado de `luna-landing-navigator-console`, pensado para incrustarse como **iframe + postMessage** o por import directo.

## Por qué CesiumJS
- Soporta nativamente cuerpos no terrestres (`Ellipsoid.MOON`, rotación ICRF→fijo lunar) y teselado con LOD/streaming/cache, que Three.js obligaría a escribir a mano.
- Las teselas WMTS de Moon Trek (EPSG:4326, 2×1 en nivel 0) coinciden con `GeographicTilingScheme`. CORS abierto, verificado.
- Sin Cesium Ion ni tokens: `baseLayer: false`, solo teselas públicas de NASA.

## Uso
```bash
npm install
npm run dev      # demo en http://localhost:5173 (copia antes los assets de Cesium a public/cesium)
npm run build
```

### iframe (recomendado para la consola)
```html
<iframe src="https://HOST_DEL_GLOBO/?allowedOrigins=https://HOST_DE_LA_CONSOLA"></iframe>
```
Orígenes permitidos: `VITE_ALLOWED_ORIGINS` (lista separada por comas) o `?allowedOrigins=`. Por defecto `http://localhost:5173`. Los mensajes de otros orígenes se ignoran y nunca se responde a `'*'`.

Host → globo:
- `SET_SITES` (`LandingSite[]`, mismos campos que `/sites`; `status` GO/CAUTION/NO-GO colorea el pin), `SELECT_SITE {id?,lat,lon}`, `RESET`.
- `SET_SUN_LOCAL {lat,lon,vector}` y `SET_EARTH_LOCAL {lat,lon,vector}`: aceptan `sun_vector_3d` / `earth_vector_3d` tal cual (convención D-008). Dibujan el Sol y la Tierra y encienden la iluminación solar.
- `SET_PSR` (`psrs` de `GET /psr/nearby`, tal cual): polígonos sobre la superficie.
- `SET_TRAJECTORY`, `PLAY_ANIMATION`, `FOLLOW_TRAJECTORY {enabled}` (cámara que sigue al módulo).
- `LOOK_AT {body: 'sun'|'earth'}`, `VIEW_FROM_SURFACE {lat,lon,look?}` (cámara a 2 m del suelo real) y `SET_VIEW {lat,lon,altM,headingDeg?,pitchDeg?}`.
- `SET_CONFIG` (rejilla, capas, `terrain`, `terrainExaggeration`, `showStars`, `showSun`, `showEarth`, `autoRotate`…).

Globo → host: `READY`, `SITE_CLICKED`, `GLOBE_CLICKED`, `ANIMATION_COMPLETE`, `LOADING {pending}` (teselas en descarga; 0 = estable), `TRAJECTORY_PROGRESS {progress,lat,lon,altKm}` (≤10/s, para HUD).

### Import directo
```ts
import { LunarGlobe } from 'lunar-globe-renderer/src'
const globe = new LunarGlobe(el); globe.setSites(sites); globe.on('siteClick', s => ...)
```
Requiere servir `public/cesium` y definir `CESIUM_BASE_URL` (ver `vite.config.ts`).

## Relieve y polo (fase 1 completa)
- **Relieve global real:** `src/terrain.ts` usa las teselas DEM de LOLA de Moon Trek como terreno de Cesium. Son PNG de 8 bits; la conversión a metros se **calibró contra el DEM real del backend** (`GET /terrain/patch`, 24 puntos de toda la Luna, 2026-11-14): `elevación ≈ 76.8·DN − 9049 m`, R² = 0.997, RMSE ≈ 127 m. Resolución ~666 m/px (nivel 5); a más zoom se interpola. Pines, PSR, rejilla, trayectoria y la cámara de superficie siguen el terreno.
- **Sin sombreado por relieve:** el terreno de Cesium sin normales no recibe sombras de la luz solar; el relieve se percibe por la geometría, el horizonte y la iluminación horneada de la imagen.
- **Polo (`polarFix`, por defecto activo):** `src/polar.ts` reproyecta el mosaico polar sur (`LRO_WAC_Mosaic_SPole60_100m_v02`, estereográfico) bajo -83° con mezcla hasta -85°, y recorta la capa LOLA bajo -85°. **Reduce el abanico alrededor del polo a la mitad, no lo elimina** (es un hueco de datos del mosaico), y el mosaico polar tiene otra iluminación que el global, por lo que se notan costuras tenues.
- Depuración: `?terrain=0` y `?polarfix=0` en la URL de la demo.

## Cielo (fase 2)
- **Estrellas:** cielo Tycho2 de Cesium (no se crea solo con elipsoide lunar; se configura en `src/sky.ts`).
- **Tierra:** esfera a tamaño angular real (≈1.9°, 3.5× el Sol) a la distancia media de 384 400 km, con textura Natural Earth local y fase según el Sol. **Sin datos del host se dibuja en la posición media (lon 0°, lat 0°); la libración (±7°) y la rotación/orientación de la Tierra no se modelan.**
- **Sol:** disco de 0.53° con halo. **Solo se dibuja si el host envía su dirección**; sin ella no hay Sol ni sombreado de la Luna (no se inventa una posición).
- El globo **no calcula efemérides**: toda dirección viene de la API (D-002, D-006).
- Distancias escaladas: el Sol real (1.5e11 m) queda fuera del plano lejano de Cesium; se coloca a 9e8 m con tamaño angular correcto.

## Capas
`wac` (base, nivel 8) y `lolaShade` (elevación en color, nivel 5, opacidad configurable). Atribución NASA incluida vía créditos de Cesium ("Data attribution").

## Limitaciones conocidas
- **Polo:** ver arriba; mejora parcial. Queda un abanico residual de ~10 km alrededor del polo.
- **Horizonte sin terreno:** vista desde superficie con horizonte esférico; el horizonte real (`horizon_profile`) vive en la consola.
- **Suelo borroso a ras de superficie:** la imagen tiene ~100 m/px.
- **Relieve de ~666 m/px y pasos de ~77 m:** suficiente para el contexto global y las vistas oblicuas, no para el detalle del sitio. Para el polo sur el backend tiene LOLA a 80 m/px (`LDEM_80S_80MPP_ADJ`); servirlo como teselas de terreno mejoraría mucho el resultado (pregunta `P-008` del handoff). El detalle local lo da el visor de la consola (`/terrain/patch`).
- **Polo:** en proyección geográfica la imagen converge en abanico justo en ±90°. Si molesta, usar teselas polares estereográficas de Moon Trek.
- Resolución máxima ~100 m/px (WAC). LROC NAC (0.5 m/px) es v2 según `docs/08` del handoff.
- Los sitios de la demo son mock.
- El respaldo del renderer anterior (Three.js) está en `../lunar-globe-renderer-three-legacy.tgz`.
