import { Credit, GeographicTilingScheme, UrlTemplateImageryProvider } from 'cesium'
import { MOON, MOON_RADIUS_M } from './moon'

// La imagen real tiene ~100 m/px: a ras de suelo se ve borrosa. Este proveedor superpone ruido fractal
// sutil que da sensación de regolito. Es ILUSTRATIVO: no representa rocas ni cráteres reales.
// IMPORTANTE: no usar `minimumLevel` aquí. En una capa global obliga a Cesium a cubrir las teselas de
// niveles bajos con cientos de millones de teselas de ese nivel y bloquea el visor. La capa se limita
// con `minimumTerrainLevel` al crearla (ver REGOLITH_MIN_TERRAIN_LEVEL).
export const REGOLITH_MIN_TERRAIN_LEVEL = 13
const MAX_LEVEL = 22
const SIZE = 128 // píxeles por tesela (Cesium la estira)
const STRENGTH = 0.38

function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return ((h >>> 0) % 100000) / 100000
}

/** Ruido de valor 3D en [0,1], isotrópico y continuo entre teselas (se evalúa en la esfera). */
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const fx = x - xi, fy = y - yi, fz = z - zi
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz)
  let v = 0
  for (let dx = 0; dx <= 1; dx++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dz = 0; dz <= 1; dz++)
        v += hash3(xi + dx, yi + dy, zi + dz) * (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz)
  return v
}

export class RegolithImageryProvider extends UrlTemplateImageryProvider {
  constructor() {
    super({
      url: 'about:blank', // no se usa: requestImage está sobrescrito
      tilingScheme: new GeographicTilingScheme({ ellipsoid: MOON }),
      maximumLevel: MAX_LEVEL,
      tileWidth: SIZE,
      tileHeight: SIZE,
      credit: new Credit('Textura de regolito procedural (ilustrativa)', true),
    })
  }

  async requestImage(x: number, y: number, level: number): Promise<OffscreenCanvas> {
    const out = new OffscreenCanvas(SIZE, SIZE)
    const rect = this.tilingScheme.tileXYToRectangle(x, y, level)
    const img = new ImageData(SIZE, SIZE)
    const d = img.data
    for (let j = 0; j < SIZE; j++) {
      const lat = rect.north - ((j + 0.5) / SIZE) * (rect.north - rect.south)
      const cl = Math.cos(lat), sl = Math.sin(lat)
      for (let i = 0; i < SIZE; i++) {
        const lon = rect.west + ((i + 0.5) / SIZE) * (rect.east - rect.west)
        const px = cl * Math.cos(lon) * MOON_RADIUS_M
        const py = cl * Math.sin(lon) * MOON_RADIUS_M
        const pz = sl * MOON_RADIUS_M
        // 3 octavas: ~20 m, ~5 m y ~1.2 m
        const n = noise3(px / 20, py / 20, pz / 20) * 0.5 + noise3(px / 5, py / 5, pz / 5) * 0.32 + noise3(px / 1.2, py / 1.2, pz / 1.2) * 0.18
        const v = (n - 0.5) * 2 // -1..1
        const o = (j * SIZE + i) * 4
        const c = v > 0 ? 255 : 0 // aclara u oscurece según el signo
        d[o] = d[o + 1] = d[o + 2] = c
        d[o + 3] = Math.min(255, Math.abs(v) * STRENGTH * 255 * 1.6)
      }
    }
    out.getContext('2d')!.putImageData(img, 0, 0)
    return out
  }
}
