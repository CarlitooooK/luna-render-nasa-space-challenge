// DATOS MOCK solo para la demo del globo. En la consola los sitios vienen de GET /api/v1/sites
// y se envían con SET_SITES. No son coordenadas oficiales.
import type { LandingSite, TrajectoryPoint } from '../types'

export const MOCK_SITES: LandingSite[] = [
  { id: 'shackleton-rim', name: 'Shackleton Rim', lat: -89.54, lon: 0.0, category: 'PSR-Adjacent' },
  { id: 'haworth', name: 'Haworth', lat: -87.5, lon: -5.0, category: 'PSR' },
  { id: 'nobile-rim', name: 'Nobile Rim', lat: -85.2, lon: 53.0, category: 'Illuminated' },
  { id: 'malapert-massif', name: 'Malapert Massif', lat: -85.98, lon: 2.47, category: 'Peak' },
  { id: 'connecting-ridge', name: 'Connecting Ridge', lat: -88.74, lon: 60.18, category: 'Ridge' },
  { id: 'de-gerlache-rim', name: 'de Gerlache Rim', lat: -88.3, lon: 88.0, category: 'PSR-Adjacent' },
]

/** Arco de descenso mock: parte 15° de latitud antes del sitio a 100 km y baja a 0. */
export function generateDescentArc(lat: number, lon: number, steps = 24): TrajectoryPoint[] {
  const startLat = lat - 15
  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1)
    return { lat: startLat + (lat - startLat) * t, lon, altKm: 100 * (1 - t * t) }
  })
}
