# 06. Cielo, cámara y capas

## Cielo (fase 2)
- **Estrellas:** cielo Tycho2 de Cesium (no se crea solo con elipsoide lunar; se configura en `src/sky.ts`).
- **Tierra:** esfera a tamaño angular real (≈1.9°, 3.5× el Sol) a la distancia media de 384 400 km, con textura Natural Earth local y fase según el Sol. **Sin datos del host se dibuja en la posición media (lon 0°, lat 0°); la libración (±7°) y la rotación/orientación de la Tierra no se modelan.**
- **Sol:** disco de 0.53° con halo. **Solo se dibuja si el host envía su dirección**; sin ella no hay Sol ni sombreado de la Luna (no se inventa una posición).
- El globo **no calcula efemérides**: toda dirección viene de la API (D-002, D-006).
- Distancias escaladas: el Sol real (1.5e11 m) queda fuera del plano lejano de Cesium; se coloca a 9e8 m con tamaño angular correcto.
- **Movimiento entre pasos:** la consola manda un paso cada ~100 ms en Play. El Sol y la Tierra se deslizan hacia la dirección nueva (suavizado exponencial de 90 ms) en vez de saltar; un salto de más de 12° o un cambio de observador se aplica de golpe. Es presentación: la dirección final es la del backend. La luz de la escena sigue al Sol dibujado. La Tierra es una primitiva que se crea una vez y solo mueve su `modelMatrix` en cada fotograma; no se reconstruye ni parpadea.
- **Tierra blanca (corregido):** con la Tierra como entidad de Cesium y posición de callback, Cesium 1.147 crea un material nuevo en cada fotograma (`DynamicEllipsoidGeometryUpdater` no guarda el que crea) y la textura, que se sube a la GPU al fotograma siguiente, nunca llegaba: se veía una esfera blanca y lisa en cualquier GPU, no solo en SwiftShader. Además, el sombreado estándar de `MaterialAppearance` (`czm_phong`) ignora la dirección de la luz, así que nunca hubo fase. Ahora la Tierra usa su propio material: textura con Lambert según la luz de la escena y un 3 % en el lado nocturno.
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
