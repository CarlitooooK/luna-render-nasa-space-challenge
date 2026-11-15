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

Teselas de Moon Trek: `VITE_TREK_BASE_URL` cambia la raíz `https://trek.nasa.gov/tiles` por un proxy con caché que replique sus rutas (`<base>/Moon/EQ/...`, `<base>/Moon/SP/...`); puede ser relativa al origen del globo, por ejemplo `/trek`. Sin valor, se usa el servidor de NASA.

Host → globo:
- `SET_SITES` (`LandingSite[]`, mismos campos que `/sites`; `status` GO/CAUTION/NO-GO colorea el pin), `SELECT_SITE {id?,lat,lon}` (si cambia de sitio, la cámara se aleja, gira la Luna y baja al nuevo: ver "Cámara y gestos"), `RESET`, `RECENTER` (vista de la Luna completa a 9 000 km sobre el sitio elegido, sin quitar la selección; la Luna gira sola hasta la siguiente vista. Cierra la escena y el horizonte).
- `SET_SUN_LOCAL {lat,lon,vector}` y `SET_EARTH_LOCAL {lat,lon,vector}`: aceptan `sun_vector_3d` / `earth_vector_3d` tal cual (convención D-008). Dibujan el Sol y la Tierra y encienden la iluminación solar.
- `SET_PSR` (`psrs` de `GET /psr/nearby`, tal cual): polígonos sobre la superficie. La conversión polar→lat/lon usa el CRS de LOLA (D-012 del handoff).
- `SET_TRAJECTORY`, `PLAY_ANIMATION`, `FOLLOW_TRAJECTORY {enabled}` (cámara que sigue al módulo).
- **Vista global y pines:** `SET_SKY_GLOBAL {sun:{direction}, earth:{direction, distanceKm?}}` (`GET /ephemeris` tal cual: Sol y Tierra desde el centro de la Luna, y la Tierra a su distancia real si viene), `SET_COMPARE_PINS [{id,label,lat,lon,status?,best?}]` (pines A–E; los escenarios del mismo lugar se agrupan en uno con varias letras; `best` resalta), `SET_CUSTOM_PIN {lat,lon,label?} | null`, `SET_CONFIG {terrainTilesUrl}` (URL base de las teselas, `<api>/terrain/tiles`: relieve LOLA real de `GET /terrain/tiles` y polo sur como relieve sombreado), `SET_PAUSED {paused}` (detiene el dibujado mientras otra escena tapa el globo).
- **Vista de horizonte** (ver abajo): `SET_HORIZON {lat,lon,profile}` (el `horizon_profile` de `POST /evaluate`), `SET_SKY_STATE {sun,earth}` (azimut, elevación, `horizonEl` y `visible` del paso del scrubber), `SET_HORIZON_DETAIL {detailed}`, `SHOW_HORIZON {lat,lon,headingDeg?}`, `EXIT_HORIZON`.
- `SET_DATA_MODE {sample}`: con `true` rotula el visor "Sample data" (el mock: la luz y el horizonte no son reales).
- `PLAY_LANDING_SCENE {lat,lon,headingDeg?,startAltM?,durationS?,distanceM?,astronaut?}` y `STOP_LANDING_SCENE`: la escena de alunizaje (ver abajo).
- `SET_VEHICLES {lander?: boolean, astronaut?: {lat,lon,headingDeg?} | null}` y `VIEW_VEHICLE {which: 'lander'|'astronaut', rangeM?}` (fase 3, ver abajo).
- `LOOK_AT {body: 'sun'|'earth'}`, `VIEW_FROM_SURFACE {lat,lon,look?}` (cámara a 2 m del suelo real) y `SET_VIEW {lat,lon,altM,headingDeg?,pitchDeg?}`.
- `SET_CONFIG` (rejilla `showGrid`, capas `layers: {lolaShade}`, `terrain`, `terrainExaggeration`, `showStars`, `showSun`, `showEarth`, `autoRotate`…). La consola usa `showGrid` y `layers.lolaShade` para sus píldoras "Grid" y "Elevation".

