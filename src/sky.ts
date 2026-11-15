import {
  Billboard,
  BillboardCollection,
  Cartesian3,
  Color,
  EllipsoidGeometry,
  GeometryInstance,
  HorizontalOrigin,
  Material,
  MaterialAppearance,
  Matrix3,
  Matrix4,
  Primitive,
  SkyBox,
  VerticalOrigin,
  type PerspectiveFrustum,
  type Viewer,
} from 'cesium'

// Cesium solo crea el cielo estrellado por defecto con el elipsoide terrestre: aquí se pone a mano.
declare const CESIUM_BASE_URL: string
const SKY_DIR = `${CESIUM_BASE_URL}/Assets/Textures/SkyBox/tycho2t3_80_`

export function createSkyBox(): SkyBox {
  return new SkyBox({
    sources: {
      positiveX: `${SKY_DIR}px.jpg`,
      negativeX: `${SKY_DIR}mx.jpg`,
      positiveY: `${SKY_DIR}py.jpg`,
      negativeY: `${SKY_DIR}my.jpg`,
      positiveZ: `${SKY_DIR}pz.jpg`,
      negativeZ: `${SKY_DIR}mz.jpg`,
    },
  })
}

// Magnitudes reales (medias) para dibujar los astros a su tamaño angular verdadero.
const EARTH_RADIUS_M = 6_371_000
const EARTH_MEAN_DISTANCE_M = 384_400_000
const SUN_ANGULAR_DIAMETER_RAD = (0.5330 * Math.PI) / 180
// El Sol real está a 1.5e11 m, fuera del plano lejano de Cesium. Se coloca más cerca con el
// radio escalado para conservar el tamaño angular. Queda detrás de la Tierra (eclipses correctos).
const SUN_DISTANCE_M = 9e8
const SUN_HALO_FACTOR = 10 // diámetro del halo = 10× el del disco

export const FAR_PLANE_M = 2e9

// Suavizado del movimiento: la consola manda un paso del timeline cada ~100 ms en Play (con pasos de 60 min,
// el Sol brinca ~2° cada vez). El astro se desliza hacia la dirección nueva en vez de saltar. Es solo
// presentación: la dirección final es la del backend, sin interpolar datos ni calcular física.
const GLIDE_TAU_S = 0.09
// Un salto mayor (arrastrar el scrubber varios días, cambiar de sitio) se aplica de golpe: deslizarlo cruzaría el cielo.
const GLIDE_SNAP_RAD = (12 * Math.PI) / 180

/** Avanza `current` hacia `target` (unitarios) con suavizado exponencial. Devuelve si todavía se mueve. */
export function glide(current: Cartesian3, target: Cartesian3, dt: number): boolean {
  const angle = Cartesian3.angleBetween(current, target)
  if (angle < 1e-6) return false
  if (angle > GLIDE_SNAP_RAD || dt <= 0) {
    Cartesian3.clone(target, current)
    return true
  }
  const a = 1 - Math.exp(-dt / GLIDE_TAU_S)
  Cartesian3.lerp(current, target, a, current)
  Cartesian3.normalize(current, current)
  return true
}

function sunSprite(): HTMLCanvasElement {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const r = size / 2
  const core = r / SUN_HALO_FACTOR
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(core / r, 'rgba(255,252,240,1)')
  grad.addColorStop((core * 1.25) / r, 'rgba(255,240,200,0.55)')
  grad.addColorStop(0.5, 'rgba(255,225,170,0.12)')
  grad.addColorStop(1, 'rgba(255,225,170,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}

/** Textura de la Tierra: une las teselas locales NaturalEarthII (nivel 2, 8×4) en un lienzo 2048×1024. */
function loadEarthTexture(): Promise<HTMLCanvasElement> {
  const cols = 8
  const rows = 4
  const canvas = document.createElement('canvas')
  canvas.width = cols * 256
  canvas.height = rows * 256
  const ctx = canvas.getContext('2d')!
  const loads: Promise<void>[] = []
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      loads.push(
        new Promise((res, rej) => {
          const img = new Image()
          img.onload = () => {
            // TMS: y=0 es la fila sur
            ctx.drawImage(img, x * 256, (rows - 1 - y) * 256)
            res()
          }
          img.onerror = () => rej(new Error('tesela de la Tierra no disponible'))
          img.src = `${CESIUM_BASE_URL}/Assets/Textures/NaturalEarthII/2/${x}/${y}.jpg`
        }),
      )
    }
  }
  return Promise.all(loads).then(() => canvas)
}

