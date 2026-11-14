// Debe importarse ANTES de crear cualquier objeto de Cesium: cambia el elipsoide global a la Luna
// (esfera de 1 737.4 km) y la rotación ICRF → fijo-lunar. Sin esto, Cesium dibujaría una Tierra.
import * as Cesium from 'cesium'

const { Ellipsoid } = Cesium

Ellipsoid.default = Ellipsoid.MOON

// Se exporta en runtime pero falta en los .d.ts públicos de 1.147 (solo aparece bajo `Transforms`).
const frames = (Cesium as unknown as {
  CelestialFrameTransforms: {
    computeIcrfToCentralBodyFixedMatrix: unknown
    computeIcrfToMoonFixedMatrix: unknown
  }
}).CelestialFrameTransforms
frames.computeIcrfToCentralBodyFixedMatrix = frames.computeIcrfToMoonFixedMatrix

export const MOON = Ellipsoid.MOON
export const MOON_RADIUS_M = Ellipsoid.MOON.maximumRadius
