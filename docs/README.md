# Documentación técnica del globo lunar

Cómo está hecho el globo, qué mensajes entiende y qué limitaciones tiene. Los acuerdos entre equipos (contrato de la API, decisiones, ambientes) viven en el [repo de contexto](https://github.com/CarlitooooK/handoff-space-NASA-challenge) y aquí solo se citan.

| Doc | Qué tiene |
| --- | --- |
| [`01-arquitectura.md`](01-arquitectura.md) | Por qué CesiumJS, qué hace cada módulo de `src/` y el import directo |
| [`02-protocolo-postmessage.md`](02-protocolo-postmessage.md) | **Fuente única del protocolo** con el host: iframe, orígenes permitidos y cada mensaje en los dos sentidos |
| [`03-relieve-y-polo.md`](03-relieve-y-polo.md) | De dónde sale el relieve (teselas del backend o Moon Trek) y cómo se trata el polo sur |
| [`04-vista-horizonte.md`](04-vista-horizonte.md) | La vista a ras de suelo con el horizonte real |
| [`05-escena-alunizaje-y-vehiculos.md`](05-escena-alunizaje-y-vehiculos.md) | La escena de alunizaje, sus parámetros, el módulo y el astronauta |
| [`06-cielo-y-camara.md`](06-cielo-y-camara.md) | Estrellas, Sol y Tierra; cámara, gestos y capas |
| [`07-flujos.md`](07-flujos.md) | Los flujos principales en diagramas |
| [`08-limitaciones.md`](08-limitaciones.md) | Lo que hoy no se ve bien y por qué |
| [`09-desarrollo-y-despliegue.md`](09-desarrollo-y-despliegue.md) | Correr en local, variables de entorno, CI y despliegue |

## Cómo se inserta el video

El video de la demo va en el `README.md` de la raíz, en la sección "Video". GitHub solo reproduce un video dentro de un `.md` si el archivo lo aloja GitHub:

1. En github.com, edita el `README.md` y arrastra el archivo al editor. Formatos: `.mp4`, `.mov` o `.webm`; máximo 10 MB en un plan gratuito (100 MB en uno de pago). H.264 en `.mp4` es lo más compatible.
2. GitHub sube el archivo y escribe una URL `https://github.com/user-attachments/assets/<id>`.
3. Deja esa URL sola en su propia línea. Al guardar, GitHub la muestra como reproductor con sus controles.

Lo que **no** se reproduce:

- Un `.mp4` guardado dentro del repo y enlazado por ruta relativa (`docs/media/demo.mp4`): GitHub no lo acepta como fuente de video.
- Un `<iframe>` de YouTube: GitHub lo elimina. Si el video vive en YouTube (por ejemplo, porque pesa más de 10 MB), se pone una miniatura que abre el video:

  ```markdown
  [![Video de la demo](https://img.youtube.com/vi/<ID>/maxresdefault.jpg)](https://youtu.be/<ID>)
  ```

Un GIF corto sí se anima dentro del `.md` aunque viva en el repo (`![Demo](docs/media/demo.gif)`), pero pesa mucho más que el video y no tiene sonido.
