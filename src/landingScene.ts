import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  type Viewer,
} from 'cesium'
import { MOON } from './moon'
import type { Vehicles } from './vehicles'

export type ScenePhase = 'arrival' | 'descent' | 'landed' | 'done'

export interface LandingSceneOptions {
  lat: number
  lon: number
  /** Hacia dónde mira la cámara (azimut, 0 = norte, 90 = este). Por defecto, perpendicular al Sol si se conoce. */
  headingDeg?: number
  /** Altura desde la que empieza el descenso, en metros sobre el suelo (default 600). */
  startAltM?: number
  /** Duración del descenso en segundos (default 14). */
  durationS?: number
  /** Distancia de la cámara al punto de contacto, en metros (default 120). */
  distanceM?: number
  /** Si aparece un astronauta junto al módulo al posarse (default true). */
  astronaut?: boolean
}

export interface SceneHost {
  viewer: Viewer
  vehicles: Vehicles
  groundHeight(lat: number, lon: number): Promise<number>
  sunDirection(): Cartesian3 | null
  begin(): void
  end(): void
  phase(p: ScenePhase): void
  lockCamera(): void
  /** Luz de escena para los modelos: vector hacia la luz en el marco fijo lunar (null restaura la luz normal). */
  setKeyLight(towardLight: Cartesian3 | null): void
}

/**
 * Escena de alunizaje en un plano horizontal sobre el terreno: la cámara baja desde la vista global hasta
 * el suelo, un espectador ve descender el módulo en vertical con su motor, se posa levantando polvo y
 * aparece un astronauta. La velocidad del descenso es ILUSTRATIVA (desaceleración constante), no física.
 */
export class LandingScene {
  active = false
  engineOn = false
  dustAt: Cartesian3 | null = null
  phase: ScenePhase | null = null
  altM = 0
  vMps = 0
  elapsedS = 0

  private site0 = Cartesian3.ZERO
  private up = Cartesian3.UNIT_Z
  private camPos = Cartesian3.ZERO
  private azimuth = 0
  private startAlt = 600
  private duration = 14
  private opts!: LandingSceneOptions
  private landedT = 0
  private astronautShown = false
  private gliding = false
  private token = 0
  private ready = false // hay punto de contacto calculado

  constructor(private host: SceneHost) {}

  landerPosition(): Cartesian3 | null {
    if (!this.active || !this.ready) return null
    return Cartesian3.add(this.site0, Cartesian3.multiplyByScalar(this.up, this.altM + 0.1, new Cartesian3()), new Cartesian3())
  }

