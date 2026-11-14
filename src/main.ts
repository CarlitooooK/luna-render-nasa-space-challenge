import 'cesium/Build/Cesium/Widgets/widgets.css'
import { LunarGlobe } from './LunarGlobe'
import { connectToHost } from './embed'
import { MOCK_SITES, generateDescentArc } from './data/mockSites'

const q = new URLSearchParams(location.search)
// ?polarfix=0 y ?terrain=0 permiten comparar contra la versión sin arreglo del polo / sin relieve
const globe = new LunarGlobe(document.getElementById('globe')!, {
  polarFix: q.get('polarfix') !== '0',
  terrain: q.get('terrain') !== '0',
})
const panel = document.getElementById('panel')!
const embedded = window.parent !== window

if (embedded) {
  // Modo iframe: el host manda los datos. Orígenes permitidos por env o ?allowedOrigins=a,b
  const fromQuery = new URLSearchParams(location.search).get('allowedOrigins')?.split(',') ?? []
  const fromEnv = (import.meta.env.VITE_ALLOWED_ORIGINS as string | undefined)?.split(',') ?? []
  const allowed = [...fromEnv, ...fromQuery].map((o) => o.trim()).filter(Boolean)
  connectToHost(globe, allowed.length ? allowed : ['http://localhost:5173'])
  panel.classList.add('hidden')
} else {
  // Modo demo independiente
  globe.setSites(MOCK_SITES)
  const readout = document.createElement('div')
  readout.id = 'readout'
  panel.innerHTML = '<h1>🌕 Lunar Globe (demo, datos mock)</h1>'
  MOCK_SITES.forEach((s) => {
    const b = document.createElement('button')
    b.textContent = s.name
    b.onclick = () => pick(s.id)
    panel.appendChild(b)
  })
  const toggle = (label: string, fn: (on: boolean) => void, on = false) => {
    const l = document.createElement('label')
    const c = document.createElement('input')
    c.type = 'checkbox'
    c.checked = on
    c.onchange = () => fn(c.checked)
    l.append(c, ' ', label)
    panel.appendChild(l)
  }
  toggle('Rejilla lat/lon', (v) => globe.setConfig({ showGrid: v }))
  toggle('Capa elevación LOLA', (v) => globe.setConfig({ layers: { lolaShade: v } }))
  toggle('Iluminación solar (mock)', (v) => globe.setSunDirection(v ? [1, 0.2, -0.3] : null))
  toggle('Relieve (LOLA)', (v) => globe.setConfig({ terrain: v }), q.get('terrain') !== '0')
  toggle('Exagerar relieve ×3', (v) => globe.setConfig({ terrainExaggeration: v ? 3 : 1 }))
  toggle('Estrellas', (v) => globe.setConfig({ showStars: v }), true)
  toggle('Sol y Tierra', (v) => globe.setConfig({ showSun: v, showEarth: v }), true)
  toggle('Auto-rotación', (v) => globe.setConfig({ autoRotate: v }), true)
  const action = (label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = fn
    panel.appendChild(b)
  }
  // Vectores reales de POST /evaluate (API en vivo, Shackleton Rim, 2026-12-01T00:00Z, paso 0). Solo demo.
  const SAMPLE = { lat: -89.66, lon: 222.7, sun: [0.842, 0.029, -0.539], earth: [0.588, -0.033, 0.808] } as const
  action('☀ Sol de muestra + mirar al Sol', () => {
    globe.setSunFromLocal(SAMPLE.lat, SAMPLE.lon, [...SAMPLE.sun])
    globe.lookAtBody('sun')
  })
  action('🌍 Mirar a la Tierra (posición media)', () => globe.lookAtBody('earth'))
  action('Vista desde superficie (Shackleton)', () => {
    globe.setSunFromLocal(SAMPLE.lat, SAMPLE.lon, [...SAMPLE.sun])
    globe.viewFromSurface(-89.54, 0, 'sun')
  })
  action('🎥 Seguir descenso', () => globe.setFollowTrajectory(true))
  // IM-2 Mons Mouton (GET /sites). Vectores reales de POST /evaluate para 2026-12-21T08:00:00Z (Sol 6.5°, Tierra 10.5° sobre el horizonte).
  const SCENE_SITE = { lat: -84.79, lon: 31.2, sun: [0.0237, 0.1126, -0.9934], earth: [-0.5971, 0.1825, -0.7812] } as const
  action('🎬 Escena de alunizaje (IM-2 Mons Mouton)', () => {
    // Sol y Tierra reales de la API para ese sitio y fecha (SAMPLE), para que el cielo coincida
    globe.setSunFromLocal(SCENE_SITE.lat, SCENE_SITE.lon, [...SCENE_SITE.sun])
    globe.setEarthFromLocal(SCENE_SITE.lat, SCENE_SITE.lon, [...SCENE_SITE.earth])
    // empieza siempre desde la vista global
    globe.reset()
    setTimeout(() => globe.playLandingScene({ lat: SCENE_SITE.lat, lon: SCENE_SITE.lon }), 1800)
  })
  action('⏹ Salir de la escena', () => globe.stopLandingScene())
  const reset = document.createElement('button')
  reset.textContent = '↺ Vista global'
  reset.onclick = () => globe.reset()
  const status = document.createElement('div')
  status.style.cssText = 'color:#f59e0b;min-height:1.2em;margin-top:6px'
  panel.append(reset, status, readout)

  const pick = (id: string) => {
    const s = MOCK_SITES.find((x) => x.id === id)!
    globe.selectSite(s)
    globe.setTrajectory(generateDescentArc(s.lat, s.lon))
    ;[...panel.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.textContent === s.name))
  }
  globe.on('siteClick', (s) => pick(s.id))
  const phaseNames = { arrival: 'Vuelo hacia el sitio…', descent: 'Descenso', landed: 'Posado', done: 'Escena completa (arrastra para orbitar)' } as const
  globe.on('scenePhase', ({ phase }) => (readout.textContent = phaseNames[phase]))
  globe.on('sceneTelemetry', (t) => (readout.textContent = `Descenso · alt ${t.altM.toFixed(0)} m · ${t.vMps.toFixed(1)} m/s (ilustrativo)`))
  globe.on('loading', ({ pending }) => (status.textContent = pending > 0 ? `Cargando imagen… (${pending})` : ''))
  globe.on('trajectoryProgress', (p) => (readout.textContent = `Descenso ${(p.progress * 100).toFixed(0)}% · alt ${p.altKm.toFixed(1)} km`))
  globe.on('globeClick', ({ lat, lon }) => (readout.textContent = `lat ${lat.toFixed(3)}°, lon ${lon.toFixed(3)}°`))
}

;(window as unknown as { globe: LunarGlobe }).globe = globe // depuración en consola