/**
 * Material de la Tierra iluminado por la luz de la escena (el Sol dibujado): da la fase.
 * `MaterialAppearance` sombrea con `czm_phong`, cuyo difuso usa dos direcciones fijas respecto a la cámara (eye-space
 * +Z y +Y) y no la luz: con él la Tierra se veía siempre llena. Aquí el difuso va en `emission` (Lambert con
 * `czm_lightDirectionEC`) y el difuso y el especular de Phong quedan en cero. El lado nocturno conserva un 3 % para
 * no perder la silueta.
 */
function earthMaterial(image: HTMLCanvasElement): Material {
  return new Material({
    fabric: {
      uniforms: { image },
      source: `
        czm_material czm_getMaterial(czm_materialInput materialInput) {
          czm_material material = czm_getDefaultMaterial(materialInput);
          vec3 albedo = texture(image, materialInput.st).rgb;
          float lambert = max(dot(normalize(materialInput.normalEC), czm_lightDirectionEC), 0.0);
          material.diffuse = vec3(0.0);
          material.specular = 0.0;
          material.emission = albedo * (0.03 + 0.97 * lambert * czm_lightColor);
          return material;
        }`,
    },
    translucent: false,
  })
}

/**
 * Sol y Tierra como referencia en el cielo lunar. Todo en el marco fijo lunar de Cesium.
 *
 * La Tierra es una primitiva propia que se crea una vez; en cada fotograma solo se mueve su `modelMatrix`.
 * - Con una entidad y una `ConstantPositionProperty` nueva por paso, Cesium reconstruía el elipsoide de forma
 *   asíncrona y mientras tanto no lo dibujaba (parpadeo).
 * - Con una entidad y posición de callback (geometría dinámica), Cesium 1.147 crea un `Material` nuevo en cada
 *   fotograma (`DynamicEllipsoidGeometryUpdater` nunca guarda el que crea). La textura se sube a la GPU un
 *   fotograma después de pedirla, así que nunca llegaba: la Tierra se veía blanca y lisa en cualquier GPU.
 */
export class CelestialSky {
  private sunBillboards = new BillboardCollection()
  private sunBillboard: Billboard
  /** Dirección pedida (la del backend) y la dibujada, que se desliza hacia ella. */
  private sunDir: Cartesian3 | null = null
  private sunShown: Cartesian3 | null = null
  private earthDir = new Cartesian3(1, 0, 0) // posición media: la Tierra está sobre lon 0°, lat 0° (±7° de libración)
  private earthShown = new Cartesian3(1, 0, 0)
  private earthObserver = Cartesian3.ZERO
  private lastFrame = 0
  private moveListeners: (() => void)[] = []
  private earthDistanceM = EARTH_MEAN_DISTANCE_M
  private earth: Primitive
  private showSun = true
  private showEarth = true

