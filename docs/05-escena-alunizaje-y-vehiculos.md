# 05. Escena de alunizaje y vehículos

## Escena de alunizaje (fase 3)
`PLAY_LANDING_SCENE` encadena todo en una sola secuencia, que arranca desde la vista 3D de la Luna:
1. **Llegada:** la cámara vuela desde la vista actual hasta el suelo, a un punto de espectador a ~120 m del contacto, con horizonte y cielo.
2. **Descenso:** el módulo baja en vertical con su motor mientras la cámara lo sigue girando desde el suelo.
3. **Posado:** apaga el motor y levanta polvo (balístico, casi horizontal).
4. **Astronauta:** aparece junto al módulo y la cámara se acerca a los dos; queda orbitable.

## Parámetros de `PLAY_LANDING_SCENE` (se validan; fuera de rango se recorta)
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
