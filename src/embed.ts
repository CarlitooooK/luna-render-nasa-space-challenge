import { LunarGlobe } from './LunarGlobe'
import type { GlobeInboundMessage, GlobeOutboundMessage } from './types'

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
    switch (msg.type) {
      case 'SET_SITES':
        globe.setSites(msg.payload)
        break
      case 'SELECT_SITE':
        globe.selectSite(msg.payload)
        break
      case 'SET_TRAJECTORY':
        globe.setTrajectory(msg.payload)
        break
      case 'SET_CONFIG':
        globe.setConfig(msg.payload)
        break
      case 'SET_SUN_LOCAL':
        globe.setSunFromLocal(msg.payload.lat, msg.payload.lon, msg.payload.vector)
        break
      case 'SET_EARTH_LOCAL':
        globe.setEarthFromLocal(msg.payload.lat, msg.payload.lon, msg.payload.vector)
        break
      case 'SET_PSR':
        globe.setPsr(msg.payload)
        break
      case 'LOOK_AT':
        globe.lookAtBody(msg.payload.body)
        break
      case 'VIEW_FROM_SURFACE':
        globe.viewFromSurface(msg.payload.lat, msg.payload.lon, msg.payload.look)
        break
      case 'SET_VIEW':
        globe.setView(msg.payload)
        break
      case 'PLAY_LANDING_SCENE':
        globe.playLandingScene(msg.payload)
        break
      case 'STOP_LANDING_SCENE':
        globe.stopLandingScene()
        break
      case 'SET_VEHICLES':
        void globe.setVehicles(msg.payload)
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
  }

  const offSite = globe.on('siteClick', (site) => send({ type: 'SITE_CLICKED', payload: site }))
  const offGlobe = globe.on('globeClick', (p) => send({ type: 'GLOBE_CLICKED', payload: p }))
  const offLoad = globe.on('loading', (p) => send({ type: 'LOADING', payload: p }))
  const offProg = globe.on('trajectoryProgress', (p) => send({ type: 'TRAJECTORY_PROGRESS', payload: p }))
  const offPhase = globe.on('scenePhase', (p) => send({ type: 'SCENE_PHASE', payload: p }))
  const offTele = globe.on('sceneTelemetry', (p) => send({ type: 'SCENE_TELEMETRY', payload: p }))
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
    offPhase()
    offTele()
    offLoad()
    offProg()
  }
}
