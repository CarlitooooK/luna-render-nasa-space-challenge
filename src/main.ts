import 'cesium/Build/Cesium/Widgets/widgets.css'
import { LunarGlobe } from './LunarGlobe'
import { connectToHost } from './embed'
import { MOCK_SITES, generateDescentArc } from './data/mockSites'

const globe = new LunarGlobe(document.getElementById('globe')!)
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
  toggle('Auto-rotación', (v) => globe.setConfig({ autoRotate: v }), true)
  const reset = document.createElement('button')
  reset.textContent = '↺ Vista global'
  reset.onclick = () => globe.reset()
  panel.append(reset, readout)

  const pick = (id: string) => {
    const s = MOCK_SITES.find((x) => x.id === id)!
    globe.selectSite(s)
    globe.setTrajectory(generateDescentArc(s.lat, s.lon))
    ;[...panel.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.textContent === s.name))
  }
  globe.on('siteClick', (s) => pick(s.id))
  globe.on('globeClick', ({ lat, lon }) => (readout.textContent = `lat ${lat.toFixed(3)}°, lon ${lon.toFixed(3)}°`))
}

;(window as unknown as { globe: LunarGlobe }).globe = globe // depuración en consola
