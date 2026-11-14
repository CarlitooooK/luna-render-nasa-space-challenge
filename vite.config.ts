import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    // Cesium resuelve Workers/Assets/Widgets relativo a esta ruta (ver scripts/copy-cesium-assets.mjs)
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
})
