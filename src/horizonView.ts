import {
  CameraEventType,
  CallbackPositionProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  ConstantPositionProperty,
  ConstantProperty,
  DistanceDisplayCondition,
  Entity,
  GeometryInstance,
  HorizontalOrigin,
  LabelStyle,
  Math as CesiumMath,
  Matrix4,
  PerInstanceColorAppearance,
  Primitive,
  Transforms,
  VerticalOrigin,
  WallGeometry,
  type Viewer,
} from 'cesium'
import { MOON } from './moon'

export interface HorizonPoint { az_deg: number; horizon_el_deg: number }
export interface SkyBodyState { az: number; el: number; horizonEl: number; visible: boolean }
export interface SkyState { sun: SkyBodyState; earth: SkyBodyState }
export type HorizonPhase = 'arrival' | 'ready' | 'leaving'

export interface HorizonViewOptions {
  lat: number
  lon: number
  /** Azimut hacia el que mira la cámara (0 = norte, 90 = este). Por defecto, hacia el Sol si se conoce. */
  headingDeg?: number
}

export interface HorizonHost {
  viewer: Viewer
  groundHeight(lat: number, lon: number): Promise<number>
  sunPosition(): Cartesian3 | null
  earthPosition(): Cartesian3 | null
  /** Prepara el visor: detiene otros modos, oculta pines, apaga el sombreado de la esfera. */
  begin(): void
  end(): void
  /** Multiplicador de brillo de la imagen del suelo (1 = sin cambio). */
  setGroundBrightness(f: number): void
  phase(p: HorizonPhase): void
}

// Distancia a la que se dibuja la silueta. A esa distancia el terreno ya está más allá del relieve que
// pinta el globo; la silueta aporta el horizonte lejano que el backend calculó con LOLA a 80 m.
const WALL_DISTANCE_M = 30_000
const EYE_HEIGHT_M = 2
// Color de la silueta a pleno día; se oscurece con el mismo factor que la imagen del suelo
const WALL_COLOR = Color.fromCssColorString('#625c52')
const WALL_ID = 'horizon-wall'
const ARRIVAL_S = 6
const EXIT_ALTITUDE_M = 2_500_000

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Brillo mínimo del suelo con el Sol oculto. Sin luz directa el suelo real queda casi negro, pero una pantalla
 * negra no comunica nada: se deja ver la superficie en penumbra y el rótulo del Sol dice que está tras el terreno.
 */
export const NIGHT_FLOOR = 0.5
// Tiempo con que el brillo del suelo sigue al Sol: el cambio se siente gradual, como la luz del paso siguiente.
const BRIGHTNESS_TAU_S = 0.35

/**
 * Brillo ILUSTRATIVO del suelo según el Sol: en penumbra (`NIGHT_FLOOR`) cuando el Sol queda bajo el horizonte
 * real, y más claro cuanto más sobre él. La holgura (elevación − horizonte del terreno) y la elevación sí son datos
 * del backend; la curva no. No usa `power_factor`, que asume un panel que sigue al Sol.
 */
export function groundBrightness(sun: SkyBodyState | undefined): number {
  if (!sun) return 1
  const clearance = sun.el - sun.horizonEl
  const k = smooth(-0.7, 0.7, clearance)
  const day = 0.62 * k + 0.38 * k * Math.min(1, Math.max(0, sun.el) / 15)
  return NIGHT_FLOOR + (1 - NIGHT_FLOOR) * day
}

/**
 * Vista de horizonte (Lander POV de `docs/ideas/lunar-landing-ui-ux-tdd.md`, `docs/05-flujos.md` §5.2):
 * la cámara baja desde la esfera hasta el suelo del sitio elegido y mira el cielo sobre la silueta real del
 * horizonte (`horizon_profile`). Al mover el scrubber, Sol y Tierra se desplazan contra esa silueta y se ven
 * salir u ocultarse. Todo dato (azimut, elevación, visibilidad, horizonte) viene del backend; aquí solo se dibuja.
 */
