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
  /** URL base de las teselas de terreno del backend (`<api>/terrain/tiles`, contrato v1.3). Con ella el globo usa el relieve LOLA real y dibuja el polo sur sombreado; si no llega o falla, sigue con Moon Trek. */
  terrainTilesUrl?: string
}

/** Un PSR tal como lo devuelve GET /psr/nearby (geometría en metros estereográficos polares sur). */
export interface PsrItem {
  gid: number
  name?: string | null
  geometry: { type: string; coordinates: unknown }
}

export type SkyBody = 'sun' | 'earth'
/** Pin de un escenario de Compare: `label` es la letra (A–E); `best` resalta el recomendado. */
export interface ComparePin { id: string; label: string; lat: number; lon: number; status?: SiteStatus; best?: boolean }
export interface CustomPin { lat: number; lon: number; label?: string }
export interface SkyBodyPayload { az: number; el: number; horizonEl: number; visible: boolean }

export type ScenePhase = 'arrival' | 'descent' | 'landed' | 'done'

export interface LunarGlobeEvents {
  siteClick: LandingSite
  globeClick: { lat: number; lon: number }
  animationComplete: undefined
  horizonPhase: { phase: 'arrival' | 'ready' | 'leaving' }
  scenePhase: { phase: ScenePhase }
  sceneError: { reason: string } // las opciones de PLAY_LANDING_SCENE se rechazaron
  sceneTelemetry: { t: number; altM: number; vMps: number } // ilustrativa, no es física
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
  /** Fase 3: módulo con columna de motor siguiendo la trayectoria y/o astronauta en el suelo (`null` lo quita). */
  /** `horizon_profile` de `POST /evaluate` (360 puntos) del sitio. Hay que enviarlo antes de SHOW_HORIZON. */
  | { type: 'SET_HORIZON'; payload: { lat: number; lon: number; profile: { az_deg: number; horizon_el_deg: number }[] } }
  /** Cielo del paso actual del scrubber, tal cual `timeline[stepIndex]` (azimut, elevación, horizonte del terreno, visibilidad). */
  | { type: 'SET_SKY_STATE'; payload: { sun: SkyBodyPayload; earth: SkyBodyPayload } }
  /** Sol y Tierra vistos desde el centro de la Luna (`GET /ephemeris`, marco fijo lunar, `direction` unitario). Sirve para la vista global sin sitio. */
  | { type: 'SET_SKY_GLOBAL'; payload: { sun: { direction: [number, number, number] }; earth: { direction: [number, number, number]; distanceKm?: number } } }
  /** Pines de los escenarios de Compare (A–E). Lista vacía los quita. */
  | { type: 'SET_COMPARE_PINS'; payload: ComparePin[] }
  /** Marcador del pin libre (clic en el globo). `null` lo quita. */
  | { type: 'SET_CUSTOM_PIN'; payload: CustomPin | null }
  /** Detiene (`true`) o reanuda (`false`) el dibujado. Para cuando la consola tapa el globo con otra escena. */
  | { type: 'SET_PAUSED'; payload: { paused: boolean } }
  | { type: 'SET_HORIZON_DETAIL'; payload: { detailed: boolean } }
  /** Vista de horizonte (Lander POV): baja de la esfera al suelo del sitio. */
  | { type: 'SHOW_HORIZON'; payload: { lat: number; lon: number; headingDeg?: number } }
  | { type: 'EXIT_HORIZON' }
  /** `sample: true` rotula el visor: la luz y el horizonte mostrados no son reales (mock). */
  | { type: 'SET_DATA_MODE'; payload: { sample: boolean } }
  /** Escena de alunizaje en un plano horizontal sobre el terreno (vuelo desde la vista global, descenso, polvo y astronauta). */
  | { type: 'PLAY_LANDING_SCENE'; payload: { lat: number; lon: number; headingDeg?: number; startAltM?: number; durationS?: number; distanceM?: number; astronaut?: boolean } }
  | { type: 'STOP_LANDING_SCENE' }
  | { type: 'SET_VEHICLES'; payload: { lander?: boolean; astronaut?: { lat: number; lon: number; headingDeg?: number } | null } }
  | { type: 'VIEW_VEHICLE'; payload: { which: 'lander' | 'astronaut'; rangeM?: number } }
  | { type: 'FOLLOW_TRAJECTORY'; payload: { enabled: boolean } }
  | { type: 'PLAY_ANIMATION'; payload: { playing: boolean } }
  /** Vista global sin perder la selección; la cámara vuelve a girar sola hasta que se elija otra vista. */
  | { type: 'RECENTER' }
  | { type: 'RESET' }

export type GlobeOutboundMessage =
  | { type: 'READY' }
  | { type: 'SITE_CLICKED'; payload: LandingSite }
  | { type: 'GLOBE_CLICKED'; payload: { lat: number; lon: number } }
  | { type: 'ANIMATION_COMPLETE' }
  | { type: 'HORIZON_PHASE'; payload: { phase: 'arrival' | 'ready' | 'leaving' } }
  | { type: 'SCENE_ERROR'; payload: { reason: string } }
  | { type: 'SCENE_PHASE'; payload: { phase: ScenePhase } }
  | { type: 'SCENE_TELEMETRY'; payload: { t: number; altM: number; vMps: number } }
  | { type: 'LOADING'; payload: { pending: number } }
  | { type: 'TRAJECTORY_PROGRESS'; payload: { progress: number; lat: number; lon: number; altKm: number } }
