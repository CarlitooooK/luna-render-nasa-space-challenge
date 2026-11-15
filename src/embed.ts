import { LunarGlobe } from './LunarGlobe'
import type { GlobeInboundMessage, GlobeOutboundMessage } from './types'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isLatLon = (p: unknown): p is { lat: number; lon: number } =>
  typeof p === 'object' && p !== null && isNum((p as { lat?: unknown }).lat) && isNum((p as { lon?: unknown }).lon) &&
  (p as { lat: number }).lat >= -90 && (p as { lat: number }).lat <= 90 && (p as { lon: number }).lon >= -180 && (p as { lon: number }).lon <= 360
const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(isNum) && v[0] ** 2 + v[1] ** 2 + v[2] ** 2 > 1e-9

const isBody = (b: unknown): b is { az: number; el: number; horizonEl: number; visible: boolean } =>
  typeof b === 'object' && b !== null && isNum((b as { az?: unknown }).az) && isNum((b as { el?: unknown }).el) &&
  isNum((b as { horizonEl?: unknown }).horizonEl) && typeof (b as { visible?: unknown }).visible === 'boolean'
const isProfile = (p: unknown): p is { az_deg: number; horizon_el_deg: number }[] =>
  Array.isArray(p) && p.length >= 8 && p.length <= 3600 && p.every((x) => x && isNum(x.az_deg) && isNum(x.horizon_el_deg))

/**
 * Conecta un LunarGlobe con la ventana padre (iframe) vía postMessage.
 * Seguridad: solo acepta mensajes cuyo `origin` esté en `allowedOrigins` y solo
 * responde a esos orígenes (nunca '*').
 */
export function connectToHost(globe: LunarGlobe, allowedOrigins: string[]): () => void {
  const allowed = new Set(allowedOrigins)
  let hostOrigin: string | null = null

  const send = (msg: GlobeOutboundMessage) => {
    if (hostOrigin) window.parent.postMessage(msg, hostOrigin)
  }

  const onMessage = (e: MessageEvent) => {
    if (e.source !== window.parent || !allowed.has(e.origin)) return
    hostOrigin = e.origin
    const msg = e.data as GlobeInboundMessage | undefined
    if (!msg || typeof msg.type !== 'string') return
    // Un mensaje mal formado nunca debe detener el render: se descarta sin ejecutarlo
    try {
    switch (msg.type) {
      case 'SET_SITES':
        if (Array.isArray(msg.payload)) globe.setSites(msg.payload.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && isLatLon(s)))
        break
      case 'SELECT_SITE':
        if (isLatLon(msg.payload)) globe.selectSite(msg.payload)
        break
      case 'SET_TRAJECTORY':
        globe.setTrajectory(msg.payload)
        break
      case 'SET_CONFIG':
        globe.setConfig(msg.payload)
        break
      case 'SET_SUN_LOCAL':
        if (isLatLon(msg.payload) && isVec3(msg.payload.vector)) globe.setSunFromLocal(msg.payload.lat, msg.payload.lon, msg.payload.vector)
        break
      case 'SET_EARTH_LOCAL':
        if (isLatLon(msg.payload) && isVec3(msg.payload.vector)) globe.setEarthFromLocal(msg.payload.lat, msg.payload.lon, msg.payload.vector)
        break
      case 'SET_PSR':
        globe.setPsr(msg.payload)
        break
      case 'LOOK_AT':
        globe.lookAtBody(msg.payload.body)
        break
      case 'VIEW_FROM_SURFACE':
        if (isLatLon(msg.payload)) void globe.viewFromSurface(msg.payload.lat, msg.payload.lon, msg.payload.look)
        break
      case 'SET_VIEW':
        if (isLatLon(msg.payload) && isNum(msg.payload.altM) && msg.payload.altM > 0) globe.setView(msg.payload)
        break
      case 'SET_HORIZON':
        if (isLatLon(msg.payload) && isProfile(msg.payload.profile)) globe.setHorizonProfile(msg.payload.lat, msg.payload.lon, msg.payload.profile)
        break
      case 'SET_SKY_STATE':
        if (msg.payload && isBody(msg.payload.sun) && isBody(msg.payload.earth)) globe.setSkyState({ sun: msg.payload.sun, earth: msg.payload.earth })
        break
      case 'SET_HORIZON_DETAIL':
        if (typeof msg.payload?.detailed === 'boolean') globe.setHorizonDetailed(msg.payload.detailed)
        break
      case 'SHOW_HORIZON':
        if (isLatLon(msg.payload)) globe.showHorizon({ lat: msg.payload.lat, lon: msg.payload.lon, headingDeg: isNum(msg.payload.headingDeg) ? msg.payload.headingDeg : undefined })
        break
      case 'EXIT_HORIZON':
        globe.exitHorizon()
        break
      case 'SET_DATA_MODE':
        if (typeof msg.payload?.sample === 'boolean') globe.setDataMode(msg.payload.sample)
        break
      case 'PLAY_LANDING_SCENE':
        globe.playLandingScene(msg.payload)
        break
      case 'STOP_LANDING_SCENE':
        globe.stopLandingScene()
        break
      case 'SET_VEHICLES':
        if (typeof msg.payload === 'object' && msg.payload !== null && (msg.payload.astronaut == null || isLatLon(msg.payload.astronaut))) void globe.setVehicles(msg.payload)
        break
      case 'VIEW_VEHICLE':
        globe.viewVehicle(msg.payload.which, msg.payload.rangeM)
        break
      case 'FOLLOW_TRAJECTORY':
        globe.setFollowTrajectory(msg.payload.enabled)
        break
      case 'PLAY_ANIMATION':
        globe.setPlaying(msg.payload.playing)
        break
      case 'RESET':
        globe.reset()
        break
    }
    } catch (err) {
      console.warn('[lunar-globe] mensaje descartado:', msg.type, err)
    }
  }

  const offSite = globe.on('siteClick', (site) => send({ type: 'SITE_CLICKED', payload: site }))
  const offGlobe = globe.on('globeClick', (p) => send({ type: 'GLOBE_CLICKED', payload: p }))
  const offLoad = globe.on('loading', (p) => send({ type: 'LOADING', payload: p }))
  const offProg = globe.on('trajectoryProgress', (p) => send({ type: 'TRAJECTORY_PROGRESS', payload: p }))
  const offPhase = globe.on('scenePhase', (p) => send({ type: 'SCENE_PHASE', payload: p }))
  const offTele = globe.on('sceneTelemetry', (p) => send({ type: 'SCENE_TELEMETRY', payload: p }))
  const offHz = globe.on('horizonPhase', (p) => send({ type: 'HORIZON_PHASE', payload: p }))
  const offErr = globe.on('sceneError', (p) => send({ type: 'SCENE_ERROR', payload: p }))
  const offAnim = globe.on('animationComplete', () => send({ type: 'ANIMATION_COMPLETE' }))
  window.addEventListener('message', onMessage)

  // El host no conoce nuestro origen de respuesta hasta recibir su primer mensaje:
  // anunciamos READY solo a los orígenes permitidos.
  allowed.forEach((origin) => window.parent.postMessage({ type: 'READY' } satisfies GlobeOutboundMessage, origin))

  return () => {
    window.removeEventListener('message', onMessage)
    offSite()
    offGlobe()
    offAnim()
    offErr()
    offHz()
    offPhase()
    offTele()
    offLoad()
    offProg()
  }
}
