import {
  Credit,
  GeographicTilingScheme,
  Rectangle,
  UrlTemplateImageryProvider,
} from 'cesium'
import { MOON, MOON_RADIUS_M } from './moon'

// La capa global WAC en proyección geográfica se abre en abanico cerca del polo (la fuente es polar y
// se estira al pasar a lat/lon). Moon Trek publica el mosaico polar sur original en proyección
// estereográfica polar (metros, ±1 095 930 m) y Cesium no lo acepta directo. Este proveedor lo
// reproyecta, tesela por tesela, a la malla geográfica de Cesium.
const POLAR_URL =
  'https://trek.nasa.gov/tiles/Moon/SP/LRO_WAC_Mosaic_SPole60_100m_v02/1.0.0/default/default028mm'
const EXTENT_M = 1_095_930 // semilado del cuadrado polar (esquina superior izquierda en -E, +E)
const POLAR_MAX_LEVEL = 5 // nivel 5 = 267 m/px; no hay niveles mayores
const TILE = 256

/** Latitud donde la capa polar empieza a mezclarse con el mosaico global y donde ya es total. */
export const POLAR_FADE_START_DEG = -83
export const POLAR_FADE_END_DEG = -85

const images = new Map<string, Promise<ImageBitmap | null>>()
function polarTile(z: number, row: number, col: number): Promise<ImageBitmap | null> {
  const key = `${z}/${row}/${col}`
  let p = images.get(key)
  if (!p) {
    p = fetch(`${POLAR_URL}/${key}.png`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? createImageBitmap(b, { colorSpaceConversion: 'none' }) : null))
      .catch(() => null)
    images.set(key, p)
    if (images.size > 160) images.delete(images.keys().next().value as string)
  }
  return p
}

export class PolarSouthImageryProvider extends UrlTemplateImageryProvider {
  constructor() {
    super({
      url: POLAR_URL, // no se usa: requestImage está sobrescrito
      tilingScheme: new GeographicTilingScheme({ ellipsoid: MOON }),
      rectangle: Rectangle.fromDegrees(-180, -90, 180, POLAR_FADE_START_DEG),
      maximumLevel: 8,
      tileWidth: TILE,
      tileHeight: TILE,
      credit: new Credit('NASA/GSFC/ASU — LROC WAC polar sur (via NASA Moon Trek)'),
    })
  }

  async requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement | OffscreenCanvas> {
    const out = new OffscreenCanvas(TILE, TILE)
    const rect = this.tilingScheme.tileXYToRectangle(x, y, level)
    const dLat = (rect.north - rect.south) / TILE
    const dLon = (rect.east - rect.west) / TILE

    // Nivel polar: el menor cuyo píxel no sea más grueso que el del lienzo (en metros), con tope 5
    const outMeters = dLat * MOON_RADIUS_M
    let zp = 0
    while (zp < POLAR_MAX_LEVEL && (2 * EXTENT_M) / 2 ** zp / TILE > outMeters) zp++
    const groundTile = (2 * EXTENT_M) / 2 ** zp // metros por tesela polar

    // Caja en metros polares cubierta por esta tesela (muestreo del borde y del interior)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    const toXY = (lat: number, lon: number) => {
      const rho = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + lat / 2)
      return [rho * Math.sin(lon), -rho * Math.cos(lon)] as const
    }
    for (let a = 0; a <= 8; a++) {
      for (let b = 0; b <= 8; b++) {
        const lat = Math.min(rect.south + ((rect.north - rect.south) * a) / 8, (-55 * Math.PI) / 180)
        const [px, py] = toXY(lat, rect.west + ((rect.east - rect.west) * b) / 8)
        minX = Math.min(minX, px); maxX = Math.max(maxX, px)
        minY = Math.min(minY, py); maxY = Math.max(maxY, py)
      }
    }
    // Un polo dentro de la tesela hace que la caja llegue a 0 en ambos ejes
    if (rect.south <= -Math.PI / 2 + 1e-9) { minX = Math.min(minX, 0); maxX = Math.max(maxX, 0); minY = Math.min(minY, 0); maxY = Math.max(maxY, 0) }
    const c0 = Math.max(0, Math.floor((minX + EXTENT_M) / groundTile))
    const c1 = Math.min(2 ** zp - 1, Math.floor((maxX + EXTENT_M) / groundTile))
    const r0 = Math.max(0, Math.floor((EXTENT_M - maxY) / groundTile))
    const r1 = Math.min(2 ** zp - 1, Math.floor((EXTENT_M - minY) / groundTile))
    if (c1 < c0 || r1 < r0 || (c1 - c0 + 1) * (r1 - r0 + 1) > 36) return out

    // Ensambla las teselas polares necesarias en un lienzo fuente
    const cols = c1 - c0 + 1
    const rows = r1 - r0 + 1
    const src = new OffscreenCanvas(cols * TILE, rows * TILE)
    const sctx = src.getContext('2d', { willReadFrequently: true })!
    await Promise.all(
      Array.from({ length: cols * rows }, async (_, k) => {
        const cx = c0 + (k % cols)
        const ry = r0 + Math.floor(k / cols)
        const bmp = await polarTile(zp, ry, cx)
        if (bmp) sctx.drawImage(bmp, (cx - c0) * TILE, (ry - r0) * TILE)
      }),
    )
    const sdata = sctx.getImageData(0, 0, src.width, src.height).data
    const sw = src.width
    const sh = src.height

    const octx = out.getContext('2d')!
    const img = octx.createImageData(TILE, TILE)
    const od = img.data
    const pxPerM = TILE / groundTile
    for (let j = 0; j < TILE; j++) {
      const lat = rect.north - (j + 0.5) * dLat
      const latDeg = (lat * 180) / Math.PI
      // mezcla suave con el mosaico global entre FADE_START y FADE_END
      const w = Math.min(1, Math.max(0, (POLAR_FADE_START_DEG - latDeg) / (POLAR_FADE_START_DEG - POLAR_FADE_END_DEG)))
      if (w <= 0) continue
      for (let i = 0; i < TILE; i++) {
        const lon = rect.west + (i + 0.5) * dLon
        const [mx, my] = toXY(lat, lon)
        const sx = Math.floor((mx + EXTENT_M) * pxPerM - c0 * TILE)
        const sy = Math.floor((EXTENT_M - my) * pxPerM - r0 * TILE)
        if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue
        let s = (sy * sw + sx) * 4
        if (sdata[s + 3] === 0) {
          // las costuras entre teselas polares traen un píxel transparente: se toma el vecino más cercano
          let found = -1
          for (let d = 1; d <= 2 && found < 0; d++) {
            for (const [ox, oy] of [[d, 0], [-d, 0], [0, d], [0, -d]] as const) {
              const nx = sx + ox
              const ny = sy + oy
              if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue
              const n = (ny * sw + nx) * 4
              if (sdata[n + 3] > 0) { found = n; break }
            }
          }
          if (found < 0) continue
          s = found
        }
        const o = (j * TILE + i) * 4
        od[o] = od[o + 1] = od[o + 2] = sdata[s]
        od[o + 3] = sdata[s + 3] * w
      }
    }
    octx.putImageData(img, 0, 0)
    return out
  }
}
