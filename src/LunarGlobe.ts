import './moon' // primero: fija el elipsoide lunar antes de crear nada de Cesium
import {
  ArcType,
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  DistanceDisplayCondition,
  Color,
  DirectionalLight,
  EllipsoidTerrainProvider,
  Entity,
  Globe,
  HeadingPitchRange,
  HeightReference,
  ImageryLayer,
  HorizontalOrigin,
  LabelStyle,
  Math as CesiumMath,
  Matrix4,
  PolygonHierarchy,
  PolylineGlowMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  VerticalOrigin,
  Viewer,
} from 'cesium'
import { MOON } from './moon'
import { CelestialSky, FAR_PLANE_M, createSkyBox } from './sky'
import { polarSouthToLatLon } from './geo'
import { createMoonTerrain, groundHeight, groundHeights } from './terrain'
import { PolarSouthImageryProvider } from './polar'
import { HillshadeImageryProvider, createServerHillshade } from './hillshade'
import { detectTilesVersion, normalizeTilesUrl } from './terrarium'
import { Vehicles } from './vehicles'
import { LandingScene, type LandingSceneOptions } from './landingScene'
import { HorizonView, type HorizonPoint, type HorizonViewOptions, type SkyState } from './horizonView'
import { attachTrackpad } from './trackpad'
import { RegolithImageryProvider, REGOLITH_MIN_TERRAIN_LEVEL } from './regolith'
import { LAYER_DEFS, createImageryProvider, type LayerMap } from './layers'
import type {
  LandingSite,
  LayerId,
  LunarGlobeConfig,
  LunarGlobeEvents,
  PsrItem,
  SkyBody,
  TrajectoryPoint,
  ComparePin,
  CustomPin,
} from './types'

const DEFAULTS: Required<Omit<LunarGlobeConfig, 'sunDirection' | 'terrainTilesUrl'>> & Pick<LunarGlobeConfig, 'sunDirection' | 'terrainTilesUrl'> = {
  autoRotate: true,
  showGrid: false,
  gridStepDeg: 30,
  showSiteLabels: true,
  showTrajectory: true,
  terrain: true,
  terrainExaggeration: 1,
  polarFix: true,
  showStars: true,
  showSun: true,
  showEarth: true,
  layers: { wac: true, lolaShade: false },
  lolaOpacity: 0.5,
  sunDirection: null,
}

const STATUS_COLOR: Record<string, string> = {
  GO: '#22c55e',
  CAUTION: '#eab308',
  'NO-GO': '#ef4444',
}
const DEFAULT_PIN = '#38bdf8'
const SELECTED_PIN = '#f59e0b'
const SITE_VIEW_RANGE_M = 120_000
const PIN_HEIGHT_M = 200 // evita z-fighting con la superficie
const AUTO_ROTATE_RAD_PER_S = 0.04
const GLOBAL_VIEW_ALT_M = 9_000_000

type Listener<K extends keyof LunarGlobeEvents> = (data: LunarGlobeEvents[K]) => void

/**
 * Globo lunar basado en CesiumJS. Sin dependencia de React ni de ningún store:
 * se controla con métodos y emite eventos. Ver README para uso por iframe o import.
 */
export class LunarGlobe {
  readonly viewer: Viewer
  private config: typeof DEFAULTS
  private layers: LayerMap = {}
  private sites: LandingSite[] = []
  private siteEntities = new Map<string, Entity>()
  private selectedId: string | null = null
  private selectedPoint: { lat: number; lon: number } | null = null
  private gridEntities: Entity[] = []
  private trajectoryEntities: Entity[] = []
  private trajectoryPoints: Cartesian3[] = []
  private playing = true
  private progress = 0
  private lastTime = performance.now()
  private handler: ScreenSpaceEventHandler
  private listeners: { [K in keyof LunarGlobeEvents]?: Listener<K>[] } = {}
  private userInteracting = false
  /** Último gesto del trackpad: el giro automático espera un momento tras él. */
  private lastGesture = 0
  private detachTrackpad: () => void = () => {}
  private flying = false
  /** Tras RECENTER: gira aunque haya un sitio elegido. Lo apaga cualquier vista nueva. */
  private orbit = false
  private sky!: CelestialSky
  private moonTerrain = createMoonTerrain()
  private flatTerrain = new EllipsoidTerrainProvider({ ellipsoid: MOON })
  private polarLayer: ImageryLayer | null = null
  private hillshadeLayer: ImageryLayer | null = null
  private apiBase: string | null = null // URL base de las teselas en uso
  private vehicles!: Vehicles
  private scene!: LandingScene
  private horizon!: HorizonView
  private dataBadge: HTMLElement | null = null
  private container: HTMLElement
  private detailLayer: ImageryLayer | null = null
  private lastTelemetry = 0
  private landedHold = 0 // segundos que el módulo se queda posado antes de repetir
  private camLocked = false
  private followRange: number | null = null // null = distancia automática según la altitud
  private followHeadingDeg = 0
  private maxAltKm = 0
  private psrEntities: Entity[] = []
  private sceneLight: DirectionalLight | null = null
  private pinEntities: Entity[] = []
  private customEntity: Entity | null = null
  private trajectoryData: TrajectoryPoint[] = []
  private follow = false
  private lastProgressEmit = 0
  private disposed = false

