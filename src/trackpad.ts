// Gestos de trackpad para el globo. Cesium trata todo evento `wheel` como zoom, así que el arrastre con dos
// dedos de un trackpad acercaba y alejaba en vez de mover, y el pellizco (que macOS manda como `wheel` con
// `ctrlKey`) no hacía nada o hacía zoom de la página. Aquí se interceptan esos gestos antes de que lleguen a
// Cesium; la rueda de un ratón sigue llegando a Cesium tal cual.
import { Cartographic, type PerspectiveFrustum, type Viewer } from 'cesium'
import { MOON } from './moon'

export type WheelIntent = 'pinch' | 'pan' | 'wheel'

export interface WheelLike {
  ctrlKey: boolean
  deltaX: number
  deltaY: number
  deltaMode: number
  /** No estándar (Chrome y Safari). Con trackpad vale −3 × `deltaY`; con ratón, múltiplos de 120. */
  wheelDeltaY?: number
}

/**
 * Qué gesto es un evento `wheel`:
 * - `pinch`: pellizco del trackpad (macOS lo manda con `ctrlKey`). También Ctrl + rueda del ratón: zoom igual.
 * - `pan`: arrastre con dos dedos del trackpad.
 * - `wheel`: rueda de un ratón; se deja a Cesium (zoom).
 */
export function classifyWheel(e: WheelLike): WheelIntent {
  if (e.ctrlKey) return 'pinch'
  if (e.deltaMode !== 0) return 'wheel' // por líneas o páginas: rueda de ratón (Firefox)
  if (e.deltaX !== 0) return 'pan' // componente horizontal: solo la da un trackpad
  if (e.wheelDeltaY !== undefined && e.wheelDeltaY !== 0) return e.wheelDeltaY === -3 * e.deltaY ? 'pan' : 'wheel'
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50 ? 'wheel' : 'pan'
}

/** Factor de altura de un pellizco: `deltaY` negativo (abrir los dedos) acerca. */
export const pinchFactor = (deltaY: number) => Math.exp(Math.max(-60, Math.min(60, deltaY)) * 0.01)

export interface TrackpadHost {
  viewer: Viewer
  /** Vista de horizonte lista: los dos dedos miran a la redonda y el pellizco no aleja. */
  lookMode(): boolean
  /** Escena de alunizaje o un vuelo en curso: no se toca la cámara. */
  locked(): boolean
  /** Avisa que el usuario movió la cámara (pausa el giro automático un momento). */
  touched(): void
  /** Límites de altura del pellizco: los mismos del zoom de Cesium (cambian cerca del suelo). */
  heightLimits(): { min: number; max: number }
}

/** Conecta los gestos al contenedor del globo, en fase de captura. Devuelve la función para quitarlos. */
export function attachTrackpad(container: HTMLElement, host: TrackpadHost): () => void {
  const onWheel = (e: WheelEvent) => {
    const intent = classifyWheel(e as WheelEvent & WheelLike)
    if (intent === 'wheel') return // rueda de ratón: la atiende Cesium
    // Sin esto, el pellizco hace zoom de toda la página y Cesium recibiría el evento como zoom
    e.preventDefault()
    e.stopPropagation()
    if (host.locked()) return
    const { camera, canvas } = host.viewer.scene
    const fovy = (camera.frustum as PerspectiveFrustum).fovy ?? 1
    const radPerPx = fovy / Math.max(1, canvas.clientHeight)
    host.touched()

    if (host.lookMode()) {
      // Mirar a la redonda: el contenido sigue a los dedos (el horizonte queda nivelado por constrainedAxis)
      if (intent === 'pan') {
        camera.lookRight(e.deltaX * radPerPx)
        camera.lookDown(e.deltaY * radPerPx)
      }
      return
    }

    const h = Cartographic.fromCartesian(camera.positionWC, MOON).height
    if (intent === 'pinch') {
      const { min, max } = host.heightLimits()
      const next = Math.max(min, Math.min(max, h * pinchFactor(e.deltaY)))
      const d = h - next
      if (d > 0) camera.zoomIn(d)
      else if (d < 0) camera.zoomOut(-d)
      return
    }
    // Mover: gira el globo bajo la cámara lo que recorren los dedos sobre el suelo (más lento cerca)
    const groundPerPx = (2 * h * Math.tan(fovy / 2)) / Math.max(1, canvas.clientHeight)
    const radPerPxGround = groundPerPx / MOON.maximumRadius
    camera.rotateRight(e.deltaX * radPerPxGround)
    camera.rotateDown(e.deltaY * radPerPxGround)
  }
  container.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => container.removeEventListener('wheel', onWheel, { capture: true })
}
