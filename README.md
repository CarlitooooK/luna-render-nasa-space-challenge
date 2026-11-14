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

Host → globo: `SET_SITES` (`LandingSite[]`, mismos campos que `/sites`; `status` GO/CAUTION/NO-GO colorea el pin), `SELECT_SITE {id?,lat,lon}`, `SET_TRAJECTORY`, `SET_CONFIG`, `SET_SUN_LOCAL {lat,lon,vector}` (acepta `sun_vector_3d` tal cual, convención D-008), `PLAY_ANIMATION`, `RESET`.
Globo → host: `READY`, `SITE_CLICKED`, `GLOBE_CLICKED`, `ANIMATION_COMPLETE`.

### Import directo
```ts
import { LunarGlobe } from 'lunar-globe-renderer/src'
const globe = new LunarGlobe(el); globe.setSites(sites); globe.on('siteClick', s => ...)
```
Requiere servir `public/cesium` y definir `CESIUM_BASE_URL` (ver `vite.config.ts`).

## Capas
`wac` (base, nivel 8) y `lolaShade` (elevación en color, nivel 5, opacidad configurable). Atribución NASA incluida vía créditos de Cesium ("Data attribution").

## Limitaciones conocidas
- **Sin relieve geométrico:** la esfera es lisa; el relieve se percibe por la imagen y la capa LOLA. Para 3D real hace falta generar terreno quantized-mesh desde el DEM LOLA del polo sur. El detalle topográfico del sitio lo da el visor de la consola (`/terrain/patch`).
- **Polo:** en proyección geográfica la imagen converge en abanico justo en ±90°. Si molesta, usar teselas polares estereográficas de Moon Trek.
- Resolución máxima ~100 m/px (WAC). LROC NAC (0.5 m/px) es v2 según `docs/08` del handoff.
- Los sitios de la demo son mock.
- El respaldo del renderer anterior (Three.js) está en `../lunar-globe-renderer-three-legacy.tgz`.