export class HorizonView {
  active = false
  phase: HorizonPhase | null = null

  private profile: HorizonPoint[] | null = null
  private profileFor: { lat: number; lon: number } | null = null
  private sky: SkyState | null = null
  private detailed = false
  private wall: Primitive | null = null
  /** Rosa de los vientos (N, E, S, O). Aparte de las etiquetas: rehacer la rosa no debe borrar las del Sol y la Tierra. */
  private compass: Entity[] = []
  private labels: { sun: Entity | null; earth: Entity | null } = { sun: null, earth: null }
  private token = 0
  private site0 = Cartesian3.ZERO
  private up = Cartesian3.UNIT_Z
  private east = Cartesian3.UNIT_X
  private north = Cartesian3.UNIT_Y
  private camPos = Cartesian3.ZERO
  private saved: Record<string, unknown> | null = null
  /** Brillo aplicado y el que pide el paso actual; `update()` lleva uno hacia el otro. */
  private brightness = 1
  private brightnessTarget = 1
  private lastFrame = 0

  constructor(private host: HorizonHost) {}

  /** Perfil de horizonte (`evaluate.horizon_profile`). Si la vista está activa, se redibuja la silueta. */
  setProfile(lat: number, lon: number, profile: HorizonPoint[]) {
    this.profile = profile
    this.profileFor = { lat, lon }
    if (this.active) this.buildWall()
  }

  setDetailed(detailed: boolean) {
    this.detailed = detailed
    this.refreshLabels()
  }

  /** Estado del cielo del paso actual (`timeline[stepIndex]`). */
  setSky(state: SkyState) {
    this.sky = state
    if (!this.active) return
    this.brightnessTarget = groundBrightness(state.sun)
    this.refreshLabels()
  }

  async show(o: HorizonViewOptions) {
    this.stop(false)
    const token = ++this.token
    this.host.begin()
    this.active = true
    this.setPhase('arrival')

    const ground = await this.host.groundHeight(o.lat, o.lon)
    if (token !== this.token) return
    this.site0 = Cartesian3.fromDegrees(o.lon, o.lat, ground, MOON)
    this.up = Cartesian3.normalize(this.site0, new Cartesian3())
    const frame = Transforms.eastNorthUpToFixedFrame(this.site0)
    this.east = Matrix4.multiplyByPointAsVector(frame, Cartesian3.UNIT_X, new Cartesian3())
    this.north = Matrix4.multiplyByPointAsVector(frame, Cartesian3.UNIT_Y, new Cartesian3())

    // Cámara de pie sobre el suelo (2 m), mirando hacia el Sol si se conoce (que el amanecer quede en cuadro)
    const az = o.headingDeg !== undefined ? CesiumMath.toRadians(o.headingDeg) : this.defaultAzimuth()
    const dirH = this.horizontal(az)
    this.camPos = Cartesian3.add(this.site0, Cartesian3.multiplyByScalar(this.up, EYE_HEIGHT_M, new Cartesian3()), new Cartesian3())
    const pitch = CesiumMath.toRadians(6)
    const dir = Cartesian3.add(
      Cartesian3.multiplyByScalar(dirH, Math.cos(pitch), new Cartesian3()),
      Cartesian3.multiplyByScalar(this.up, Math.sin(pitch), new Cartesian3()),
      new Cartesian3(),
    )

    this.buildWall()
    this.buildCompass()
    this.refreshLabels()
    // Al llegar se aplica de golpe: la luz del primer paso, sin fundido desde el día
    this.setBrightness(this.sky ? groundBrightness(this.sky.sun) : 1, true)

    // La esfera se queda atrás: vuelo continuo desde la vista actual hasta el suelo
    this.host.viewer.camera.flyTo({
      destination: this.camPos,
      orientation: { direction: dir, up: this.upFor(this.camPos, dir) },
      duration: ARRIVAL_S,
      complete: () => {
        if (token === this.token) this.arrived(dir)
      },
    })
  }