  async play(o: LandingSceneOptions) {
    this.stop()
    const token = ++this.token
    this.opts = o
    this.host.begin()
    this.ready = false
    this.active = true
    this.setPhase('arrival')
    this.elapsedS = 0
    this.landedT = 0
    this.astronautShown = false
    this.gliding = false
    this.engineOn = false
    this.dustAt = null

    const ground = await this.host.groundHeight(o.lat, o.lon)
    if (token !== this.token) return
    this.startAlt = o.startAltM ?? 600
    this.duration = o.durationS ?? 14
    this.altM = this.startAlt
    this.vMps = 0

    this.site0 = Cartesian3.fromDegrees(o.lon, o.lat, ground, MOON)
    this.up = Cartesian3.normalize(this.site0, new Cartesian3())
    this.ready = true
    const frame = Transforms.eastNorthUpToFixedFrame(this.site0)
    const east = Matrix4.multiplyByPointAsVector(frame, Cartesian3.UNIT_X, new Cartesian3())
    const north = Matrix4.multiplyByPointAsVector(frame, Cartesian3.UNIT_Y, new Cartesian3())

    // Cámara de espectador: perpendicular al Sol si se conoce (módulo iluminado de lado)
    const sun = this.host.sunDirection()
    const sunAz = sun ? Math.atan2(Cartesian3.dot(sun, east), Cartesian3.dot(sun, north)) : null
    // Sol a ~70° del eje de la cámara: el módulo se ve iluminado de lado y el Sol queda en el borde del cuadro
    this.azimuth = o.headingDeg !== undefined ? CesiumMath.toRadians(o.headingDeg) : sunAz !== null ? sunAz + CesiumMath.toRadians(70) : 0
    // Con el Sol real (a pocos grados del horizonte) los modelos quedarían casi negros. Para que la escena se
    // entienda se ilumina el módulo desde el azimut del Sol pero con 30° de elevación. Es un recurso de cámara.
    const keyAz = sunAz ?? this.azimuth + Math.PI / 2
    const keyEl = CesiumMath.toRadians(30)
    const key = Cartesian3.add(
      Cartesian3.add(Cartesian3.multiplyByScalar(east, Math.sin(keyAz) * Math.cos(keyEl), new Cartesian3()), Cartesian3.multiplyByScalar(north, Math.cos(keyAz) * Math.cos(keyEl), new Cartesian3()), new Cartesian3()),
      Cartesian3.multiplyByScalar(this.up, Math.sin(keyEl), new Cartesian3()),
      new Cartesian3(),
    )
    this.host.setKeyLight(key)
    const dirH = Cartesian3.add(
      Cartesian3.multiplyByScalar(east, Math.sin(this.azimuth), new Cartesian3()),
      Cartesian3.multiplyByScalar(north, Math.cos(this.azimuth), new Cartesian3()),
      new Cartesian3(),
    )
    this.camPos = Cartesian3.add(
      Cartesian3.add(this.site0, Cartesian3.multiplyByScalar(dirH, -(o.distanceM ?? 120), new Cartesian3()), new Cartesian3()),
      Cartesian3.multiplyByScalar(this.up, 3, new Cartesian3()),
      new Cartesian3(),
    )

    this.host.vehicles.setLander(true, () => this.landerPosition())

    // Llegada: vuelo desde la vista actual (global) hasta el espectador, mirando hacia donde aparecerá el módulo
    const start = this.landerPosition()!
    const d = Cartesian3.normalize(Cartesian3.subtract(start, this.camPos, new Cartesian3()), new Cartesian3())
    this.host.viewer.camera.flyTo({
      destination: this.camPos,
      orientation: { direction: d, up: this.upFor(this.camPos, d) },
      duration: 7,
      complete: () => {
        if (token === this.token) this.beginDescent()
      },
    })
  }

  stop() {
    if (!this.active) return
    this.token++
    this.active = false
    this.ready = false
    this.engineOn = false
    this.dustAt = null
    this.phase = null
    this.host.viewer.camera.cancelFlight()
    this.host.vehicles.setLander(false, () => null)
    this.host.vehicles.setAstronaut(null)
    this.host.vehicles.setDust(null)
    this.host.setKeyLight(null)
    this.host.end()
  }

  /** Se llama una vez por fotograma. `dt` en segundos. */
  update(dt: number) {
    if (!this.active) return
    if (this.phase === 'descent') {
      this.elapsedS += dt
      const frac = Math.min(this.elapsedS / this.duration, 1)
      // desaceleración constante: velocidad inicial 2H/T que llega a 0 al tocar
      this.altM = this.startAlt * (1 - frac) ** 2
      this.vMps = ((2 * this.startAlt) / this.duration) * (1 - frac)
      this.engineOn = frac < 1
      this.dustAt = this.altM < 30 ? this.site0 : null
      this.trackLander()
      if (frac >= 1) {
        this.altM = 0
        this.vMps = 0
        this.setPhase('landed')
      }
    } else if (this.phase === 'landed') {
      this.landedT += dt
      if (this.landedT > 3.5) this.dustAt = null
      if (!this.gliding && this.landedT > 1.6) void this.finish()
    }
  }

  private beginDescent() {
    this.refineGround()
    this.elapsedS = 0
    this.setPhase('descent')
  }

  /**
   * La altura leída con sampleTerrain (nivel 8) puede quedar por debajo de la malla que se dibuja a ras de
   * suelo (niveles finos). Cuando esa malla ya está cargada se toma su altura y se mueve la escena a ella.
   */
  private refineGround() {
    const globe = this.host.viewer.scene.globe
    const c = Cartographic.fromCartesian(this.site0, MOON)
    const h = globe.getHeight(c)
    if (h === undefined || Math.abs(h - c.height) < 0.3) return
    const delta = h - c.height
    this.camPos = Cartesian3.add(this.camPos, Cartesian3.multiplyByScalar(this.up, delta, new Cartesian3()), new Cartesian3())
    c.height = h
    this.site0 = Cartographic.toCartesian(c, MOON)
    this.up = Cartesian3.normalize(this.site0, new Cartesian3())
  }

