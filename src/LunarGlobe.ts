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
  type ImageryLayer,
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
import { LAYER_DEFS, createImageryProvider, type LayerMap } from './layers'
import type {
  LandingSite,
  LayerId,
  LunarGlobeConfig,
  LunarGlobeEvents,
  PsrItem,
  SkyBody,
  TrajectoryPoint,
} from './types'

const DEFAULTS: Required<Omit<LunarGlobeConfig, 'sunDirection'>> & Pick<LunarGlobeConfig, 'sunDirection'> = {
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
  private flying = false
  private sky!: CelestialSky
  private moonTerrain = createMoonTerrain()
  private flatTerrain = new EllipsoidTerrainProvider({ ellipsoid: MOON })
  private polarLayer: ImageryLayer | null = null
  private psrEntities: Entity[] = []
  private trajectoryData: TrajectoryPoint[] = []
  private follow = false
  private lastProgressEmit = 0
  private disposed = false

  constructor(container: HTMLElement, config: LunarGlobeConfig = {}) {
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
    this.sky = new CelestialSky(this.viewer)
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
    this.stopFollow()
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
    // "arriba" = eje norte de la Luna proyectado perpendicular a la mirada
    const k = Cartesian3.dot(Cartesian3.UNIT_Z, d)
    let up = Cartesian3.subtract(Cartesian3.UNIT_Z, Cartesian3.multiplyByScalar(d, k, new Cartesian3()), new Cartesian3())
    if (Cartesian3.magnitude(up) < 1e-6) up = Cartesian3.clone(Cartesian3.UNIT_X)
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
              material: Color.fromCssColorString('#3b82f6').withAlpha(0.4),
            },
          }),
        )
      }
    }
  }

  /** Cámara que sigue al módulo durante el descenso. */
  setFollowTrajectory(enabled: boolean) {
    if (enabled && this.trajectoryPoints.length > 1) {
      this.follow = true
      this.flying = false
      this.viewer.camera.cancelFlight()
    } else {
      this.stopFollow()
    }
  }

  private stopFollow() {
    if (!this.follow) return
    this.follow = false
    this.viewer.camera.lookAtTransform(Matrix4.IDENTITY)
  }

  /** Vuelve a la vista global. */
  reset() {
    this.stopFollow()
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
          if (this.config.polarFix && !this.polarLayer) {
            // mosaico polar reproyectado sobre el WAC global (abanico en ±90°)
            this.polarLayer = imageryLayers.addImageryProvider(new PolarSouthImageryProvider(), 1)
          }
        }
      }
      if (id === 'wac' && this.polarLayer) this.polarLayer.show = wanted
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

  private applyLighting() {
    const { scene } = this.viewer
    const dir = this.config.sunDirection
    const sunVec = dir ? new Cartesian3(dir[0], dir[1], dir[2]) : null
    this.sky.setSun(sunVec)
    // DirectionalLight.direction es hacia donde viaja la luz: opuesto al vector hacia el Sol.
    // Sin Sol conocido, se ilumina la Tierra como "llena" (Sol detrás del observador) y la Luna
    // queda sin sombreado.
    const travel = sunVec
      ? Cartesian3.negate(sunVec, new Cartesian3())
      : Cartesian3.clone(this.sky.direction('earth') ?? new Cartesian3(1, 0, 0))
    Cartesian3.normalize(travel, travel)
    scene.light = new DirectionalLight({ direction: travel })
    scene.globe.enableLighting = !!sunVec
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
      const next = this.progress + dt * 0.12
      if (next >= 1) this.emit('animationComplete', undefined)
      this.progress = next % 1
    }

    if (this.trajectoryPoints.length > 1 && this.config.showTrajectory) {
      if (this.follow) {
        this.viewer.camera.lookAt(
          this.pointAlong(this.progress),
          new HeadingPitchRange(0, CesiumMath.toRadians(-35), 25_000),
        )
      }
      if (now - this.lastProgressEmit > 100) {
        this.lastProgressEmit = now
        this.emit('trajectoryProgress', { progress: this.progress, ...this.interpolateData(this.progress) })
      }
    }

    const idle = !this.selectedId && !this.selectedPoint && !this.userInteracting
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
