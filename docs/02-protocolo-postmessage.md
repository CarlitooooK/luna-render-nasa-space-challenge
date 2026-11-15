# 02. Protocolo postMessage

Fuente única del protocolo entre el globo y quien lo incrusta (la consola). Los tipos están en `src/types.ts` y la validación de cada mensaje en `src/embed.ts`.

## iframe (recomendado para la consola)
```html
<iframe src="https://HOST_DEL_GLOBO/?allowedOrigins=https://HOST_DE_LA_CONSOLA"></iframe>
```
Orígenes permitidos: `VITE_ALLOWED_ORIGINS` (lista separada por comas) o `?allowedOrigins=`. Por defecto `http://localhost:5173`. Los mensajes de otros orígenes se ignoran y nunca se responde a `'*'`.

Teselas de Moon Trek: `VITE_TREK_BASE_URL` cambia la raíz `https://trek.nasa.gov/tiles` por un proxy con caché que replique sus rutas (`<base>/Moon/EQ/...`, `<base>/Moon/SP/...`); puede ser relativa al origen del globo, por ejemplo `/trek`. Sin valor, se usa el servidor de NASA.

Host → globo:
- `SET_SITES` (`LandingSite[]`, mismos campos que `/sites`; `status` GO/CAUTION/NO-GO colorea el pin), `SELECT_SITE {id?,lat,lon}` (si cambia de sitio, la cámara se aleja, gira la Luna y baja al nuevo: ver [Cámara y gestos](06-cielo-y-camara.md#cámara-y-gestos)), `RESET`, `RECENTER` (vista de la Luna completa a 9 000 km sobre el sitio elegido, sin quitar la selección; la Luna gira sola hasta la siguiente vista. Cierra la escena y el horizonte).
- `SET_SUN_LOCAL {lat,lon,vector}` y `SET_EARTH_LOCAL {lat,lon,vector}`: aceptan `sun_vector_3d` / `earth_vector_3d` tal cual (convención D-008). Dibujan el Sol y la Tierra y encienden la iluminación solar.
- `SET_PSR` (`psrs` de `GET /psr/nearby`, tal cual): polígonos sobre la superficie. La conversión polar→lat/lon usa el CRS de LOLA (D-012 del handoff).
- `SET_TRAJECTORY`, `PLAY_ANIMATION`, `FOLLOW_TRAJECTORY {enabled}` (cámara que sigue al módulo).
- **Vista global y pines:** `SET_SKY_GLOBAL {sun:{direction}, earth:{direction, distanceKm?}}` (`GET /ephemeris` tal cual: Sol y Tierra desde el centro de la Luna, y la Tierra a su distancia real si viene), `SET_COMPARE_PINS [{id,label,lat,lon,status?,best?}]` (pines A–E; los escenarios del mismo lugar se agrupan en uno con varias letras; `best` resalta), `SET_CUSTOM_PIN {lat,lon,label?} | null`, `SET_CONFIG {terrainTilesUrl}` (URL base de las teselas, `<api>/terrain/tiles`: relieve LOLA real de `GET /terrain/tiles` y polo sur como relieve sombreado), `SET_PAUSED {paused}` (detiene el dibujado mientras otra escena tapa el globo).
- **Vista de horizonte** ([`04`](04-vista-horizonte.md)): `SET_HORIZON {lat,lon,profile}` (el `horizon_profile` de `POST /evaluate`), `SET_SKY_STATE {sun,earth}` (azimut, elevación, `horizonEl` y `visible` del paso del scrubber), `SET_HORIZON_DETAIL {detailed}`, `SHOW_HORIZON {lat,lon,headingDeg?}`, `EXIT_HORIZON`.
- `SET_DATA_MODE {sample}`: con `true` rotula el visor "Sample data" (el mock: la luz y el horizonte no son reales).
- `PLAY_LANDING_SCENE {lat,lon,headingDeg?,startAltM?,durationS?,distanceM?,astronaut?}` y `STOP_LANDING_SCENE`: la escena de alunizaje, con sus parámetros en [`05`](05-escena-alunizaje-y-vehiculos.md).
- `SET_VEHICLES {lander?: boolean, astronaut?: {lat,lon,headingDeg?} | null}` y `VIEW_VEHICLE {which: 'lander'|'astronaut', rangeM?}` (fase 3, ver [`05`](05-escena-alunizaje-y-vehiculos.md#vehículos-fase-3)).
- `LOOK_AT {body: 'sun'|'earth'}`, `VIEW_FROM_SURFACE {lat,lon,look?}` (cámara a 2 m del suelo real) y `SET_VIEW {lat,lon,altM,headingDeg?,pitchDeg?}`.
- `SET_CONFIG` (rejilla `showGrid`, capas `layers: {lolaShade}`, `terrain`, `terrainExaggeration`, `showStars`, `showSun`, `showEarth`, `autoRotate`…). La consola usa `showGrid` y `layers.lolaShade` para sus píldoras "Grid" y "Elevation".

Globo → host: `HORIZON_PHASE {phase: 'arrival'|'ready'|'leaving'}`, `SCENE_ERROR {reason}`, `SCENE_PHASE {phase: 'arrival'|'descent'|'landed'|'done'}`, `SCENE_TELEMETRY {t,altM,vMps}` (ilustrativa), `READY`, `SITE_CLICKED`, `GLOBE_CLICKED`, `ANIMATION_COMPLETE`, `LOADING {pending}` (teselas en descarga; 0 = estable), `TRAJECTORY_PROGRESS {progress,lat,lon,altKm}` (≤10/s, para HUD).