Globo → host: `HORIZON_PHASE {phase: 'arrival'|'ready'|'leaving'}`, `SCENE_ERROR {reason}`, `SCENE_PHASE {phase: 'arrival'|'descent'|'landed'|'done'}`, `SCENE_TELEMETRY {t,altM,vMps}` (ilustrativa), `READY`, `SITE_CLICKED`, `GLOBE_CLICKED`, `ANIMATION_COMPLETE`, `LOADING {pending}` (teselas en descarga; 0 = estable), `TRAJECTORY_PROGRESS {progress,lat,lon,altKm}` (≤10/s, para HUD).

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

## Vista de horizonte (Lander POV)
Pensada en `docs/ideas/lunar-landing-ui-ux-tdd.md` ("Lander POV", cámara a 2 m del suelo) y `docs/05-flujos.md` §5.2 ("la trayectoria aparente del Sol y la Tierra respecto a la silueta del relieve lunar"). `SHOW_HORIZON` baja la cámara de la esfera al suelo del sitio con un vuelo continuo de ~6 s; `EXIT_HORIZON` vuelve a la esfera, a 2 500 km sobre el sitio.
- **Silueta:** un muro a 30 km con la altura de `horizon_profile` (elevación aparente, la misma del panel Horizon 360° de la consola). El terreno más cercano lo pinta el relieve del globo. Sol y Tierra pasan por detrás y se ocultan con la silueta, sin cálculo propio.
- **Sol y Tierra:** posiciones de `SET_SUN_LOCAL` / `SET_EARTH_LOCAL` (vectores del paso). `SET_SKY_STATE` añade las etiquetas: en Simple, solo el nombre (y "behind the terrain" si está oculto); en Detailed, azimut, elevación y holgura sobre el terreno (`el − horizonEl`). Con 'N, E, S, W' sobre el horizonte.
- **Mirar a la redonda:** arrastrar (o dos dedos en el trackpad) gira la cámara; sin zoom ni desplazamiento. Por defecto mira hacia el Sol. El `look` de Cesium 1.147 gira sobre `camera.up` e ignora `constrainedAxis`, así que cada fotograma se recalcula `up` sobre la vertical del sitio: el horizonte no se inclina.
- **Brillo del suelo y de la silueta:** ILUSTRATIVO, atenuados según la holgura del Sol sobre el terreno (dato real); no usa `power_factor`, que asume un panel que sigue al Sol. Sin Sol queda en penumbra (`NIGHT_FLOOR`, la mitad del brillo diurno), nunca en negro. Entre pasos del timeline cambia con un fundido de 350 ms; al llegar al suelo se aplica de golpe.
- Si se envía otra vista (`SELECT_SITE`, `SET_VIEW`, la escena de alunizaje, `RESET`…), la vista de horizonte se cierra.
- Con datos de muestra (mock) el cielo y el horizonte son sintéticos: el Sol nunca se pone. Rotular con `SET_DATA_MODE`.

## Escena de alunizaje (fase 3)
`PLAY_LANDING_SCENE` encadena todo en una sola secuencia, que arranca desde la vista 3D de la Luna:
1. **Llegada:** la cámara vuela desde la vista actual hasta el suelo, a un punto de espectador a ~120 m del contacto, con horizonte y cielo.
2. **Descenso:** el módulo baja en vertical con su motor mientras la cámara lo sigue girando desde el suelo.
3. **Posado:** apaga el motor y levanta polvo (balístico, casi horizontal).
4. **Astronauta:** aparece junto al módulo y la cámara se acerca a los dos; queda orbitable.

### Parámetros de `PLAY_LANDING_SCENE` (se validan; fuera de rango se recorta)
| Campo | Obligatorio | Rango | Por defecto |
| --- | --- | --- | --- |
| `lat` | sí | −90 … 90 | — |
| `lon` | sí | −180 … 360 (acepta el formato 0–360 de la API) | — |
| `headingDeg` | no | cualquier número (se normaliza a 0–360), azimut hacia el que mira la cámara | Sol a 70° del eje; sin Sol, 0 |
| `startAltM` | no | 20 … 5000 m | 600 |
| `durationS` | no | 3 … 120 s | 14 |
| `distanceM` | no | 30 … 2000 m (cámara al punto de contacto) | 120 |
| `astronaut` | no | `false` lo omite | `true` |

