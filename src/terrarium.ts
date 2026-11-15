// `terrainTilesUrl` (por `SET_CONFIG`, P-010) es la URL base de las teselas: `<api>/terrain/tiles`.
// Teselas de elevación del backend (`GET /api/v1/terrain/tiles/{z}/{row}/{col}.png`, contrato v1.3, §2.9):
// PNG RGB de 256 × 256 muestras en centros de píxel, codificación Terrarium:
//   elevación_m = R·256 + G + B/256 − 32768   (relativa a la esfera de 1 737 400 m, la misma de Ellipsoid.MOON)
// Mismo esquema de teselas que Moon Trek (GeographicTilingScheme, fila 0 al norte), niveles 0 a 9.
export const API_TILE_SIZE = 256
export const API_TILE_MAX_LEVEL = 9

const cache = new Map<string, Promise<Float32Array | null>>()
const CACHE_LIMIT = 192

// Cesium no limita las peticiones de un proveedor que sobrescribe `requestImage`: al acercarse al polo salían
// cientos de teselas a la vez contra un túnel de Cloudflare, algunas fallaban y, como el fallo se guardaba en la
// caché, el hueco (una franja negra) quedaba para siempre. Ahora hay un máximo de peticiones en vuelo,
// reintentos con espera y los fallos no se cachean.
const MAX_IN_FLIGHT = 6
const RETRIES = 3
let inFlight = 0
const waiting: (() => void)[] = []
const slot = async () => {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r))
  inFlight++
}
const release = () => {
  inFlight--
  waiting.shift()?.()
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Descarga con reintentos. 404 y 422 son definitivos (fuera de rango o sin datos): no se reintentan. */
async function download(url: string): Promise<Blob | null> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    await slot()
    try {
      const res = await fetch(url)
      if (res.ok) return await res.blob()
      if (res.status === 404 || res.status === 422) return null
    } catch {
      /* red caída o túnel saturado: se reintenta */
    } finally {
      release()
    }
    await sleep(300 * 2 ** attempt)
  }
  return null
}

/** Una URL base de teselas válida (http o https), sin barra final; `null` si no lo es. */
export function normalizeTilesUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** Decodifica un píxel Terrarium a metros. */
export const terrariumMeters = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768

/** Elevaciones en metros de una tesela del backend (256×256, fila 0 al norte), o null si no hay datos o falla la red. */
export function fetchTerrarium(base: string, z: number, row: number, col: number): Promise<Float32Array | null> {
  const key = `${base}|${z}/${row}/${col}`
  const hit = cache.get(key)
  if (hit) return hit
  const p = (async () => {
    try {
      const blob = await download(`${base}/${z}/${row}/${col}.png`)
      if (!blob) {
        cache.delete(key) // un fallo no se recuerda: la próxima petición vuelve a intentarlo
        return null
      }
      // 'none': sin gestión de color, para leer los bytes exactos del PNG
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' })
      const cv = new OffscreenCanvas(API_TILE_SIZE, API_TILE_SIZE)
      const ctx = cv.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bmp, 0, 0, API_TILE_SIZE, API_TILE_SIZE)
      const px = ctx.getImageData(0, 0, API_TILE_SIZE, API_TILE_SIZE).data
      const out = new Float32Array(API_TILE_SIZE * API_TILE_SIZE)
      for (let i = 0; i < out.length; i++) out[i] = terrariumMeters(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])
      return out
    } catch {
      cache.delete(key)
      return null
    }
  })()
  cache.set(key, p)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  return p
}
