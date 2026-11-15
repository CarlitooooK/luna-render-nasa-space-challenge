import { Credit, GeographicTilingScheme, Rectangle, UrlTemplateImageryProvider } from 'cesium'
import { MOON, MOON_RADIUS_M } from './moon'
import { POLAR_FADE_END_DEG, POLAR_FADE_START_DEG } from './polar'
import { API_TILE_MAX_LEVEL, API_TILE_SIZE, fetchTerrarium } from './terrarium'

// Relieve sombreado del polo sur a partir del DEM del backend (LOLA, 40 m/px en el polo). Reemplaza al mosaico
// polar WAC de Moon Trek, cuyo máximo es 267 m/px (nivel 5): de cerca se ve en bloques y con el abanico de
// bandas radiales de las órbitas. La luz es FIJA en el marco lunar (no es el Sol de la simulación): un sombreado
// de relieve con luz rasante, como en los mapas polares. Se rotula como ilustrativo.
const EXAGGERATION = 1.6
const LIGHT_AZIMUTH = (135 * Math.PI) / 180 // dirección horizontal hacia la luz en el marco fijo (X→lon 0°, Y→90° E)
const LIGHT_ELEVATION = (22 * Math.PI) / 180 // sobre el horizonte local del polo (arriba ≈ −Z)
const LIGHT = [Math.cos(LIGHT_AZIMUTH) * Math.cos(LIGHT_ELEVATION), Math.sin(LIGHT_AZIMUTH) * Math.cos(LIGHT_ELEVATION), -Math.sin(LIGHT_ELEVATION)] as const
const S = API_TILE_SIZE

export class HillshadeImageryProvider extends UrlTemplateImageryProvider {
  constructor(private base: string) {
    super({
      url: base, // no se usa: requestImage está sobrescrito
      tilingScheme: new GeographicTilingScheme({ ellipsoid: MOON }),
      rectangle: Rectangle.fromDegrees(-180, -90, 180, POLAR_FADE_START_DEG),
      maximumLevel: API_TILE_MAX_LEVEL,
      tileWidth: S,
      tileHeight: S,
      credit: new Credit('Relief shading (illustrative lighting) from LRO LOLA DEM via Lunar Navigator API'),
    })
  }

  async requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement | OffscreenCanvas> {
    const out = new OffscreenCanvas(S, S)
    const rect = this.tilingScheme.tileXYToRectangle(x, y, level)
    const h = await fetchTerrarium(this.base, level, y, x)
    if (!h) return out
    const dPhi = (rect.north - rect.south) / S
    const dLam = (rect.east - rect.west) / S
    const dy = MOON_RADIUS_M * dPhi
    const img = new ImageData(S, S)
    const px = img.data
    const at = (r: number, c: number) => h[Math.min(S - 1, Math.max(0, r)) * S + Math.min(S - 1, Math.max(0, c))] * EXAGGERATION
    for (let j = 0; j < S; j++) {
      const phi = rect.north - (j + 0.5) * dPhi
      const latDeg = (phi * 180) / Math.PI
      // mezcla con el mosaico global entre FADE_START y FADE_END (igual que la capa polar WAC)
      const w = Math.min(1, Math.max(0, (POLAR_FADE_START_DEG - latDeg) / (POLAR_FADE_START_DEG - POLAR_FADE_END_DEG)))
      if (w <= 0) continue
      const sp = Math.sin(phi)
      const cp = Math.cos(phi)
      const dx = Math.max(MOON_RADIUS_M * cp * dLam, 1e-3) // metros por muestra hacia el Este
      for (let i = 0; i < S; i++) {
        const lam = rect.west + (i + 0.5) * dLam
        const sl = Math.sin(lam)
        const cl = Math.cos(lam)
        // luz fija expresada en el Este/Norte/Arriba de este píxel
        const sE = -sl * LIGHT[0] + cl * LIGHT[1]
        const sN = -sp * cl * LIGHT[0] - sp * sl * LIGHT[1] + cp * LIGHT[2]
        const sU = cp * cl * LIGHT[0] + cp * sl * LIGHT[1] + sp * LIGHT[2]
        const dE = (at(j, i + 1) - at(j, i - 1)) / (2 * dx)
        const dN = (at(j - 1, i) - at(j + 1, i)) / (2 * dy)
        const inv = 1 / Math.hypot(dE, dN, 1)
        const shade = Math.max(0, (-dE * sE - dN * sN + sU) * inv)
        const v = Math.round(255 * Math.min(1, 0.07 + 0.93 * shade ** 0.9))
        const o = (j * S + i) * 4
        px[o] = px[o + 1] = px[o + 2] = v
        px[o + 3] = Math.round(255 * w)
      }
    }
    out.getContext('2d')!.putImageData(img, 0, 0)
    return out
  }
}