  constructor(private viewer: Viewer) {
    viewer.scene.primitives.add(this.sunBillboards)
    this.sunBillboard = this.sunBillboards.add({
      position: Cartesian3.ZERO,
      image: sunSprite(),
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.CENTER,
      show: false,
    })
    // Tamaño en píxeles recalculado por fotograma: conserva el tamaño angular real (0.53°)
    // con cualquier FOV o resolución. (El modo `sizeInMeters` se renderizaba mal a 1e8–1e9 m.)
    viewer.scene.preRender.addEventListener(() => this.onFrame())
    this.earth = viewer.scene.primitives.add(
      new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: new EllipsoidGeometry({
            radii: new Cartesian3(EARTH_RADIUS_M, EARTH_RADIUS_M, EARTH_RADIUS_M),
            slicePartitions: 48,
            stackPartitions: 48,
            vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
          }),
        }),
        appearance: new MaterialAppearance({
          material: Material.fromType('Color', { color: Color.fromCssColorString('#1d4e89') }), // hasta que cargue la textura
          closed: true,
        }),
        asynchronous: false,
      }),
    )
    loadEarthTexture()
      .then((canvas) => {
        this.earth.appearance.material = earthMaterial(canvas)
        this.viewer.scene.requestRender()
      })
      .catch(() => {
        /* sin textura queda la esfera azul; no bloquea el globo */
      })
    this.refresh()
  }

  /** Dirección hacia el Sol en el marco fijo lunar (unitario). null = desconocida: el Sol no se dibuja. */
  setSun(dir: Cartesian3 | null) {
    const next = dir ? Cartesian3.normalize(dir, new Cartesian3()) : null
    if (next && this.sunDir && Cartesian3.equalsEpsilon(next, this.sunDir, 1e-9)) return // sin cambios: no se rehace el dibujo
    if (!next && !this.sunDir) return
    this.sunDir = next
    // Sin Sol dibujado todavía (o al quitarlo), se aplica de golpe; si ya había uno, se desliza en onFrame()
    if (!next) this.sunShown = null
    else if (!this.sunShown) this.sunShown = Cartesian3.clone(next)
    this.refresh()
  }

  /** Dirección hacia la Tierra en el marco fijo lunar y el punto de observación (centro de la Luna por defecto). */
  setEarth(dir: Cartesian3 | null, observer: Cartesian3 = Cartesian3.ZERO, distanceM?: number) {
    const distance = distanceM && distanceM > 0 ? distanceM : EARTH_MEAN_DISTANCE_M
    const nextDir = dir ? Cartesian3.normalize(dir, new Cartesian3()) : new Cartesian3(1, 0, 0)
    if (distance === this.earthDistanceM && Cartesian3.equalsEpsilon(nextDir, this.earthDir, 1e-9) && Cartesian3.equals(observer, this.earthObserver)) return
    // Otro observador (otro sitio, o la vista global) es otro cielo: se aplica de golpe
    const jump = !Cartesian3.equals(observer, this.earthObserver)
    this.earthDistanceM = distance
    this.earthDir = nextDir
    this.earthObserver = observer
    if (jump) Cartesian3.clone(nextDir, this.earthShown)
    this.refresh()
  }

  setVisible(sun: boolean, earth: boolean) {
    this.showSun = sun
    this.showEarth = earth
    this.refresh()
  }

  /** Dirección unitaria hacia un astro, o null si no se conoce. Es la pedida (la del backend), no la que se está deslizando. */
  direction(body: 'sun' | 'earth'): Cartesian3 | null {
    return body === 'sun' ? this.sunDir : this.earthDir
  }

  /** Dirección dibujada en este fotograma (se desliza hacia `direction`). Para la luz y las etiquetas. */
  shownDirection(body: 'sun' | 'earth'): Cartesian3 | null {
    return body === 'sun' ? this.sunShown : this.earthShown
  }

  /** Posición dibujada en este fotograma: la usan las etiquetas, el encuadre y la escena. */
  position(body: 'sun' | 'earth'): Cartesian3 | null {
    return this.shownPosition(body, new Cartesian3()) ?? null
  }

  /** Avisa en cada fotograma en que el Sol o la Tierra se movieron (para mover la luz con ellos). */
  onMove(fn: () => void) {
    this.moveListeners.push(fn)
  }

  private shownPosition(body: 'sun' | 'earth', result: Cartesian3): Cartesian3 | undefined {
    if (body === 'earth') {
      return Cartesian3.add(this.earthObserver, Cartesian3.multiplyByScalar(this.earthShown, this.earthDistanceM, result), result)
    }
    return this.sunShown ? Cartesian3.multiplyByScalar(this.sunShown, SUN_DISTANCE_M, result) : undefined
  }

  // Orienta la textura para que el hemisferio con las Américas (lon −75°) mire hacia la Luna.
  // La rotación y orientación de la Tierra son ilustrativas, no efeméride.
  private updateEarthMatrix() {
    const faceAz = Math.atan2(-this.earthShown.y, -this.earthShown.x)
    const theta = faceAz - (-75 * Math.PI) / 180 - Math.PI
    const position = this.shownPosition('earth', new Cartesian3())!
    // Se escribe sobre la misma matriz: Primitive detecta el cambio de valor y mueve la Tierra sin reconstruirla
    Matrix4.fromRotationTranslation(Matrix3.fromRotationZ(theta, new Matrix3()), position, this.earth.modelMatrix)
  }

  private onFrame() {
    const now = performance.now()
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : 0
    this.lastFrame = now
    let moved = false
    if (this.sunDir && this.sunShown && glide(this.sunShown, this.sunDir, dt)) {
      moved = true
      this.sunBillboard.position = this.shownPosition('sun', new Cartesian3())!
    }
    if (glide(this.earthShown, this.earthDir, dt)) moved = true
    this.updateEarthMatrix()
    if (moved) this.moveListeners.forEach((fn) => fn())
    this.updateSunSize()
  }

  private refresh() {
    this.earth.show = this.showEarth
    this.updateEarthMatrix()
    const sunPos = this.shownPosition('sun', new Cartesian3())
    this.sunBillboard.show = this.showSun && !!sunPos
    if (sunPos) this.sunBillboard.position = sunPos
    this.updateSunSize()
  }

  private updateSunSize() {
    const { camera, canvas } = this.viewer.scene
    const fovy = (camera.frustum as PerspectiveFrustum).fovy
    if (!fovy) return
    const px = (SUN_ANGULAR_DIAMETER_RAD * SUN_HALO_FACTOR * canvas.clientHeight) / fovy
    this.sunBillboard.width = this.sunBillboard.height = Math.max(px, 24)
  }
}
