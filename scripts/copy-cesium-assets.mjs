// Copia los assets estáticos de Cesium (workers, widgets, texturas) a public/cesium.
// Cesium los pide en runtime vía CESIUM_BASE_URL. public/cesium está en .gitignore.
import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const src = resolve('node_modules/cesium/Build/Cesium')
const dst = resolve('public/cesium')
if (!existsSync(src)) {
  console.error('cesium no está instalado: corre `npm install`')
  process.exit(1)
}
mkdirSync(dst, { recursive: true })
for (const dir of ['Workers', 'ThirdParty', 'Assets', 'Widgets']) {
  cpSync(resolve(src, dir), resolve(dst, dir), { recursive: true })
}
console.log('Assets de Cesium copiados a public/cesium')
