import {
  Billboard,
  BillboardCollection,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  Entity,
  HorizontalOrigin,
  ImageMaterialProperty,
  Matrix3,
  Quaternion,
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

/** Sol y Tierra como referencia en el cielo lunar. Todo en el marco fijo lunar de Cesium. */
export class CelestialSky {
  private sunBillboards = new BillboardCollection()
  private sunBillboard: Billboard
  private sunDir: Cartesian3 | null = null
  private earthDir = new Cartesian3(1, 0, 0) // posición media: la Tierra está sobre lon 0°, lat 0° (±7° de libración)
  private earthObserver = Cartesian3.ZERO
  private earthDistanceM = EARTH_MEAN_DISTANCE_M
  private earth: Entity
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
    viewer.scene.preRender.addEventListener(() => this.updateSunSize())
    this.earth = viewer.entities.add({
      id: 'sky:earth',
      position: new ConstantPositionProperty(Cartesian3.ZERO),
      ellipsoid: {
        radii: new Cartesian3(EARTH_RADIUS_M, EARTH_RADIUS_M, EARTH_RADIUS_M),
        material: Color.fromCssColorString('#1d4e89'), // hasta que cargue la textura
        slicePartitions: 48,
        stackPartitions: 48,
      },
    })
    loadEarthTexture()
      .then((canvas) => {
        if (this.earth.ellipsoid) this.earth.ellipsoid.material = new ImageMaterialProperty({ image: canvas })
        this.viewer.scene.requestRender()
      })
      .catch(() => {
        /* sin textura queda la esfera azul; no bloquea el globo */
      })
    this.refresh()
  }

  /** Dirección hacia el Sol en el marco fijo lunar (unitario). null = desconocida: el Sol no se dibuja. */
  setSun(dir: Cartesian3 | null) {
    this.sunDir = dir ? Cartesian3.normalize(dir, new Cartesian3()) : null
    this.refresh()
  }

  /** Dirección hacia la Tierra en el marco fijo lunar y el punto de observación (centro de la Luna por defecto). */
  setEarth(dir: Cartesian3 | null, observer: Cartesian3 = Cartesian3.ZERO, distanceM?: number) {
    this.earthDistanceM = distanceM && distanceM > 0 ? distanceM : EARTH_MEAN_DISTANCE_M
    this.earthDir = dir ? Cartesian3.normalize(dir, new Cartesian3()) : new Cartesian3(1, 0, 0)
    this.earthObserver = observer
    this.refresh()
  }

  setVisible(sun: boolean, earth: boolean) {
    this.showSun = sun
    this.showEarth = earth
    this.refresh()
  }

  /** Dirección unitaria hacia un astro, o null si no se conoce. */
  direction(body: 'sun' | 'earth'): Cartesian3 | null {
    return body === 'sun' ? this.sunDir : this.earthDir
  }

  position(body: 'sun' | 'earth'): Cartesian3 | null {
    if (body === 'earth') {
      return Cartesian3.add(
        this.earthObserver,
        Cartesian3.multiplyByScalar(this.earthDir, this.earthDistanceM, new Cartesian3()),
        new Cartesian3(),
      )
    }
    return this.sunDir ? Cartesian3.multiplyByScalar(this.sunDir, SUN_DISTANCE_M, new Cartesian3()) : null
  }

  private refresh() {
    // Tierra
    const earthPos = this.position('earth')!
    this.earth.show = this.showEarth
    this.earth.position = new ConstantPositionProperty(earthPos)
    // Orienta la textura para que el hemisferio con las Américas (lon −75°) mire hacia la Luna.
    // La rotación y orientación de la Tierra son ilustrativas, no efeméride.
    const faceAz = Math.atan2(-this.earthDir.y, -this.earthDir.x)
    const theta = faceAz - (-75 * Math.PI) / 180 - Math.PI
    this.earth.orientation = new ConstantProperty(Quaternion.fromRotationMatrix(Matrix3.fromRotationZ(theta)))

    // Sol
    const sunPos = this.position('sun')
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