  /** Sale de la vista de horizonte con un vuelo de regreso a la esfera. */
  exit() {
    if (!this.active) return
    const token = ++this.token
    this.setPhase('leaving')
    const c = Cartographic.fromCartesian(this.site0, MOON)
    this.releaseControls()
    this.brightness = this.brightnessTarget = 1
    this.host.setGroundBrightness(1)
    this.clearOverlays()
    this.host.viewer.camera.flyTo({
      destination: Cartesian3.fromRadians(c.longitude, c.latitude, EXIT_ALTITUDE_M, MOON),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
      duration: 5,
      complete: () => {
        if (token === this.token) this.finish()
      },
      cancel: () => {
        if (token === this.token) this.finish()
      },
    })
  }

  /** Sale al instante, sin vuelo (otro modo toma el control de la cámara). */
  stop(restoreHost = true) {
    if (!this.active) return
    this.token++
    this.releaseControls()
    this.brightness = this.brightnessTarget = 1
    this.host.setGroundBrightness(1)
    this.clearOverlays()
    this.active = false
    this.phase = null
    if (restoreHost) this.host.end()
  }

  /** Una vez por fotograma: lleva el brillo del suelo hacia el del paso actual y mantiene la cámara sobre el terreno. */
  update() {
    const now = performance.now()
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : 0
    this.lastFrame = now
    if (!this.active) return
    if (Math.abs(this.brightness - this.brightnessTarget) > 1e-3) {
      this.setBrightness(this.brightness + (this.brightnessTarget - this.brightness) * (1 - Math.exp(-dt / BRIGHTNESS_TAU_S)))
    }
    if (this.phase !== 'ready') return
    const cc = Cartographic.fromCartesian(this.host.viewer.camera.positionWC, MOON)
    const gh = this.host.viewer.scene.globe.getHeight(cc)
    if (gh !== undefined && cc.height < gh + EYE_HEIGHT_M - 0.01) {
      cc.height = gh + EYE_HEIGHT_M
      this.host.viewer.camera.position = Cartographic.toCartesian(cc, MOON)
    }
  }

  // ─── Internos ───────────────────────────────────────────────────────────
  private arrived(dir: Cartesian3) {
    const cam = this.host.viewer.camera
    // Altura exacta del terreno dibujado (la de sampleTerrain puede quedar por debajo de la malla fina)
    const cc = Cartographic.fromCartesian(this.camPos, MOON)
    const gh = this.host.viewer.scene.globe.getHeight(cc)
    if (gh !== undefined) {
      cc.height = gh + EYE_HEIGHT_M
      this.camPos = Cartographic.toCartesian(cc, MOON)
      cam.setView({ destination: this.camPos, orientation: { direction: dir, up: this.upFor(this.camPos, dir) } })
    }
    // Arrastrar mira a la redonda (no gira el globo ni se aleja): horizonte siempre nivelado
    const c = this.host.viewer.scene.screenSpaceCameraController as unknown as Record<string, unknown>
    this.saved = {
      enableRotate: c.enableRotate, enableTranslate: c.enableTranslate, enableZoom: c.enableZoom,
      enableTilt: c.enableTilt, enableLook: c.enableLook, lookEventTypes: c.lookEventTypes,
    }
    c.enableRotate = false
    c.enableTranslate = false
    c.enableZoom = false
    c.enableTilt = false
    c.enableLook = true
    c.lookEventTypes = CameraEventType.LEFT_DRAG
    cam.constrainedAxis = Cartesian3.normalize(this.camPos, new Cartesian3())
    this.setPhase('ready')
  }

  private finish() {
    this.active = false
    this.phase = null
    this.host.end()
  }

  private releaseControls() {
    const cam = this.host.viewer.camera
    cam.constrainedAxis = undefined
    if (this.saved) {
      Object.assign(this.host.viewer.scene.screenSpaceCameraController, this.saved)
      this.saved = null
    }
  }

  private setPhase(p: HorizonPhase) {
    this.phase = p
    this.host.phase(p)
  }

