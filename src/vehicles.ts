import {
  Cartesian2,
  CallbackPositionProperty,
  Cartesian3,
  Color,
  ConeEmitter,
  Credit,
  DistanceDisplayCondition,
  Entity,
  HeadingPitchRoll,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  ParticleSystem,
  Transforms,
  type Viewer,
} from 'cesium'
import { MOON } from './moon'

// Modelos de NASA 3D Resources (ver public/models/ATTRIBUTION.md). Sin modificar.
const BASE = import.meta.env.BASE_URL
const LANDER_URL = `${BASE}models/apollo-lunar-module.glb`
const ASTRONAUT_URL = `${BASE}models/astronaut.glb`

// El astronauta viene en pulgadas (74 in ≈ 1.88 m) y con el origen en el centro del cuerpo.
const ASTRONAUT_SCALE = 0.0254
const ASTRONAUT_HALF_HEIGHT_M = 37 * ASTRONAUT_SCALE // ≈ 0.94 m: sube el modelo para que los pies toquen el suelo

/** Vehículos de la fase 3: módulo de aterrizaje con columna de motor y astronauta, con calidad baja a propósito. */
export class Vehicles {
  private lander: Entity | null = null
  private astronaut: Entity | null = null
  private plume: ParticleSystem | null = null
  private dust: ParticleSystem | null = null
  private credited = false
  astronautPos: Cartesian3 | null = null

  constructor(private viewer: Viewer) {}

  /** Muestra u oculta el módulo. `position` es de dónde toma su posición en cada fotograma. */
  setLander(show: boolean, position: () => Cartesian3 | null) {
    if (!show) {
      if (this.lander) this.viewer.entities.remove(this.lander)
      this.lander = null
      if (this.plume) this.viewer.scene.primitives.remove(this.plume)
      this.plume = null
      return
    }
    if (this.lander) return
    this.credit()
    this.lander = this.viewer.entities.add({
      id: 'veh:lander',
      name: 'Módulo de aterrizaje (modelo Apollo LM, genérico)',
      position: new CallbackPositionProperty(() => position() ?? Cartesian3.ZERO, false),
      model: {
        uri: LANDER_URL,
        // visible desde órbita como un punto grande y a su tamaño real (≈6 m) de cerca
        minimumPixelSize: 28,
        maximumScale: 20000,
      },
    })
    this.plume = this.viewer.scene.primitives.add(
      new ParticleSystem({
        image: plumeSprite(),
        startColor: Color.fromCssColorString('#ffd9a0').withAlpha(0.85),
        endColor: Color.fromCssColorString('#ff6b35').withAlpha(0),
        startScale: 0.6,
        endScale: 5,
        minimumParticleLife: 0.25,
        maximumParticleLife: 0.7,
        minimumSpeed: 20,
        maximumSpeed: 40,
        imageSize: new Cartesian2(1, 1),
        sizeInMeters: true,
        emissionRate: 160,
        lifetime: Number.MAX_VALUE,
        loop: true,
        emitter: new ConeEmitter(CesiumMath.toRadians(14)),
        // el cono emite hacia +Z del emisor: se gira 180° para apuntar hacia abajo desde la tobera
        emitterModelMatrix: Matrix4.fromRotationTranslation(Matrix3.fromRotationX(Math.PI), new Cartesian3(0, 0, 0.8)),
        show: false,
      }),
    )
  }

  /**
   * Polvo levantado al posarse. `at` es el punto de contacto con el suelo (null lo apaga).
   * Emite casi en horizontal: en vacío el polvo sale en trayectorias balísticas, sin nube que flote.
   */
  setDust(at: Cartesian3 | null) {
    if (!this.dust) {
      this.dust = this.viewer.scene.primitives.add(
        new ParticleSystem({
          image: dustSprite(),
          startColor: Color.fromCssColorString('#b9b3a8').withAlpha(0.55),
          endColor: Color.fromCssColorString('#8a857b').withAlpha(0),
          startScale: 1,
          endScale: 7,
          minimumParticleLife: 1.4,
          maximumParticleLife: 3,
          minimumSpeed: 6,
          maximumSpeed: 16,
          imageSize: new Cartesian2(1, 1),
          sizeInMeters: true,
          emissionRate: 120,
          lifetime: Number.MAX_VALUE,
          loop: true,
          emitter: new ConeEmitter(CesiumMath.toRadians(86)),
          emitterModelMatrix: Matrix4.fromTranslation(new Cartesian3(0, 0, 0.4)),
          show: false,
        }),
      )
    }
    this.dust.show = !!at
    if (at) this.dust.modelMatrix = Transforms.eastNorthUpToFixedFrame(at)
  }

  /** Coloca (o quita, con null) un astronauta de pie en el suelo. `groundM` es la altura del terreno. */
  setAstronaut(at: { lat: number; lon: number; headingDeg?: number } | null, groundM = 0) {
    if (this.astronaut) this.viewer.entities.remove(this.astronaut)
    this.astronaut = null
    this.astronautPos = null
    if (!at) return
    this.credit()
    const pos = Cartesian3.fromDegrees(at.lon, at.lat, groundM + ASTRONAUT_HALF_HEIGHT_M, MOON)
    this.astronaut = this.viewer.entities.add({
      id: 'veh:astronaut',
      name: 'Astronauta (modelo NASA)',
      position: pos,
      // headingDeg = azimut hacia el que mira (0 = norte, 90 = este). Cesium mide el rumbo del modelo desde el este.
      orientation: Transforms.headingPitchRollQuaternion(pos, new HeadingPitchRoll(CesiumMath.toRadians((at.headingDeg ?? 0) - 90), 0, 0)),
      model: {
        uri: ASTRONAUT_URL,
        scale: ASTRONAUT_SCALE,
        // solo se dibuja de cerca: a escala orbital sería invisible y costaría GPU
        distanceDisplayCondition: new DistanceDisplayCondition(0, 4_000),
      },
    })
    this.astronautPos = pos
  }

  /** Se llama una vez por fotograma. `descending` enciende la columna de motor. */
  update(landerPos: Cartesian3 | null, descending: boolean) {
    if (!this.plume) return
    this.plume.show = !!landerPos && descending
    if (this.lander) this.lander.show = !!landerPos
    if (landerPos) this.plume.modelMatrix = Transforms.eastNorthUpToFixedFrame(landerPos)
  }

  hasLander() {
    return !!this.lander
  }

  private credit() {
    if (this.credited) return
    this.credited = true
    // frameState no está en los tipos públicos de Scene
    const display = (this.viewer.scene as unknown as { frameState: { creditDisplay: { addStaticCredit(c: Credit): void } } }).frameState.creditDisplay
    display.addStaticCredit(new Credit('NASA 3D Resources — Apollo Lunar Module, Astronaut', false))
  }
}

function dustSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}

function plumeSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.4, 'rgba(255,200,120,0.7)')
  grad.addColorStop(1, 'rgba(255,120,40,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}
