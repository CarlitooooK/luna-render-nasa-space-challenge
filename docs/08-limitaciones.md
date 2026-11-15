# 08. Limitaciones conocidas

- **Polo sin backend:** en proyección geográfica la imagen converge en abanico justo en ±90°. La reproyección del mosaico polar ([`03`](03-relieve-y-polo.md)) lo reduce a la mitad; queda un abanico residual de ~10 km. Con las teselas del backend el polo se dibuja como relieve sombreado en lugar del mosaico WAC.
- **Suelo a ras de superficie:** la imagen tiene ~100 m/px; la textura procedural lo disimula pero se ve suave y sin rocas ni cráteres pequeños. La escena es más convincente sobre terreno llano e iluminado (p. ej. IM-2 Mons Mouton).
- **Astronauta estático** (sin animación) y de baja calidad a propósito.
- **Relieve:** sin backend, el de Moon Trek es de ~666 m/px con pasos de ~77 m: sirve para el contexto global, no para el detalle del sitio. Con las teselas del backend el polo sur llega a ~21 m ([`03`](03-relieve-y-polo.md)).
- **Resolución máxima de imagen ~100 m/px (WAC).** LROC NAC (0.5 m/px) es v2 según `docs/08` del handoff.
- **Escenas ilustrativas:** el descenso y la luz de escena son recursos de presentación, no física ([`05`](05-escena-alunizaje-y-vehiculos.md)).
- Los sitios de la demo independiente son de muestra.
