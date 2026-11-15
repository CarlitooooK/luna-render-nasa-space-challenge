import {
  Cartographic,
  Credit,
  CustomHeightmapTerrainProvider,
  GeographicTilingScheme,
  sampleTerrain,
  type TerrainProvider,
} from 'cesium'
import { MOON } from './moon'
import { API_TILE_MAX_LEVEL, fetchTerrarium } from './terrarium'

// Relieve global desde las teselas DEM de NASA Moon Trek (LOLA, 128 ppd, referido a la esfera de
// 1 737 400 m, la misma de Ellipsoid.MOON). Las teselas son PNG de 8 bits: el valor (DN) es una
// versión estirada de la elevación. La conversión a metros se CALIBRÓ contra el DEM real del backend
// (`GET /terrain/patch`, LOLA) en 24 puntos de toda la Luna, 2026-11-14:
//   elevación_m ≈ 76.8 · DN − 9049    R² = 0.997, RMSE ≈ 127 m
// Resolución: nivel 5 = ~666 m/px; con 8 bits la elevación avanza en pasos de ~77 m.
// Si el backend publica teselas de terreno propias (P-008), basta cambiar `fetchDemTile`.
const DEM_URL =
  'https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_DEM_Global_128ppd_v04/1.0.0/default/default028mm'
const DEM_MAX_LEVEL = 5
const DN_TO_M = 76.8
const DN_OFFSET_M = -9049
const TILE = 256
const GRID = 65 // vértices por lado de cada tesela de terreno

const cache = new Map<string, Promise<Float32Array | null>>()
const CACHE_LIMIT = 96

/** Tesela DEM (nivel ≤5) como 256×256 elevaciones en metros, suavizada para reducir los escalones de 77 m. */
function fetchDemTile(level: number, row: number, col: number): Promise<Float32Array | null> {
  const key = `${level}/${row}/${col}`
  const hit = cache.get(key)
  if (hit) return hit
  const p = (async () => {
    try {
      const res = await fetch(`${DEM_URL}/${key}.png`)
      if (!res.ok) return null
      // 'none': sin conversión de color, para leer el DN exacto del PNG en gris
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' })
      const cv = new OffscreenCanvas(TILE, TILE)
      const ctx = cv.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bmp, 0, 0, TILE, TILE)
      const px = ctx.getImageData(0, 0, TILE, TILE).data
      let a = new Float32Array(TILE * TILE)
      for (let i = 0; i < a.length; i++) a[i] = px[i * 4] * DN_TO_M + DN_OFFSET_M
      // 2 pasadas de promedio 3×3 (bordes sujetos a la tesela)
      for (let pass = 0; pass < 2; pass++) {
        const b = new Float32Array(a.length)
        for (let y = 0; y < TILE; y++) {
          for (let x = 0; x < TILE; x++) {
            let s = 0
            for (let dy = -1; dy <= 1; dy++) {
              const yy = Math.min(TILE - 1, Math.max(0, y + dy))
              for (let dx = -1; dx <= 1; dx++) s += a[yy * TILE + Math.min(TILE - 1, Math.max(0, x + dx))]
            }
            b[y * TILE + x] = s / 9
          }
        }
        a = b
      }
      return a
    } catch {
      return null
    }
  })()
  cache.set(key, p)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  return p
}

/** Interpola bilinealmente una tesela DEM en coordenadas continuas de píxel (centros en +0.5). */
function sample(t: Float32Array, px: number, py: number): number {
  const x = Math.min(TILE - 1, Math.max(0, px - 0.5))
  const y = Math.min(TILE - 1, Math.max(0, py - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(TILE - 1, x0 + 1)
  const y1 = Math.min(TILE - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const top = t[y0 * TILE + x0] * (1 - fx) + t[y0 * TILE + x1] * fx
  const bot = t[y1 * TILE + x0] * (1 - fx) + t[y1 * TILE + x1] * fx
  return top * (1 - fy) + bot * fy
}

/** Terreno global de la Luna. Niveles >5 se interpolan desde el nivel 5 (no hay más detalle gratuito). */
export function createMoonTerrain(apiBase?: string): TerrainProvider {
  // Con la URL del backend, el relieve sale de sus teselas Terrarium (LOLA, 40 m/px en el polo, niveles 0 a 9) en
  // metros reales: sin la calibración de 8 bits ni el suavizado. Sin ella, queda el DEM de Moon Trek.
  const fetchTile = apiBase ? (lv: number, row: number, col: number) => fetchTerrarium(apiBase, lv, row, col) : fetchDemTile
  const maxLevel = apiBase ? API_TILE_MAX_LEVEL : DEM_MAX_LEVEL
  return new CustomHeightmapTerrainProvider({
    width: GRID,
    height: GRID,
    tilingScheme: new GeographicTilingScheme({ ellipsoid: MOON }),
    credit: new Credit(apiBase ? 'NASA/GSFC/MIT — LRO LOLA DEM (via Lunar Navigator API)' : 'NASA/GSFC/MIT — LRO LOLA DEM (via NASA Moon Trek)'),
    callback: async (x: number, y: number, level: number) => {
      const lv = Math.min(level, maxLevel)
      const shift = level - lv
      const dem = await fetchTile(lv, y >> shift, x >> shift)
      const out = new Float32Array(GRID * GRID)
      if (!dem) return out // sin red: terreno plano en esa tesela
      const span = 2 ** shift
      for (let j = 0; j < GRID; j++) {
        // posición dentro de la tesela DEM ancestro, 0..1 (fila 0 = norte)
        const v = (y + j / (GRID - 1)) / span - (y >> shift)
        for (let i = 0; i < GRID; i++) {
          const u = (x + i / (GRID - 1)) / span - (x >> shift)
          out[j * GRID + i] = sample(dem, u * TILE, v * TILE)
        }
      }
      return out
    },
  })
}

/** La API usa longitud este de 0° a 360°; Cesium solo entiende −180°…180° al muestrear terreno. */
const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180

/** Altura del terreno (m sobre la esfera lunar) en un punto, o 0 si no se puede leer. */
export async function groundHeight(provider: TerrainProvider, lat: number, lon: number): Promise<number> {
  const c = Cartographic.fromDegrees(wrapLon(lon), lat)
  try {
    const [r] = await sampleTerrain(provider, 8, [c])
    return r.height ?? 0
  } catch {
    return 0
  }
}

/** Alturas de varios puntos a la vez. */
export async function groundHeights(provider: TerrainProvider, pts: { lat: number; lon: number }[]): Promise<number[]> {
  const cs = pts.map((p) => Cartographic.fromDegrees(wrapLon(p.lon), p.lat))
  try {
    const r = await sampleTerrain(provider, 8, cs)
    return r.map((c) => c.height ?? 0)
  } catch {
    return pts.map(() => 0)
  }
}