`lat` o `lon` ausentes o inválidos **no arrancan la escena** y el globo responde `SCENE_ERROR {reason}`. Ningún mensaje mal formado detiene el render: los de formato inválido se descartan (vectores que no sean 3 números, coordenadas fuera de rango, etc.).

Si la consola cambia el Sol en plena escena (`SET_SUN_LOCAL`, por ejemplo al mover el scrubber), el disco solar y la luz de los modelos se reorientan; el suelo no se sombrea y la cámara no se mueve.

Cómo usarla bien:
- Antes, enviar `SET_SUN_LOCAL` y `SET_EARTH_LOCAL` con los vectores reales de `POST /evaluate` de ese sitio y momento: el cielo (Sol, Tierra) sale de ahí. Sin Sol no se dibuja.
- La cámara mira con el Sol a ~70° del eje para que el módulo se vea de lado.
- **Es una escena ilustrativa, no una simulación:** el descenso tiene desaceleración constante (de `startAltM`, 600 m por defecto, a 0 en `durationS`, 14 s por defecto); la velocidad que informa `SCENE_TELEMETRY` es de esa curva, no física. Rotularla como tal en la interfaz.
- **Luz de escena:** con el Sol real a pocos grados del horizonte el módulo quedaría negro. Se le da una luz desde el azimut del Sol pero a 30° de elevación. Es un recurso de cámara; el disco solar y la dirección del Sol siguen siendo los reales.
- El suelo usa la imagen real (~100 m/px) más una **textura procedural de regolito** (ilustrativa) que solo aparece a ras de suelo, y el relieve LOLA (~666 m/px). Se oculta la capa de pines durante la escena.
- En la prueba con la API en vivo, la altura de Shackleton Rim fue 866 m en el terreno del globo contra 880 m de `GET /sites`.

## Vehículos (fase 3)
- **Módulo de aterrizaje:** sigue la trayectoria enviada con `SET_TRAJECTORY`, con columna de motor (partículas) mientras desciende y 3 s posado antes de repetir. Se activa con `SET_VEHICLES {lander: true}`. Si no hay trayectoria, no se dibuja.
- **Astronauta:** de pie sobre el terreno en el punto indicado; solo se dibuja a menos de 4 km. `SET_VEHICLES {astronaut: {lat, lon}}`, y `null` lo quita.
- **Cámara:** `VIEW_VEHICLE` sigue al módulo a distancia fija (cinemático) o encuadra al astronauta (orbitable). `FOLLOW_TRAJECTORY` usa una distancia que baja con la altitud.
- **Modelos:** NASA 3D Resources, sin modificar, 1,4 MB en total (`public/models/`, ver `ATTRIBUTION.md`). **El módulo es el Apollo LM, un sustituto genérico; no es el de Artemis.** No se incluye el SLS: NASA solo lo publica como archivos `.7z` de 14 a 70 MB.
- **Velocidad ilustrativa:** el descenso se ralentiza con la altitud (unos 19 m/s al tocar) para que el tramo final se aprecie. **No es física real**: la trayectoria es la que envía el host y el contrato no tiene endpoint de trayectoria.
- **Reloj:** el visor mantiene el reloj de Cesium en marcha porque las partículas lo necesitan.
- Los modelos se descargan solo cuando se activan.

