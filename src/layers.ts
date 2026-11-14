import {
  Credit,
  GeographicTilingScheme,
  Rectangle,
  UrlTemplateImageryProvider,
  type ImageryLayer,
} from 'cesium'
import { MOON } from './moon'
import type { LayerId } from './types'

// Teselas WMTS de NASA Moon Trek (EPSG:4326, 2×1 en nivel 0 = GeographicTilingScheme de Cesium;
// {y} es fila desde el norte, igual que Cesium). CORS abierto (verificado).
const TREK = 'https://trek.nasa.gov/tiles/Moon/EQ'
const tileUrl = (layer: string, ext: string) =>
  `${TREK}/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`

interface LayerDef {
  url: string
  maximumLevel: number
  credit: string
  alpha?: number
}

export const LAYER_DEFS: Record<LayerId, LayerDef> = {
  // Mosaico global LROC WAC, ~100 m/px (nivel 8).
  wac: {
    url: tileUrl('LRO_WAC_Mosaic_Global_303ppd_v02', 'jpg'),
    maximumLevel: 8,
    credit: 'NASA/GSFC/ASU — LROC WAC (vía NASA Moon Trek)',
  },
  // Elevación LOLA codificada en color con sombreado, nivel 5.
  lolaShade: {
    url: tileUrl('LRO_LOLA_ClrShade_Global_128ppd_v04', 'png'),
    maximumLevel: 5,
    credit: 'NASA/GSFC/MIT — LRO LOLA (vía NASA Moon Trek)',
    alpha: 0.5,
  },
}

export function createImageryProvider(id: LayerId, opts: { polarFix?: boolean } = {}): UrlTemplateImageryProvider {
  const def = LAYER_DEFS[id]
  return new UrlTemplateImageryProvider({
    // La capa LOLA global tiene el mismo abanico polar: con polarFix se recorta bajo -85°
    rectangle: id === 'lolaShade' && opts.polarFix ? Rectangle.fromDegrees(-180, -85, 180, 90) : undefined,
    url: def.url,
    tilingScheme: new GeographicTilingScheme({ ellipsoid: MOON }),
    maximumLevel: def.maximumLevel,
    tileWidth: 256,
    tileHeight: 256,
    credit: new Credit(def.credit),
  })
}

export type LayerMap = Partial<Record<LayerId, ImageryLayer>>