  constructor(container: HTMLElement, config: LunarGlobeConfig = {}) {
    this.container = container
    this.config = { ...DEFAULTS, ...config, layers: { ...DEFAULTS.layers, ...config.layers } }

    this.viewer = new Viewer(container, {
      baseLayer: false, // sin Ion ni imagen terrestre
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      scene3DOnly: true,
      skyAtmosphere: false,
      skyBox: createSkyBox(),
      globe: new Globe(MOON),
    })

    const { scene } = this.viewer
    scene.globe.baseColor = Color.fromCssColorString('#1b1b1b')
    scene.globe.showGroundAtmosphere = false
    scene.globe.enableLighting = false
    scene.globe.depthTestAgainstTerrain = true // pines y trayectoria no se ven a través del relieve
    scene.fog.enabled = false
    if (scene.sun) scene.sun.show = false // el Sol/Luna de Cesium son los de la Tierra
    if (scene.moon) scene.moon.show = false
    scene.backgroundColor = Color.fromCssColorString('#05070d')
    // El Sol está a 9e8 m en el modelo: hay que ampliar el plano lejano de la cámara
    ;(scene.camera.frustum as { far: number }).far = FAR_PLANE_M
    if (scene.skyBox) scene.skyBox.show = this.config.showStars
    // Las partículas (columna de motor) avanzan con el reloj de Cesium: debe correr
    this.viewer.clock.shouldAnimate = true
    this.sky = new CelestialSky(this.viewer)
    // La luz acompaña al Sol mientras se desliza: si saltara con cada paso, el terminador avanzaría a brincos
    this.sky.onMove(() => this.followSunLight())
    this.vehicles = new Vehicles(this.viewer)
    this.horizon = new HorizonView({
      viewer: this.viewer,
      groundHeight: (lat, lon) => (this.config.terrain ? groundHeight(this.moonTerrain, lat, lon) : Promise.resolve(0)),
      sunPosition: () => this.sky.position('sun'),
      earthPosition: () => this.sky.position('earth'),
      begin: () => {
        this.orbit = false
        this.scene.stop()
        this.stopFollow()
        this.flying = false
        this.selectedPoint = this.selectedPoint ?? { lat: 0, lon: 0 } // sin auto-rotación
        this.viewer.camera.cancelFlight()
        this.viewer.scene.globe.enableLighting = false
        this.siteEntities.forEach((e) => (e.show = false))
        this.applyLighting()
        this.refreshCloseCamera(true) // begin() corre antes de que la vista marque `active`
      },
      end: () => {
        this.setGroundBrightness(1)
        this.applyLighting()
        this.refreshCloseCamera()
        this.siteEntities.forEach((e) => (e.show = true))
      },
      setGroundBrightness: (f) => this.setGroundBrightness(f),
      phase: (phase) => this.emit('horizonPhase', { phase }),
    })
    this.scene = new LandingScene({
      viewer: this.viewer,
      vehicles: this.vehicles,
      groundHeight: (lat, lon) => (this.config.terrain ? groundHeight(this.moonTerrain, lat, lon) : Promise.resolve(0)),
      sunDirection: () => this.sky.direction('sun'),
      begin: () => {
        this.orbit = false
        this.stopFollow()
        this.flying = false
        this.selectedPoint = this.selectedPoint ?? { lat: 0, lon: 0 } // sin auto-rotación
        this.viewer.camera.cancelFlight()
        // a ras de suelo el sombreado de la esfera apagaría la imagen: se deja la imagen tal cual y
        // la luz solar solo actúa sobre los modelos
        this.viewer.scene.globe.enableLighting = false
        // en la escena local no hay pines de sitios
        this.siteEntities.forEach((e) => (e.show = false))
        this.refreshCloseCamera(true)
      },
      end: () => {
        this.stopFollow()
        this.applyLighting()
        this.refreshCloseCamera()
        this.siteEntities.forEach((e) => (e.show = true))
      },
      phase: (phase) => this.emit('scenePhase', { phase }),
      error: (reason) => this.emit('sceneError', { reason }),
      lockCamera: () => (this.camLocked = true),
      setKeyLight: (v) => {
        if (!v) {
          this.applyLighting()
          return
        }
        const travel = Cartesian3.negate(Cartesian3.normalize(v, new Cartesian3()), new Cartesian3())
        this.setSceneLight(travel, 2.4)
      },
    })
    this.sky.setVisible(this.config.showSun, this.config.showEarth)
    scene.globe.tileLoadProgressEvent.addEventListener((pending: number) => this.emit('loading', { pending }))

    const ctrl = scene.screenSpaceCameraController
    ctrl.minimumZoomDistance = 1_000
    ctrl.maximumZoomDistance = 25_000_000

    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(0, -20, 9_000_000, MOON),
    })

    this.applyTerrain()
    this.applyLayers()
    this.applyGrid()
    this.applyLighting()

    this.handler = new ScreenSpaceEventHandler(scene.canvas)
    this.handler.setInputAction((e: { position: Cartesian2 }) => this.onClick(e.position), ScreenSpaceEventType.LEFT_CLICK)
    // Pausa la auto-rotación mientras el usuario arrastra / hace zoom
    const down = () => (this.userInteracting = true)
    const up = () => (this.userInteracting = false)
    this.handler.setInputAction(down, ScreenSpaceEventType.LEFT_DOWN)
    this.handler.setInputAction(up, ScreenSpaceEventType.LEFT_UP)
    this.handler.setInputAction(down, ScreenSpaceEventType.RIGHT_DOWN)
    this.handler.setInputAction(up, ScreenSpaceEventType.RIGHT_UP)
    // Trackpad: pellizco = zoom, dos dedos = mover (en la vista de horizonte, mirar a la redonda)
    this.detachTrackpad = attachTrackpad(container, {
      viewer: this.viewer,
      lookMode: () => this.horizon.active && this.horizon.phase === 'ready',
      locked: () => this.scene.active || this.camLocked || this.follow || this.flying || (this.horizon.active && this.horizon.phase !== 'ready'),
      touched: () => (this.lastGesture = performance.now()),
      heightLimits: () => ({ min: ctrl.minimumZoomDistance, max: ctrl.maximumZoomDistance }),
    })

    scene.preRender.addEventListener(this.onPreRender)
    this.emit('ready', undefined)
  }

  // ─── Eventos ────────────────────────────────────────────────────────────
  on<K extends keyof LunarGlobeEvents>(event: K, fn: Listener<K>): () => void {
    ;(this.listeners[event] ??= [] as never).push(fn as never)
    return () => {
      const arr = this.listeners[event] as Listener<K>[] | undefined
      if (arr) this.listeners[event] = arr.filter((f) => f !== fn) as never
    }
  }
  private emit<K extends keyof LunarGlobeEvents>(event: K, data: LunarGlobeEvents[K]) {
    ;(this.listeners[event] as Listener<K>[] | undefined)?.forEach((fn) => fn(data))
  }

  // ─── API pública ────────────────────────────────────────────────────────
  setConfig(partial: LunarGlobeConfig) {
    if (partial.terrainTilesUrl !== undefined) void this.setTerrainSource(partial.terrainTilesUrl)
    const prev = this.config
    this.config = { ...prev, ...partial, layers: { ...prev.layers, ...partial.layers } }
    this.applyLayers()
    if (partial.showGrid !== undefined || partial.gridStepDeg !== undefined) this.applyGrid()
    if (partial.terrain !== undefined || partial.terrainExaggeration !== undefined) this.applyTerrain()
    if (partial.sunDirection !== undefined) this.applyLighting()
    if (partial.showStars !== undefined && this.viewer.scene.skyBox)
      this.viewer.scene.skyBox.show = this.config.showStars
    if (partial.showSun !== undefined || partial.showEarth !== undefined)
      this.sky.setVisible(this.config.showSun, this.config.showEarth)
    if (partial.showSiteLabels !== undefined) this.refreshSites()
    if (partial.showTrajectory !== undefined) this.refreshTrajectory()
    this.viewer.scene.requestRender()
  }

  setSites(sites: LandingSite[]) {
    this.sites = sites
    this.refreshSites()
  }

  /** Vuela hasta el sitio (por id o por coordenadas) y lo resalta. */
  selectSite(target: { id?: string; lat: number; lon: number }) {
    this.orbit = false
    this.stopFollow()
    this.scene.stop()
    this.horizon.stop()
    this.selectedId = target.id ?? null
    this.selectedPoint = { lat: target.lat, lon: target.lon }
    this.refreshSites()
    this.flying = true
    const center = Cartesian3.fromDegrees(target.lon, target.lat, 0, MOON)
    this.viewer.camera.flyToBoundingSphere(new BoundingSphere(center, 1), {
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-90), SITE_VIEW_RANGE_M),
      duration: 2.5,
      complete: () => (this.flying = false),
      cancel: () => (this.flying = false),
    })
  }

  /** Coloca la cámara de golpe sobre (lat, lon) a `altM` metros sobre la esfera; pitch -90 = mirando abajo. */
  setView(v: { lat: number; lon: number; altM: number; headingDeg?: number; pitchDeg?: number }) {
    this.orbit = false
    this.stopFollow()
    this.scene.stop()
    this.horizon.stop()
    this.flying = false
    this.selectedPoint = { lat: v.lat, lon: v.lon } // detiene la auto-rotación
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(v.lon, v.lat, v.altM, MOON),
      orientation: {
        heading: CesiumMath.toRadians(v.headingDeg ?? 0),
        pitch: CesiumMath.toRadians(v.pitchDeg ?? -90),
        roll: 0,
      },
    })
  }

  clearSelection() {
    this.selectedId = null
    this.selectedPoint = null
    this.refreshSites()
  }

  setTrajectory(points: TrajectoryPoint[]) {
    this.stopFollow()
    this.trajectoryData = points
    this.maxAltKm = points.reduce((m, p) => Math.max(m, p.altKm ?? 0), 0)
    this.progress = 0
    this.buildTrajectory(points.map(() => 0))
    // La altitud es sobre la superficie: se suma la altura real del terreno cuando se conoce
    if (this.config.terrain && points.length > 1) {
      void groundHeights(this.moonTerrain, points).then((g) => {
        if (this.trajectoryData === points && !this.disposed) this.buildTrajectory(g)
      })
    }
  }

  private buildTrajectory(ground: number[]) {
    this.trajectoryPoints = this.trajectoryData.map((p, i) =>
      Cartesian3.fromDegrees(p.lon, p.lat, (p.altKm ?? 0) * 1000 + ground[i], MOON),
    )
    this.refreshTrajectory()
  }

  setPlaying(playing: boolean) {
    this.playing = playing
  }

  /** Vector hacia el Sol en el marco fijo lunar. null desactiva la iluminación. */
  setSunDirection(dir: [number, number, number] | null) {
    this.setConfig({ sunDirection: dir })
  }

  /**
   * Aplica `sun_vector_3d` de la API (marco local del sitio, D-008: +X Este, +Y Arriba, -Z Norte)
   * convirtiéndolo al marco fijo lunar con el ENU del sitio.
   */
  setSunFromLocal(lat: number, lon: number, v: [number, number, number]) {
    const fixed = this.localToFixed(lat, lon, v)
    this.setSunDirection([fixed.x, fixed.y, fixed.z])
  }

  /** Dirección hacia la Tierra en el marco fijo lunar, observada desde el centro (null = posición media, lon 0°/lat 0°). */
  setEarthDirection(dir: [number, number, number] | null) {
    this.sky.setEarth(dir ? new Cartesian3(dir[0], dir[1], dir[2]) : null)
    this.applyLighting()
  }

  /** Aplica `earth_vector_3d` de la API (marco local del sitio, D-008). La distancia es la media (384 400 km). */
  setEarthFromLocal(lat: number, lon: number, v: [number, number, number]) {
    const site = Cartesian3.fromDegrees(lon, lat, 0, MOON)
    this.sky.setEarth(this.localToFixed(lat, lon, v), site)
    this.applyLighting()
  }

  /** Sol y Tierra desde el centro de la Luna (`GET /ephemeris`), ya en el marco fijo lunar. Con distancia real a la Tierra si viene. */
  setSkyGlobal(sun: [number, number, number], earth: [number, number, number], earthDistanceKm?: number) {
    this.setSunDirection(sun)
    this.sky.setEarth(new Cartesian3(earth[0], earth[1], earth[2]), Cartesian3.ZERO, earthDistanceKm ? earthDistanceKm * 1000 : undefined)
    this.applyLighting()
  }

  /** Pines A–E de Compare. Escenarios que comparten lugar (mismo sitio, otra fecha) se agrupan en un pin con varias letras. */
  setComparePins(pins: ComparePin[]) {
    const { entities } = this.viewer
    this.pinEntities.forEach((e) => entities.remove(e))
    this.pinEntities = []
    const groups = new Map<string, ComparePin[]>()
    for (const p of pins) {
      const k = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`
      groups.set(k, [...(groups.get(k) ?? []), p])
    }
    for (const g of groups.values()) {
      const best = g.some((p) => p.best)
      // Mismo estado en todo el grupo: ese color. Estados distintos o ausentes: color neutro (no se elige uno por ellos)
      const st = g.every((p) => p.status && p.status === g[0].status) ? g[0].status : undefined
      const color = Color.fromCssColorString((st && STATUS_COLOR[st]) || '#e5e7eb')
      this.pinEntities.push(entities.add({
        id: `compare:${g.map((p) => p.id).join('+')}`,
        position: Cartesian3.fromDegrees(g[0].lon, g[0].lat, PIN_HEIGHT_M * 2, MOON),
        point: {
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          pixelSize: best ? 24 : 18,
          color,
          outlineColor: best ? Color.WHITE : Color.BLACK.withAlpha(0.85),
          outlineWidth: best ? 4 : 2,
          disableDepthTestDistance: 0,
        },
        label: {
          text: g.map((p) => p.label).join(' ') + (best ? ' · Best' : ''),
          font: `bold ${best ? 14 : 12}px system-ui, sans-serif`,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 3,
          outlineColor: Color.BLACK,
          fillColor: Color.WHITE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          horizontalOrigin: HorizontalOrigin.CENTER,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          pixelOffset: new Cartesian2(0, best ? -16 : -13),
        },
      }))
    }
    this.viewer.scene.requestRender()
  }

  /**
   * El control de cámara no deja acercarse a menos de 1 km del suelo (útil en la vista global). En la escena de
   * alunizaje y en la vista de horizonte la cámara está a metros: con ese límite, al dejar de fijarla cada
   * fotograma, Cesium la subía hasta 1 km y el módulo se veía como un punto o desaparecía.
   */
  private refreshCloseCamera(starting = false) {
    const close = starting || this.scene.active || this.horizon.active
    this.viewer.scene.screenSpaceCameraController.minimumZoomDistance = close ? 1 : 1_000
  }

  /**
   * Fuente de relieve del backend (`GET /terrain/tiles`, contrato v1.3). La consola pasa la URL base de las teselas
   * (`terrainTilesUrl` en `SET_CONFIG`, P-010): el globo no conoce la API por sí solo. Con ella el terreno usa las teselas LOLA reales (40 m/px en el polo) y el polo
   * sur se dibuja como relieve sombreado, en lugar del mosaico WAC de 267 m/px con abanico.
   */
  async setTerrainSource(url: string) {
    const base = normalizeTilesUrl(url)
    if (!base || base === this.apiBase || this.disposed) return
    // Un backend sin `/terrain/tiles` (anterior a v1.3) o caído: se sigue con Moon Trek, sin romper nada
    const version = await detectTilesVersion(base)
    if (!version || this.disposed) return
    this.apiBase = base
    this.moonTerrain = createMoonTerrain(base, version)
    if (this.config.terrain) this.viewer.terrainProvider = this.moonTerrain
    const { imageryLayers } = this.viewer
    if (this.hillshadeLayer) imageryLayers.remove(this.hillshadeLayer)
    if (this.config.polarFix) {
      // justo encima del mosaico polar WAC: donde falte una tesela del relieve se ve el mosaico, no un hueco negro
      const above = this.polarLayer ? imageryLayers.indexOf(this.polarLayer) + 1 : 1
      // v1.5: el backend entrega el sombreado hecho (sin costuras, hasta 20 m). v1.3: se calcula aquí desde Terrarium.
      const provider = version === 'v1.5' ? createServerHillshade(base) : new HillshadeImageryProvider(base)
      this.hillshadeLayer = imageryLayers.addImageryProvider(provider, above)
      this.hillshadeLayer.show = this.config.layers.wac ?? false
    }
    this.viewer.scene.requestRender()
  }

  /** Pausa o reanuda el dibujado (el estado, la cámara y los mensajes siguen). */
  setPaused(paused: boolean) {
    if (this.disposed) return
    this.viewer.useDefaultRenderLoop = !paused
  }

  /** Marcador del pin libre elegido con un clic en el globo. */
  setCustomPin(pin: CustomPin | null) {
    const { entities } = this.viewer
    if (this.customEntity) entities.remove(this.customEntity)
    this.customEntity = null
    if (pin) {
      this.customEntity = entities.add({
        id: 'custom-pin',
        position: Cartesian3.fromDegrees(pin.lon, pin.lat, PIN_HEIGHT_M * 2, MOON),
        point: { heightReference: HeightReference.RELATIVE_TO_GROUND, pixelSize: 12, color: Color.fromCssColorString(SELECTED_PIN), outlineColor: Color.WHITE, outlineWidth: 2 },
        label: {
          text: pin.label ?? 'Custom pin',
          font: '12px system-ui, sans-serif', style: LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Color.BLACK,
          fillColor: Color.WHITE, verticalOrigin: VerticalOrigin.BOTTOM, horizontalOrigin: HorizontalOrigin.LEFT,
          heightReference: HeightReference.RELATIVE_TO_GROUND, pixelOffset: new Cartesian2(10, -6),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 2_500_000),
        },
      })
    }
    this.viewer.scene.requestRender()
  }

  /** Orienta la cámara hacia el Sol o la Tierra sin moverla. El Sol solo si su dirección es conocida. */
  lookAtBody(body: SkyBody) {
    const dir = this.sky.direction(body)
    if (!dir) return
    this.stopFollow()
    this.orientCamera(this.viewer.camera.positionWC, dir)
  }

  /** Cámara en la superficie del sitio (2 m) mirando al astro indicado, o al horizonte norte si no se indica. */
  async viewFromSurface(lat: number, lon: number, look?: SkyBody) {
    this.stopFollow()
    this.scene.stop()
    this.horizon.stop()
    const ground = this.config.terrain ? await groundHeight(this.moonTerrain, lat, lon) : 0
    if (this.disposed) return
    const pos = Cartesian3.fromDegrees(lon, lat, ground + 2, MOON)
    const frame = Transforms.eastNorthUpToFixedFrame(pos)
    const north = Matrix4.multiplyByPointAsVector(frame, Cartesian3.UNIT_Y, new Cartesian3())
    const target = (look && this.sky.direction(look)) || north
    this.orientCamera(pos, target)
  }

  private orientCamera(position: Cartesian3, direction: Cartesian3) {
    const d = Cartesian3.normalize(direction, new Cartesian3())
    // "arriba" = la vertical del lugar (radial) proyectada perpendicular a la mirada. Con el norte de la Luna
    // como arriba, en el hemisferio sur la cámara quedaba al revés.
    const radial = Cartesian3.normalize(position, new Cartesian3())
    const k = Cartesian3.dot(radial, d)
    let up = Cartesian3.subtract(radial, Cartesian3.multiplyByScalar(d, k, new Cartesian3()), new Cartesian3())
    if (Cartesian3.magnitude(up) < 1e-6) up = Cartesian3.clone(Cartesian3.UNIT_Z)
    Cartesian3.normalize(up, up)
    this.viewer.camera.setView({ destination: position, orientation: { direction: d, up } })
  }

  private localToFixed(lat: number, lon: number, v: [number, number, number]): Cartesian3 {
    // D-008: +X Este, +Y Arriba, -Z Norte  →  ENU = (x, -z, y)
    const enu = new Cartesian3(v[0], -v[2], v[1])
    const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat, 0, MOON))
    return Cartesian3.normalize(Matrix4.multiplyByPointAsVector(frame, enu, new Cartesian3()), new Cartesian3())
  }

  /** Dibuja los PSR de GET /psr/nearby (metros estereográficos polares sur) como polígonos sobre la superficie. */
  setPsr(items: PsrItem[]) {
    const { entities } = this.viewer
    this.psrEntities.forEach((e) => entities.remove(e))
    this.psrEntities = []
    const ring = (pts: unknown): Cartesian3[] | null => {
      if (!Array.isArray(pts) || pts.length < 3) return null
      const flat: number[] = []
      for (const p of pts) {
        if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null
        const { lat, lon } = polarSouthToLatLon(p[0], p[1])
        flat.push(lon, lat)
      }
      return Cartesian3.fromDegreesArray(flat, MOON)
    }
    for (const item of items) {
      const g = item.geometry
      const polys: unknown[] =
        g.type === 'MultiPolygon' ? (g.coordinates as unknown[]) : g.type === 'Polygon' ? [g.coordinates] : []
      for (const poly of polys) {
        if (!Array.isArray(poly)) continue
        const outer = ring(poly[0])
        if (!outer) continue
        const holes = poly.slice(1).map(ring).filter((r): r is Cartesian3[] => !!r)
        this.psrEntities.push(
          entities.add({
            name: item.name ?? `PSR ${item.gid}`,
            polygon: {
              // sin `height`: Cesium lo dibuja pegado al terreno
              hierarchy: new PolygonHierarchy(outer, holes.map((h) => new PolygonHierarchy(h))),
              material: Color.fromCssColorString('#3b82f6').withAlpha(0.14),
            },
          }),
          // Contorno fino: el relleno solo no deja ver el terreno ni dónde termina la sombra permanente
          entities.add({
            name: `${item.name ?? `PSR ${item.gid}`} (outline)`,
            polyline: {
              positions: [...outer, outer[0]],
              width: 1.5,
              clampToGround: true,
              material: Color.fromCssColorString('#93c5fd').withAlpha(0.85),
            },
          }),
        )
      }
    }
  }

  /** Cámara que sigue al módulo durante el descenso. */
  setFollowTrajectory(enabled: boolean) {
    this.scene.stop()
    this.horizon.stop()
    if (enabled && this.trajectoryPoints.length > 1) {
      this.followRange = null
      this.followHeadingDeg = 0
      this.follow = true
      this.flying = false
      this.viewer.camera.cancelFlight()
    } else {
      this.stopFollow()
    }
  }

  private stopFollow() {
    if (!this.follow && !this.camLocked) return
    this.follow = false
    this.camLocked = false
    this.viewer.camera.lookAtTransform(Matrix4.IDENTITY)
  }

  /**
   * Fase 3. `lander`: módulo de aterrizaje que recorre la trayectoria con columna de motor.
   * `astronaut`: astronauta de pie en el suelo de ese punto (null lo quita). Ambos son opcionales.
   */
  // ─── Vista de horizonte (Lander POV) ───────────────────────────────────
  /** Perfil de horizonte de `evaluate.horizon_profile` (360 puntos) del sitio. */
  setHorizonProfile(lat: number, lon: number, profile: HorizonPoint[]) {
    this.horizon.setProfile(lat, lon, profile)
  }

  /** Estado del cielo del paso actual del scrubber (azimut, elevación, horizonte y visibilidad). */
  setSkyState(state: SkyState) {
    this.horizon.setSky(state)
  }

  /** Simple muestra solo nombres; Detailed añade azimut, elevación y holgura sobre el terreno. */
  setHorizonDetailed(detailed: boolean) {
    this.horizon.setDetailed(detailed)
  }

  /** Baja de la esfera al suelo del sitio y mira el cielo sobre su horizonte real. */
  showHorizon(o: HorizonViewOptions) {
    void this.horizon.show(o)
  }

  /** Vuelve del horizonte a la esfera con un vuelo continuo. */
  exitHorizon() {
    this.horizon.exit()
  }

  /** Rotula el visor cuando los datos son de muestra (mock): la luz y el horizonte no son reales. */
  setDataMode(sample: boolean) {
    if (!sample) {
      this.dataBadge?.remove()
      this.dataBadge = null
      return
    }
    if (this.dataBadge) return
    const el = document.createElement('div')
    el.textContent = 'Sample data · the light and horizon shown are not real'
    el.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:6;padding:4px 12px;border-radius:999px;font:12px system-ui,sans-serif;color:#ffd9a8;background:rgba(42,29,16,.78);border:1px solid rgba(255,198,92,.45);pointer-events:none'
    this.container.style.position = this.container.style.position || 'relative'
    this.container.appendChild(el)
    this.dataBadge = el
  }

  /** Atenúa o aclara la imagen del suelo (1 = sin cambio). Es un recurso visual, no un modelo de iluminación. */
  private setGroundBrightness(f: number) {
    for (const layer of [...Object.values(this.layers), this.polarLayer, this.detailLayer]) {
      if (layer) layer.brightness = f
    }
  }

  /** Escena de alunizaje: vuelo desde la vista global, descenso vertical del módulo, polvo y astronauta. */
  playLandingScene(o: LandingSceneOptions) {
    this.horizon.stop()
    void this.scene.play(o)
  }

  stopLandingScene() {
    this.scene.stop()
  }

  async setVehicles(v: { lander?: boolean; astronaut?: { lat: number; lon: number; headingDeg?: number } | null }) {
    if (v.lander !== undefined) {
      this.vehicles.setLander(v.lander, () => (this.trajectoryPoints.length > 1 ? this.pointAlong(this.progress) : null))
    }
    if (v.astronaut !== undefined) {
      const ground = v.astronaut && this.config.terrain ? await groundHeight(this.moonTerrain, v.astronaut.lat, v.astronaut.lon) : 0
      if (!this.disposed) this.vehicles.setAstronaut(v.astronaut, ground)
    }
  }

  /** Acerca la cámara a un vehículo (orbitable con el ratón). Se libera con `reset()` o cualquier otra vista. */
  viewVehicle(which: 'lander' | 'astronaut', rangeM?: number) {
    this.orbit = false
    this.scene.stop()
    this.horizon.stop()
    if (which === 'lander') {
      // el módulo se mueve: la cámara lo sigue a distancia fija
      if (this.trajectoryPoints.length < 2) return
      this.stopFollow()
      this.followRange = rangeM ?? 40
      this.followHeadingDeg = 200
      this.selectedPoint = this.selectedPoint ?? { lat: 0, lon: 0 }
      this.flying = false
      this.viewer.camera.cancelFlight()
      this.follow = true
      return
    }
    const target = this.vehicles.astronautPos
    if (!target) return
    this.stopFollow()
    this.flying = false
    this.selectedPoint = this.selectedPoint ?? { lat: 0, lon: 0 } // detiene la auto-rotación
    this.camLocked = true
    this.viewer.camera.lookAt(target, new HeadingPitchRange(CesiumMath.toRadians(200), CesiumMath.toRadians(-12), rangeM ?? 7))
  }

  /**
   * Vuelve a la vista global **sin perder la selección**: el pin sigue resaltado y la cámara queda sobre él, a la
   * distancia de la vista inicial. Cierra el horizonte y la escena, y retoma el giro automático (que sin esto solo
   * corre sin sitio elegido) hasta la próxima vista.
   */
  recenter() {
    this.horizon.stop()
    this.scene.stop()
    this.stopFollow()
    this.camLocked = false
    const p = this.selectedPoint
    this.flying = true
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(p?.lon ?? 0, p ? Math.max(-60, Math.min(60, p.lat)) : -20, GLOBAL_VIEW_ALT_M, MOON),
      duration: 1.8,
      complete: () => { this.flying = false; this.orbit = true },
      cancel: () => (this.flying = false),
    })
  }

  /** Vuelve a la vista global. */
  reset() {
    this.orbit = false
    this.horizon.stop()
    this.stopFollow()
    this.scene.stop()
    this.clearSelection()
    this.trajectoryPoints = []
    this.trajectoryData = []
    this.refreshTrajectory()
    this.flying = true
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(0, -20, 9_000_000, MOON),
      duration: 1.5,
      complete: () => (this.flying = false),
      cancel: () => (this.flying = false),
    })
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.detachTrackpad()
    this.viewer.scene.preRender.removeEventListener(this.onPreRender)
    this.handler.destroy()
    this.viewer.destroy()
  }

  // ─── Internos ───────────────────────────────────────────────────────────
  private applyLayers() {
    const { imageryLayers } = this.viewer
    ;(Object.keys(LAYER_DEFS) as LayerId[]).forEach((id, order) => {
      const wanted = this.config.layers[id] ?? false
      let layer = this.layers[id]
      if (wanted && !layer) {
        layer = imageryLayers.addImageryProvider(createImageryProvider(id, { polarFix: this.config.polarFix }))
        this.layers[id] = layer
        // WAC debajo, LOLA encima
        if (order === 0) {
          imageryLayers.lowerToBottom(layer)
          if (!this.detailLayer) {
            this.detailLayer = new ImageryLayer(new RegolithImageryProvider(), { minimumTerrainLevel: REGOLITH_MIN_TERRAIN_LEVEL })
            imageryLayers.add(this.detailLayer, 1)
          }
          if (this.config.polarFix && !this.polarLayer) {
            // mosaico polar reproyectado sobre el WAC global (abanico en ±90°)
            this.polarLayer = imageryLayers.addImageryProvider(new PolarSouthImageryProvider(), 1)
          }
        }
      }
      if (id === 'wac' && this.polarLayer) this.polarLayer.show = wanted
      if (id === 'wac' && this.hillshadeLayer) this.hillshadeLayer.show = wanted
      if (id === 'wac' && this.detailLayer) this.detailLayer.show = wanted
      if (layer) {
        layer.show = wanted
        if (id === 'lolaShade') layer.alpha = this.config.lolaOpacity
      }
    })
  }

  private applyTerrain() {
    const { viewer } = this
    viewer.terrainProvider = this.config.terrain ? this.moonTerrain : this.flatTerrain
    viewer.scene.verticalExaggeration = this.config.terrain ? this.config.terrainExaggeration : 1
    // Las entidades relativas al suelo y la trayectoria dependen de la altura del terreno
    if (this.trajectoryData.length) this.setTrajectory(this.trajectoryData)
  }

  private applyGrid() {
    const { entities } = this.viewer
    this.gridEntities.forEach((e) => entities.remove(e))
    this.gridEntities = []
    if (!this.config.showGrid) return
    const step = Math.max(5, this.config.gridStepDeg)
    const color = Color.WHITE.withAlpha(0.35)
    const line = (coords: number[]) =>
      entities.add({
        polyline: {
          positions: Cartesian3.fromDegreesArray(coords, MOON),
          width: 1,
          material: color,
          arcType: ArcType.GEODESIC,
          clampToGround: true,
        },
      })
    for (let lon = -180; lon < 180; lon += step) {
      const c: number[] = []
      for (let lat = -90; lat <= 90; lat += 3) c.push(lon, lat)
      this.gridEntities.push(line(c))
    }
    for (let lat = -90 + step; lat < 90; lat += step) {
      const c: number[] = []
      for (let lon = -180; lon <= 180; lon += 3) c.push(lon, lat)
      this.gridEntities.push(line(c))
    }
  }

  /**
   * Orienta la luz de la escena. Se reutiliza UNA luz y solo se cambia su dirección: reasignar `scene.light` con una
   * luz nueva en cada actualización del cielo (hasta ~6 veces por segundo con el scrubber en Play) hacía que
   * Cesium rehiciera la iluminación de los modelos y el módulo y la Tierra parpadearan o se vieran pixelados.
   */
  private setSceneLight(direction: Cartesian3, intensity = 2) {
    const { scene } = this.viewer
    if (this.sceneLight && scene.light === this.sceneLight && this.sceneLight.intensity === intensity) {
      if (!Cartesian3.equalsEpsilon(this.sceneLight.direction, direction, 1e-9)) Cartesian3.clone(direction, this.sceneLight.direction)
      return
    }
    this.sceneLight = new DirectionalLight({ direction: Cartesian3.clone(direction), intensity })
    scene.light = this.sceneLight
  }

  private applyLighting() {
    const { scene } = this.viewer
    // En plena escena la luz es la de la escena: el Sol solo reorienta su azimut y el suelo no se sombrea
    if (this.horizon?.active) {
      // Luz física del Sol (da la fase de la Tierra); el suelo se atenúa con `setGroundBrightness`, no con la esfera
      const sunVec = this.config.sunDirection ? new Cartesian3(...this.config.sunDirection) : null
      this.sky.setSun(sunVec)
      const shown = this.sky.shownDirection('sun')
      const travel = shown
        ? Cartesian3.negate(shown, new Cartesian3())
        : Cartesian3.clone(this.sky.direction('earth') ?? new Cartesian3(1, 0, 0))
      this.setSceneLight(Cartesian3.normalize(travel, travel))
      scene.globe.enableLighting = false
      return
    }
    if (this.scene?.active) {
      this.sky.setSun(this.config.sunDirection ? new Cartesian3(...this.config.sunDirection) : null)
      this.scene.refreshKeyLight()
      scene.globe.enableLighting = false
      return
    }
    const dir = this.config.sunDirection
    const sunVec = dir ? new Cartesian3(dir[0], dir[1], dir[2]) : null
    this.sky.setSun(sunVec)
    // DirectionalLight.direction es hacia donde viaja la luz: opuesto al vector hacia el Sol.
    // Sin Sol conocido, se ilumina la Tierra como "llena" (Sol detrás del observador) y la Luna
    // queda sin sombreado.
    const shown = sunVec ? this.sky.shownDirection('sun') : null
    const travel = shown
      ? Cartesian3.negate(shown, new Cartesian3())
      : Cartesian3.clone(this.sky.direction('earth') ?? new Cartesian3(1, 0, 0))
    Cartesian3.normalize(travel, travel)
    this.setSceneLight(travel)
    scene.globe.enableLighting = !!sunVec
  }

  /** La luz viaja en sentido contrario al Sol dibujado. La escena de alunizaje usa su propia luz clave. */
  private followSunLight() {
    if (this.scene?.active || !this.sceneLight || this.viewer.scene.light !== this.sceneLight) return
    const sun = this.sky.shownDirection('sun')
    if (sun) Cartesian3.negate(sun, this.sceneLight.direction)
  }

  private pinColor(site: LandingSite): Color {
    if (site.id === this.selectedId) return Color.fromCssColorString(SELECTED_PIN)
    return Color.fromCssColorString((site.status && STATUS_COLOR[site.status]) || DEFAULT_PIN)
  }

  private refreshSites() {
    const { entities } = this.viewer
    this.siteEntities.forEach((e) => entities.remove(e))
    this.siteEntities.clear()
    for (const site of this.sites) {
      const selected = site.id === this.selectedId
      const entity = entities.add({
        id: `site:${site.id}`,
        position: Cartesian3.fromDegrees(site.lon, site.lat, PIN_HEIGHT_M, MOON),
        point: {
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          pixelSize: selected ? 14 : 9,
          color: this.pinColor(site),
          outlineColor: Color.BLACK.withAlpha(0.8),
          outlineWidth: 2,
        },
        label: this.config.showSiteLabels
          ? {
              text: site.name,
              font: '12px system-ui, sans-serif',
              style: LabelStyle.FILL_AND_OUTLINE,
              outlineWidth: 3,
              outlineColor: Color.BLACK,
              fillColor: selected ? Color.fromCssColorString(SELECTED_PIN) : Color.WHITE,
              verticalOrigin: VerticalOrigin.BOTTOM,
              horizontalOrigin: HorizontalOrigin.LEFT,
              heightReference: HeightReference.RELATIVE_TO_GROUND,
              pixelOffset: new Cartesian2(10, -6),
              // en vista global los sitios del polo se solapan: etiquetas solo al acercarse
              distanceDisplayCondition: new DistanceDisplayCondition(0, 2_500_000),
            }
          : undefined,
      })
      this.siteEntities.set(site.id, entity)
    }
  }

  private refreshTrajectory() {
    const { entities } = this.viewer
    this.trajectoryEntities.forEach((e) => entities.remove(e))
    this.trajectoryEntities = []
    const pts = this.trajectoryPoints
    if (!this.config.showTrajectory || pts.length < 2) return

    this.trajectoryEntities.push(
      entities.add({
        polyline: {
          positions: pts,
          width: 4,
          arcType: ArcType.NONE,
          material: new PolylineGlowMaterialProperty({
            glowPower: 0.25,
            color: Color.fromCssColorString('#ff6b35'),
          }),
        },
      }),
      entities.add({
        position: Cartesian3.fromDegrees(
          this.trajectoryData[this.trajectoryData.length - 1].lon,
          this.trajectoryData[this.trajectoryData.length - 1].lat,
          PIN_HEIGHT_M,
          MOON,
        ),
        point: { heightReference: HeightReference.RELATIVE_TO_GROUND, pixelSize: 8, color: Color.WHITE, outlineColor: Color.fromCssColorString('#ff6b35'), outlineWidth: 3 },
        label: {
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          text: 'Touchdown',
          font: '11px system-ui, sans-serif',
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 3,
          fillColor: Color.WHITE,
          verticalOrigin: VerticalOrigin.TOP,
          pixelOffset: new Cartesian2(0, 8),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 2_500_000),
        },
      }),
      entities.add({
        position: new CallbackProperty(() => this.pointAlong(this.progress), false) as never,
        point: { pixelSize: 10, color: Color.fromCssColorString('#ff6b35'), outlineColor: Color.WHITE, outlineWidth: 2 },
      }),
    )
  }

  private pointAlong(t: number): Cartesian3 {
    const pts = this.trajectoryPoints
    if (pts.length === 0) return Cartesian3.ZERO
    const f = Math.min(Math.max(t, 0), 1) * (pts.length - 1)
    const i = Math.min(Math.floor(f), pts.length - 2)
    return Cartesian3.lerp(pts[i], pts[i + 1], f - i, new Cartesian3())
  }

  private interpolateData(t: number) {
    const pts = this.trajectoryData
    if (pts.length < 2) return { lat: 0, lon: 0, altKm: 0 }
    const f = Math.min(Math.max(t, 0), 1) * (pts.length - 1)
    const i = Math.min(Math.floor(f), pts.length - 2)
    const a = pts[i]
    const b = pts[i + 1]
    const u = f - i
    return {
      lat: a.lat + (b.lat - a.lat) * u,
      lon: a.lon + (b.lon - a.lon) * u,
      altKm: (a.altKm ?? 0) + ((b.altKm ?? 0) - (a.altKm ?? 0)) * u,
    }
  }

  private onPreRender = () => {
    const now = performance.now()
    const dt = Math.min((now - this.lastTime) / 1000, 0.1)
    this.lastTime = now

    if (this.playing && this.trajectoryPoints.length > 1 && this.config.showTrajectory) {
      if (this.landedHold > 0) {
        // posado: espera un momento y vuelve a empezar
        this.landedHold -= dt
        if (this.landedHold <= 0) this.progress = 0
      } else {
        // Velocidad ilustrativa: baja con la altitud (de ~100 % por encima del 15 % de la altitud máxima
        // a ~0.1 % al posarse) para que el tramo final, donde está la acción, dure unos segundos.
        const altNow = this.interpolateData(this.progress).altKm
        const f = this.maxAltKm > 0 ? Math.min(1, Math.max(0.0008, altNow / (0.15 * this.maxAltKm))) : 1
        const next = this.progress + dt * 0.12 * f
        if (next >= 1) {
          this.progress = 1
          this.landedHold = 3
          this.emit('animationComplete', undefined)
        } else {
          this.progress = next
        }
      }
    }

    this.scene.update(dt)
    this.horizon.update()
    if (this.scene.active) {
      if (now - this.lastTelemetry > 100 && this.scene.phase === 'descent') {
        this.lastTelemetry = now
        this.emit('sceneTelemetry', { t: this.scene.elapsedS, altM: this.scene.altM, vMps: this.scene.vMps })
      }
    }
    const hasPath = this.trajectoryPoints.length > 1 && this.config.showTrajectory
    const landerPos = this.scene.active ? this.scene.landerPosition() : hasPath ? this.pointAlong(this.progress) : null
    this.vehicles.update(
      landerPos,
      this.scene.active ? this.scene.engineOn : hasPath && this.progress < 1 && this.playing && this.interpolateData(this.progress).altKm > 0,
    )
    this.vehicles.setDust(this.scene.active ? this.scene.dustAt : null)

    if (this.trajectoryPoints.length > 1 && this.config.showTrajectory) {
      if (this.follow) {
        // la distancia baja con la altitud: de 25 km en órbita a ~40 m al posarse
        const altM = this.interpolateData(this.progress).altKm * 1000
        const range = this.followRange ?? Math.max(40, Math.min(25_000, altM * 0.8 + 40))
        this.viewer.camera.lookAt(
          this.pointAlong(this.progress),
          new HeadingPitchRange(CesiumMath.toRadians(this.followHeadingDeg), CesiumMath.toRadians(this.followRange ? -12 : -35), range),
        )
      }
      if (now - this.lastProgressEmit > 100) {
        this.lastProgressEmit = now
        this.emit('trajectoryProgress', { progress: this.progress, ...this.interpolateData(this.progress) })
      }
    }

    const idle = (this.orbit || (!this.selectedId && !this.selectedPoint)) && !this.userInteracting && now - this.lastGesture > 1500
    if (this.config.autoRotate && idle && !this.flying) {
      this.viewer.camera.rotate(Cartesian3.UNIT_Z, -AUTO_ROTATE_RAD_PER_S * dt)
    }
  }

  private onClick(position: Cartesian2) {
    const picked = this.viewer.scene.pick(position)
    const id = picked?.id instanceof Entity ? String(picked.id.id) : null
    if (id?.startsWith('site:')) {
      const site = this.sites.find((s) => `site:${s.id}` === id)
      if (site) {
        this.emit('siteClick', site)
        return
      }
    }
    const hit = this.viewer.camera.pickEllipsoid(position, MOON)
    if (!hit) return
    const c = Cartographic.fromCartesian(hit, MOON)
    this.emit('globeClick', { lat: CesiumMath.toDegrees(c.latitude), lon: CesiumMath.toDegrees(c.longitude) })
  }
}