  private horizontal(az: number): Cartesian3 {
    return Cartesian3.add(
      Cartesian3.multiplyByScalar(this.east, Math.sin(az), new Cartesian3()),
      Cartesian3.multiplyByScalar(this.north, Math.cos(az), new Cartesian3()),
      new Cartesian3(),
    )
  }

  private defaultAzimuth(): number {
    const az = this.sky?.sun.az ?? this.sky?.earth.az
    return az !== undefined ? CesiumMath.toRadians(az) : 0
  }

  /** Punto a `distance` metros del suelo del sitio en el azimut `azDeg` y con elevación aparente `elDeg`. */
  private skyPoint(azDeg: number, elDeg: number, distance = WALL_DISTANCE_M): Cartesian3 {
    const az = CesiumMath.toRadians(azDeg)
    const el = CesiumMath.toRadians(elDeg)
    const horiz = Cartesian3.multiplyByScalar(this.horizontal(az), distance, new Cartesian3())
    const vert = Cartesian3.multiplyByScalar(this.up, distance * Math.tan(el), new Cartesian3())
    return Cartesian3.add(this.site0, Cartesian3.add(horiz, vert, new Cartesian3()), new Cartesian3())
  }

  /** Silueta del horizonte: un muro oscuro a 30 km cuya altura sigue `horizon_profile` (elevación aparente). */
  private buildWall() {
    this.removeWall()
    if (!this.profile || this.profile.length < 8) return
    const here = Cartographic.fromCartesian(this.site0, MOON)
    // El perfil debe ser del sitio activo: si no, no se dibuja una silueta de otro lugar
    if (this.profileFor && (Math.abs(this.profileFor.lat - CesiumMath.toDegrees(here.latitude)) > 0.01
      || Math.abs((((this.profileFor.lon - CesiumMath.toDegrees(here.longitude) + 540) % 360) - 180)) > 0.01)) return
    const pts = [...this.profile].sort((a, b) => a.az_deg - b.az_deg)
    pts.push({ az_deg: pts[0].az_deg + 360, horizon_el_deg: pts[0].horizon_el_deg })
    const positions: Cartesian3[] = []
    const top: number[] = []
    const bottom: number[] = []
    for (const p of pts) {
      const q = this.skyPoint(p.az_deg, p.horizon_el_deg)
      const c = Cartographic.fromCartesian(q, MOON)
      positions.push(Cartesian3.fromRadians(c.longitude, c.latitude, 0, MOON))
      top.push(c.height)
      bottom.push(c.height - 4000)
    }
    const geometry = WallGeometry.createGeometry(
      new WallGeometry({ positions, maximumHeights: top, minimumHeights: bottom, vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
    )
    if (!geometry) return
    this.wall = this.host.viewer.scene.primitives.add(
      new Primitive({
        geometryInstances: new GeometryInstance({ id: WALL_ID, geometry, attributes: { color: ColorGeometryInstanceAttribute.fromColor(this.wallColor(this.brightness)) } }),
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: false, closed: false }),
        asynchronous: false,
      }),
    )
  }

  /** Suelo y silueta con el mismo brillo. `immediate` también fija el objetivo (sin fundido). */
  private setBrightness(f: number, immediate = false) {
    this.brightness = f
    if (immediate) this.brightnessTarget = f
    this.host.setGroundBrightness(f)
    this.tintWall(f)
  }

  private wallColor(f: number): Color {
    return new Color(WALL_COLOR.red * f, WALL_COLOR.green * f, WALL_COLOR.blue * f, 1)
  }

  /** La silueta del terreno lejano se oscurece como el suelo cuando el Sol está bajo el horizonte. */
  private tintWall(f: number) {
    // Recién creada, la silueta todavía no acepta cambios (Cesium lanza DeveloperError): ya nace con el color de `brightness`
    if (!this.wall?.ready) return
    const attrs = this.wall.getGeometryInstanceAttributes(WALL_ID)
    if (attrs) attrs.color = ColorGeometryInstanceAttribute.toValue(this.wallColor(f))
  }

