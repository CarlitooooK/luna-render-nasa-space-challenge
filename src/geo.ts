import { MOON_RADIUS_M } from './moon'

/**
 * Inversa de la proyección estereográfica polar sur sobre esfera lunar (la de `polar_x_m`/`polar_y_m`
 * de la API). Fórmulas: ρ = 2R·tan(π/4 + φ/2), x = ρ·sin λ, y = −ρ·cos λ.
 * Comprobada contra el ejemplo de `contracts/lunar-landing-api-contract.md` (lat −89.66, lon 222.7,
 * x −6975.1, y 7569.4): coincide dentro del redondeo de la latitud (~0.2 %).
 */
export function polarSouthToLatLon(x: number, y: number): { lat: number; lon: number } {
  const rho = Math.hypot(x, y)
  const lat = -90 + (2 * Math.atan(rho / (2 * MOON_RADIUS_M)) * 180) / Math.PI
  const lon = (Math.atan2(x, -y) * 180) / Math.PI
  return { lat, lon }
}
