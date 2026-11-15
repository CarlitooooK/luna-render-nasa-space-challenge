# 03. Relieve y polo

## Con las teselas del backend
- Si el host manda `SET_CONFIG {terrainTilesUrl}` (la consola manda `<VITE_API_BASE_URL>/terrain/tiles`, D-019 del handoff), el globo comprueba qué versión sirve la API (`detectTilesVersion` en `src/terrarium.ts`) y cambia de fuente:
  - **Malla v1.5** (`heightmap/{z}/{row}/{col}.bin`, niveles 0 a 12, ~21 m en el polo): va a Cesium tal cual, sin decodificar PNG. Las teselas vecinas comparten el borde.
  - **Terrarium v1.3** (`{z}/{row}/{col}.png`, hasta el nivel 9) si la API no tiene la malla.
  - El polo sur se dibuja como **relieve sombreado** calculado en el navegador (`src/hillshade.ts`, luz fija e ilustrativa) en lugar del mosaico WAC.
- Si la API no responde o no tiene `/terrain/tiles`, el globo sigue con Moon Trek sin romper nada.

## Sin backend (Moon Trek)
- **Relieve global real:** `src/terrain.ts` usa las teselas DEM de LOLA de Moon Trek como terreno de Cesium. Son PNG de 8 bits; la conversión a metros se **calibró contra el DEM real del backend** (`GET /terrain/patch`, 24 puntos de toda la Luna, 2026-11-14): `elevación ≈ 76.8·DN − 9049 m`, R² = 0.997, RMSE ≈ 127 m. Resolución ~666 m/px (nivel 5); a más zoom se interpola. Pines, PSR, rejilla, trayectoria y la cámara de superficie siguen el terreno.
- **Sin sombreado por relieve:** el terreno de Cesium sin normales no recibe sombras de la luz solar; el relieve se percibe por la geometría, el horizonte y la iluminación horneada de la imagen.
- **Polo (`polarFix`, por defecto activo):** `src/polar.ts` reproyecta el mosaico polar sur (`LRO_WAC_Mosaic_SPole60_100m_v02`, estereográfico) bajo -83° con mezcla hasta -85°, y recorta la capa LOLA bajo -85°. **Reduce el abanico alrededor del polo a la mitad, no lo elimina** (es un hueco de datos del mosaico), y el mosaico polar tiene otra iluminación que el global, por lo que se notan costuras tenues.
- Depuración: `?terrain=0` y `?polarfix=0` en la URL de la demo.
