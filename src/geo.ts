import { MOON_RADIUS_M } from './moon'

/**
 * Inversa de la proyección estereográfica polar sur sobre esfera lunar, la del CRS de LOLA
 * (`+proj=stere +lat_0=-90 +lon_0=0 +R=1737400`) que usan `polar_x_m`/`polar_y_m` de la API.
 * Fórmulas: ρ = 2R·tan(π/4 + φ/2), x = ρ·sin λ, y = +ρ·cos λ (+X hacia 90° E, +Y hacia 0°).
 * Verificada contra `GET /sites` de la API en vivo (13 sitios, 2026-11-14). Una versión anterior usaba
 * y = −ρ·cos λ por copiar un ejemplo del contrato que tenía Y invertido (corregido en D-012).
 */
export function polarSouthToLatLon(x: number, y: number): { lat: number; lon: number } {
  const rho = Math.hypot(x, y)
  const lat = -90 + (2 * Math.atan(rho / (2 * MOON_RADIUS_M)) * 180) / Math.PI
  const lon = (Math.atan2(x, y) * 180) / Math.PI
  return { lat, lon }
}