  /** Mantiene la cámara por encima del terreno dibujado (si no, se vería la superficie desde abajo). */
  private clampCameraAboveGround() {
    const cc = Cartographic.fromCartesian(this.camPos, MOON)
    const gh = this.host.viewer.scene.globe.getHeight(cc)
    if (gh !== undefined && cc.height < gh + 4) {
      cc.height = gh + 4
      this.camPos = Cartographic.toCartesian(cc, MOON)
    }
  }

  /** Aparece el astronauta y la cámara se acerca a los dos. */
  private async finish() {
    this.gliding = true
    const token = this.token
    const frame = Transforms.eastNorthUpToFixedFrame(this.site0)
    const east = Matrix4.multiplyByPointAsVector(frame, Cartesian3.UNIT_X, new Cartesian3())
    const north = Matrix4.multiplyByPointAsVector(frame, Cartesian3.UNIT_Y, new Cartesian3())
    const dirH = Cartesian3.add(
      Cartesian3.multiplyByScalar(east, Math.sin(this.azimuth), new Cartesian3()),
      Cartesian3.multiplyByScalar(north, Math.cos(this.azimuth), new Cartesian3()),
      new Cartesian3(),
    )
    // "a la derecha" de la cámara: dirH × arriba
    const right = Cartesian3.normalize(Cartesian3.cross(dirH, this.up, new Cartesian3()), new Cartesian3())
    const astroPoint = Cartesian3.add(
      Cartesian3.add(this.site0, Cartesian3.multiplyByScalar(right, 9, new Cartesian3()), new Cartesian3()),
      Cartesian3.multiplyByScalar(dirH, -3, new Cartesian3()),
      new Cartesian3(),
    )
    if (this.opts.astronaut !== false) {
      const c = Cartographic.fromCartesian(astroPoint, MOON)
      const lat = CesiumMath.toDegrees(c.latitude)
      const lon = CesiumMath.toDegrees(c.longitude)
      const rendered = this.host.viewer.scene.globe.getHeight(c)
      const ground = rendered ?? (await this.host.groundHeight(lat, lon))
      if (token !== this.token) return
      // mira hacia la cámara
      const toCam = (CesiumMath.toDegrees(this.azimuth) + 180 + 360) % 360
      this.host.vehicles.setAstronaut({ lat, lon, headingDeg: toCam }, ground)
      this.astronautShown = true
    }
    const mid = Cartesian3.add(
      Cartesian3.lerp(this.site0, astroPoint, 0.5, new Cartesian3()),
      Cartesian3.multiplyByScalar(this.up, 2.5, new Cartesian3()),
      new Cartesian3(),
    )
    this.host.viewer.camera.flyToBoundingSphere(new BoundingSphere(mid, 5), {
      offset: new HeadingPitchRange(this.azimuth, CesiumMath.toRadians(-14), 40),
      duration: 3.5,
      complete: () => {
        if (token !== this.token) return
        // la cámara queda orbitable alrededor de la escena
        this.host.viewer.camera.lookAt(mid, new HeadingPitchRange(this.azimuth, CesiumMath.toRadians(-14), 40))
        this.host.lockCamera()
        this.setPhase('done')
      },
    })
  }

  private trackLander() {
    const target = this.landerPosition()
    if (!target) return
    this.clampCameraAboveGround()
    const d = Cartesian3.normalize(Cartesian3.subtract(target, this.camPos, new Cartesian3()), new Cartesian3())
    this.host.viewer.camera.setView({ destination: this.camPos, orientation: { direction: d, up: this.upFor(this.camPos, d) } })
  }

  /** "Arriba" local del espectador (vertical del lugar), perpendicular a la mirada. */
  private upFor(pos: Cartesian3, dir: Cartesian3): Cartesian3 {
    const u0 = Cartesian3.normalize(pos, new Cartesian3())
    const k = Cartesian3.dot(u0, dir)
    const u = Cartesian3.subtract(u0, Cartesian3.multiplyByScalar(dir, k, new Cartesian3()), new Cartesian3())
    return Cartesian3.normalize(u, u)
  }

  private setPhase(p: ScenePhase) {
    this.phase = p
    this.host.phase(p)
  }

  get astronautVisible() {
    return this.astronautShown
  }
}
