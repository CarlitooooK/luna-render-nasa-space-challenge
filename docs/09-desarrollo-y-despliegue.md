# 09. Desarrollo y despliegue

## Correr en local

```bash
npm ci
npm run dev        # copia los assets de Cesium a public/cesium y arranca Vite en http://localhost:5173
```

Con la consola, el globo corre en otro puerto porque la consola usa el 5173: `npm run dev -- --port 5174` y, en la consola, `VITE_GLOBE_URL=http://localhost:5174/`.

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Copia los assets de Cesium y arranca el servidor de desarrollo |
| `npm run build` | Copia los assets, typecheck y build de producción |
| `npm run typecheck` | Solo typecheck |
| `npm run preview` | Sirve el build |

## Variables de entorno

| Variable | Qué es | Sin valor |
| --- | --- | --- |
| `VITE_ALLOWED_ORIGINS` | Orígenes que pueden mandar mensajes al globo, separados por comas. También por `?allowedOrigins=` en la URL | `http://localhost:5173` |
| `VITE_TREK_BASE_URL` | Raíz de las teselas de Moon Trek, para usar un proxy con caché que replique sus rutas (puede ser relativa, p. ej. `/trek`) | `https://trek.nasa.gov/tiles` |

Depuración en la demo: `?terrain=0` (sin relieve) y `?polarfix=0` (sin reproyección polar).

## CI y despliegue (Woodpecker)

- **PR y push a `main`** (`.woodpecker/ci.yaml`): `npm ci`, typecheck y build.
- **Merge a `main`** (`.woodpecker/deploy.yaml`, D-018 del handoff): si el CI pasa, el servidor construye ese commit, cambia de versión de forma atómica (guarda la anterior) y corre pruebas de humo: página y bundle, workers de Cesium, modelos 3D y la caché de Moon Trek (esta última solo avisa si falla, porque depende de NASA).
- **Rollback:** un deployment de Woodpecker a `production` vuelve a publicar el commit de ese pipeline.
