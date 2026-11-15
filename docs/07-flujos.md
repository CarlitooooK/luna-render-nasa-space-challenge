# 07. Flujos

Los flujos principales del globo en diagramas. GitHub dibuja los bloques `mermaid` directamente. Los mensajes y sus campos están en [`02`](02-protocolo-postmessage.md); si un diagrama choca con ese doc, manda él.

## Arranque dentro de la consola

```mermaid
sequenceDiagram
  autonumber
  participant C as Consola (host)
  participant G as Globo (iframe)
  participant A as API
  participant T as NASA Moon Trek
  C->>G: carga el iframe con ?allowedOrigins (el origen de la consola)
  G->>T: imagen WAC y relieve LOLA (WMTS)
  G-->>C: READY (una vez por carga)
  C->>G: SET_CONFIG {terrainTilesUrl, showGrid, layers}
  G->>A: comprueba /terrain/tiles y su versión
  alt la API sirve teselas
    G->>A: malla v1.5 (heightmap) o Terrarium v1.3
    G->>G: relieve LOLA del backend y polo sombreado
  else la API no responde
    G->>G: sigue con Moon Trek
  end
  C->>G: SET_SITES, SET_PSR, SET_SUN_LOCAL + SET_EARTH_LOCAL
```

Los mensajes de un origen que no está en `allowedOrigins` se ignoran, y el globo nunca responde a `'*'`.

## Elegir un sitio

```mermaid
sequenceDiagram
  autonumber
  participant C as Consola
  participant G as Globo
  opt el usuario hace clic en el globo
    G-->>C: SITE_CLICKED o GLOBE_CLICKED (solo selecciona)
  end
  C->>G: SELECT_SITE {id?, lat, lon}
  G->>G: sube en arco, gira la Luna y baja al sitio (2,5 a 4,5 s)
```

## Vista de horizonte

```mermaid
stateDiagram-v2
  [*] --> Esfera
  Esfera --> Llegada: SHOW_HORIZON
  Llegada --> Lista: vuelo de ~6 s
  Lista --> Lista: SET_SKY_STATE + Sol y Tierra
  Lista --> Regreso: EXIT_HORIZON
  Lista --> Esfera: SELECT_SITE, SET_VIEW o escena de alunizaje
  Regreso --> Esfera: a 2 500 km sobre el sitio
```

El globo avisa cada cambio con `HORIZON_PHASE` (`arrival`, `ready`, `leaving`).

## Escena de alunizaje

```mermaid
stateDiagram-v2
  [*] --> arrival: PLAY_LANDING_SCENE
  [*] --> error: lat o lon inválidos
  error --> [*]: SCENE_ERROR, la escena no arranca
  arrival --> descent: la cámara llega al suelo (~120 m del contacto)
  descent --> landed: motor apagado, polvo
  landed --> done: astronauta junto al módulo
  done --> [*]: STOP_LANDING_SCENE
```

`STOP_LANDING_SCENE` la cierra en cualquier fase. Cada fase llega a la consola como `SCENE_PHASE`, y durante el descenso `SCENE_TELEMETRY` cada 100 ms. La curva del descenso es ilustrativa, no física.