## Cielo (fase 2)
- **Estrellas:** cielo Tycho2 de Cesium (no se crea solo con elipsoide lunar; se configura en `src/sky.ts`).
- **Tierra:** esfera a tamaño angular real (≈1.9°, 3.5× el Sol) a la distancia media de 384 400 km, con textura Natural Earth local y fase según el Sol. **Sin datos del host se dibuja en la posición media (lon 0°, lat 0°); la libración (±7°) y la rotación/orientación de la Tierra no se modelan.**
- **Sol:** disco de 0.53° con halo. **Solo se dibuja si el host envía su dirección**; sin ella no hay Sol ni sombreado de la Luna (no se inventa una posición).
- El globo **no calcula efemérides**: toda dirección viene de la API (D-002, D-006).
- Distancias escaladas: el Sol real (1.5e11 m) queda fuera del plano lejano de Cesium; se coloca a 9e8 m con tamaño angular correcto.
- **Movimiento entre pasos:** la consola manda un paso cada ~100 ms en Play. El Sol y la Tierra se deslizan hacia la dirección nueva (suavizado exponencial de 90 ms) en vez de saltar; un salto de más de 12° o un cambio de observador se aplica de golpe. Es presentación: la dirección final es la del backend. La luz de la escena sigue al Sol dibujado. La Tierra lee posición y orientación de propiedades de callback; con una propiedad nueva por paso, Cesium reconstruía el elipsoide y la Tierra parpadeaba.
- **Occluder con la cámara bajo el radio de referencia:** Cesium descarta lo que la Luna tapa con una esfera de radio `minimumRadius + minimumTerrainHeight`. Mirando al cielo no hay teselas en pantalla y la esfera queda en 1 737 400 m. En sitios más bajos (Apollo 11 −1,9 km, Chang'e 4 −5,9 km) la cámara a ras de suelo queda dentro, y Cesium daba por oculto todo menos las estrellas. Con la cámara dentro de la esfera el globo quita el occluder (`dropOccluderWhenInside` en `LunarGlobe.ts`).

## Cámara y gestos
`src/trackpad.ts` atiende los eventos `wheel` antes que Cesium:
- **Pellizco del trackpad** (macOS lo manda como `wheel` con `ctrlKey`) y Ctrl + rueda: zoom.
- **Dos dedos:** mueven el globo en x e y sin cambiar la altura. En la vista de horizonte miran a la redonda.
- **Rueda del ratón:** zoom, más suave por muesca. El zoom de rueda de Cesium 1.147 normaliza un vector cero si la rueda se usa en el centro del lienzo tras girar el globo, y el render se detenía para siempre. Por eso el zoom de Cesium queda en botón derecho y pellizco táctil (`zoomEventTypes`).
- **Recuperación del render:** si Cesium detiene el bucle de dibujado por un error (y el globo no está en pausa), un vigilante de 1 s vuelve a la vista global y reanuda, hasta 5 veces por sesión. `showRenderLoopErrors` está apagado para que el error no tape el globo.
- **Cambio de sitio (`SELECT_SITE`):** la cámara sube en arco (1,2 × la distancia entre sitios, entre 400 y 6 300 km de altura), gira la Luna y baja al nuevo en 2,5 a 4,5 s. Si ya está más alta, no hay arco.
- **`RECENTER`:** la latitud del encuadre se acota a ±60° para que se vea la Luna entera.

## Capas
`wac` (base, nivel 8) y `lolaShade` (elevación en color, nivel 5, opacidad configurable). Atribución NASA incluida vía créditos de Cesium ("Data attribution").

## Limitaciones conocidas
- **Polo:** ver arriba; mejora parcial. Queda un abanico residual de ~10 km alrededor del polo.
- **Horizonte sin terreno:** vista desde superficie con horizonte esférico; el horizonte real (`horizon_profile`) vive en la consola.
- **Suelo a ras de superficie:** la imagen tiene ~100 m/px; la textura procedural lo disimula pero se ve suave y sin rocas ni cráteres pequeños. La escena es más convincente sobre terreno llano e iluminado (p. ej. IM-2 Mons Mouton).
- **Astronauta estático** (sin animación) y de baja calidad a propósito.
- **Relieve de ~666 m/px y pasos de ~77 m:** suficiente para el contexto global y las vistas oblicuas, no para el detalle del sitio. Para el polo sur el backend tiene LOLA a 80 m/px (`LDEM_80S_80MPP_ADJ`); servirlo como teselas de terreno mejoraría mucho el resultado (pregunta `P-008` del handoff). El detalle local lo da el visor de la consola (`/terrain/patch`).
- **Polo:** en proyección geográfica la imagen converge en abanico justo en ±90°. Si molesta, usar teselas polares estereográficas de Moon Trek.
- Resolución máxima ~100 m/px (WAC). LROC NAC (0.5 m/px) es v2 según `docs/08` del handoff.
- Los sitios de la demo son mock.
- El respaldo del renderer anterior (Three.js) está en `../lunar-globe-renderer-three-legacy.tgz`.