  private removeWall() {
    if (this.wall) this.host.viewer.scene.primitives.remove(this.wall)
    this.wall = null
  }

  /** N, E, S, W sobre el horizonte, para orientarse al mirar a la redonda. */
  private buildCompass() {
    const { entities } = this.host.viewer
    this.clearCompass()
    for (const [name, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
      this.compass.push(
        entities.add({
          position: new ConstantPositionProperty(this.skyPoint(az, 0.4)),
          label: {
            text: name,
            font: 'bold 14px system-ui, sans-serif',
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 3,
            outlineColor: Color.BLACK,
            fillColor: Color.fromCssColorString('#f4f1ea').withAlpha(0.8),
            verticalOrigin: VerticalOrigin.BOTTOM,
            horizontalOrigin: HorizontalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      )
    }
  }

  private clearCompass() {
    this.compass.forEach((e) => this.host.viewer.entities.remove(e))
    this.compass = []
  }

  private labelText(name: string, b: SkyBodyState): string {
    const clearance = b.el - b.horizonEl
    if (!this.detailed) return b.visible ? name : `${name} · behind the terrain`
    const where = `az ${b.az.toFixed(1)}° · el ${b.el.toFixed(1)}°`
    const rel = `${clearance >= 0 ? '+' : '−'}${Math.abs(clearance).toFixed(1)}° ${clearance >= 0 ? 'above' : 'below'} the terrain`
    return `${name}\n${where}\n${rel}`
  }

  /** Etiquetas del Sol y la Tierra: siempre con nombre (el estado nunca depende solo del color). */
  private refreshLabels() {
    if (!this.active || !this.sky) return
    const { entities } = this.host.viewer
    const make = (key: 'sun' | 'earth', name: string, color: string, b: SkyBodyState) => {
      let e = this.labels[key]
      const text = this.labelText(name, b)
      if (!e) {
        // La etiqueta lee la posición dibujada del astro en cada fotograma (sin crear una propiedad nueva cada vez)
        const at = key === 'sun' ? () => this.host.sunPosition() : () => this.host.earthPosition()
        e = entities.add({
          position: new CallbackPositionProperty((_t, result) => {
            const p = at()
            return p ? Cartesian3.clone(p, result ?? new Cartesian3()) : undefined
          }, false),
          label: {
            text,
            font: '12px system-ui, sans-serif',
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 3,
            outlineColor: Color.BLACK,
            fillColor: Color.fromCssColorString(color),
            verticalOrigin: VerticalOrigin.TOP,
            horizontalOrigin: HorizontalOrigin.CENTER,
            pixelOffset: new Cartesian2(0, 22),
            disableDepthTestDistance: Number.POSITIVE_INFINITY, // se ve aunque el astro esté tras el terreno
            distanceDisplayCondition: new DistanceDisplayCondition(0, 5e9),
          },
        })
        this.labels[key] = e
      } else if (e.label) {
        e.label.text = new ConstantProperty(text)
      }
    }
    make('sun', 'Sun', '#ffc65c', this.sky.sun)
    make('earth', 'Earth', '#5bbdff', this.sky.earth)
  }

  private clearOverlays() {
    this.removeWall()
    this.clearCompass()
    // Las etiquetas viven aparte de la rosa: si el cielo llega mientras show() espera la altura del suelo, se crean
    // antes que la rosa, y rehacer la rosa las quitaba del visor sin soltarlas (la etiqueta del Sol no volvía)
    for (const e of [this.labels.sun, this.labels.earth]) if (e) this.host.viewer.entities.remove(e)
    this.labels = { sun: null, earth: null }
  }

  private upFor(pos: Cartesian3, dir: Cartesian3): Cartesian3 {
    const u0 = Cartesian3.normalize(pos, new Cartesian3())
    const k = Cartesian3.dot(u0, dir)
    const u = Cartesian3.subtract(u0, Cartesian3.multiplyByScalar(dir, k, new Cartesian3()), new Cartesian3())
    return Cartesian3.normalize(u, u)
  }
}
