// Tipos públicos del globo. Independientes de la consola; los campos de LandingSite
// coinciden con el schema `LandingSite` de contracts/openapi.json (id, name, category, lat, lon).

export type SiteStatus = 'GO' | 'CAUTION' | 'NO-GO'

export interface LandingSite {
  id: string
  name: string
  lat: number // latitud planetocéntrica, grados [-90, 90]
  lon: number // longitud este, grados [-180, 360]
  category?: string
  status?: SiteStatus // opcional: colorea el pin (resultado de POST /evaluate)
}

export interface TrajectoryPoint {
  lat: number
  lon: number
  altKm?: number // altitud sobre la superficie en km (0 = aterrizado)
}

export type LayerId = 'wac' | 'lolaShade'

export interface LunarGlobeConfig {
  autoRotate?: boolean // gira lentamente mientras no hay sitio seleccionado (default true)
  showGrid?: boolean // graticula lat/lon (default false)
  gridStepDeg?: number // separación de la graticula (default 30)
  showSiteLabels?: boolean // etiquetas junto a los pines (default true)
  showTrajectory?: boolean // arco de descenso (default true)
  terrain?: boolean // relieve global LOLA (default true)
  terrainExaggeration?: number // exageración vertical, 1 = real (default 1)
  polarFix?: boolean // mosaico polar sur sin abanico bajo -83° (solo al crear; default true)
  showStars?: boolean // cielo estrellado (default true)
  showSun?: boolean // disco solar; solo se dibuja si se conoce su dirección (default true)
  showEarth?: boolean // Tierra a tamaño angular real (default true)
  layers?: Partial<Record<LayerId, boolean>> // default { wac: true, lolaShade: false }
  lolaOpacity?: number // opacidad de la capa de elevación 0..1 (default 0.5)
  /** Vector que apunta HACIA el Sol en el marco fijo lunar (X→lon 0°, Z→polo norte). null = sin iluminación. */
  sunDirection?: [number, number, number] | null
}

/** Un PSR tal como lo devuelve GET /psr/nearby (geometría en metros estereográficos polares sur). */
export interface PsrItem {
  gid: number
  name?: string | null
  geometry: { type: string; coordinates: unknown }
}

export type SkyBody = 'sun' | 'earth'

export interface LunarGlobeEvents {
  siteClick: LandingSite
  globeClick: { lat: number; lon: number }
  animationComplete: undefined
  loading: { pending: number } // teselas en descarga; 0 = imagen estable
  trajectoryProgress: { progress: number; lat: number; lon: number; altKm: number }
  ready: undefined
}

// ─── Protocolo postMessage (host ⇄ iframe) ───────────────────────────────────
export type GlobeInboundMessage =
  | { type: 'SET_SITES'; payload: LandingSite[] }
  | { type: 'SELECT_SITE'; payload: { id?: string; lat: number; lon: number; label?: string } }
  | { type: 'SET_TRAJECTORY'; payload: TrajectoryPoint[] }
  | { type: 'SET_CONFIG'; payload: LunarGlobeConfig }
  /** Vector solar en el marco local del sitio (D-008: +X Este, +Y Arriba, -Z Norte), tal cual `sun_vector_3d`. */
  | { type: 'SET_SUN_LOCAL'; payload: { lat: number; lon: number; vector: [number, number, number] } }
  /** `earth_vector_3d` de la API en el marco local del sitio (D-008). La distancia es la media (384 400 km). */
  | { type: 'SET_EARTH_LOCAL'; payload: { lat: number; lon: number; vector: [number, number, number] } }
  /** `psrs` de GET /psr/nearby, tal cual. */
  | { type: 'SET_PSR'; payload: PsrItem[] }
  | { type: 'LOOK_AT'; payload: { body: SkyBody } }
  | { type: 'VIEW_FROM_SURFACE'; payload: { lat: number; lon: number; look?: SkyBody } }
  | { type: 'SET_VIEW'; payload: { lat: number; lon: number; altM: number; headingDeg?: number; pitchDeg?: number } }
  | { type: 'FOLLOW_TRAJECTORY'; payload: { enabled: boolean } }
  | { type: 'PLAY_ANIMATION'; payload: { playing: boolean } }
  | { type: 'RESET' }

export type GlobeOutboundMessage =
  | { type: 'READY' }
  | { type: 'SITE_CLICKED'; payload: LandingSite }
  | { type: 'GLOBE_CLICKED'; payload: { lat: number; lon: number } }
  | { type: 'ANIMATION_COMPLETE' }
  | { type: 'LOADING'; payload: { pending: number } }
  | { type: 'TRAJECTORY_PROGRESS'; payload: { progress: number; lat: number; lon: number; altKm: number } }
