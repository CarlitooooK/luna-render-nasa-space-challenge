// Raíz de las teselas de NASA Moon Trek. Por defecto, el servidor de NASA. Con VITE_TREK_BASE_URL
// se apunta a un proxy con caché que replica la misma ruta (`<base>/Moon/EQ/...`, `<base>/Moon/SP/...`),
// para que la demo no dependa de trek.nasa.gov. Puede ser relativa al origen del globo (`/trek`).
export const TREK_BASE = (import.meta.env.VITE_TREK_BASE_URL || 'https://trek.nasa.gov/tiles').replace(/\/+$/, '')
