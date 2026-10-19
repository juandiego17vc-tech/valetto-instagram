# Instagram automático de Valetto — 2 posteos por día

| Hora (Argentina) | Qué se publica |
|---|---|
| **11:52** | **Educativo**: carrusel de 5 placas. Son 30 en total, salen en orden del 1 al 30. |
| **18:52** | **Reloj del día**: uno disponible del catálogo, con foto, precio, transferencia, garantía y WhatsApp. |

Costo: **$0**. Usa GitHub Actions y la API oficial de Instagram, los dos gratis.

## Qué hay en esta carpeta

- `publicar.mjs` — el programa que publica.
- `.github/workflows/publicar-instagram.yml` — los horarios.
- `contenido/educativo.json` — los textos de los 30 educativos.
- `contenido/imagenes/` — las 150 placas ya hechas, con el estilo de @valetto.relojes.
- `generar_placas.py` + `fonts/` — para regenerar las placas si cambiás algún texto.
- `posted.json` / `posted-edu.json` — el historial, para no repetir.

---

## Cómo quedó instalado (oct 2026)

- **Repo:** github.com/juandiego17vc-tech/valetto-instagram (público, para que Instagram pueda leer las placas).
- **App de Meta:** "Valetto Publicador" (portfolio Valetto Relojes), con API de Instagram con inicio de sesión de Instagram. @valetto.relojes está agregada como tester.
- **Secret de GitHub:** `IG_TOKEN`, el token de @valetto.relojes.
  - Dura 60 días, pero el sistema lo renueva solo cada vez que publica.
  - Si alguna vez falla con "token inválido": entrá en developers.facebook.com → Valetto Publicador → Casos de uso → API de Instagram → Configuración con inicio de sesión de Instagram → "Generar identificador". Pegá el nuevo valor en GitHub → Settings → Secrets → IG_TOKEN.

## Probar a mano

**Actions** → **Publicar en Instagram** → **Run workflow** → elegí **reloj** o **educativo**:
- Con **Modo prueba** tildado: muestra qué publicaría, sin publicar.
- Sin el tilde: publica de verdad.

## Cambios rápidos

- **Horarios:** líneas `cron` del workflow. Van en hora UTC, que es Argentina + 3.
- **Editar un educativo:** cambiá el texto en `contenido/educativo.json` y corré `python generar_placas.py 5` (el número del post) para rehacer sus placas.
- **Sumar educativos nuevos:** agregalos al final del JSON con `n` 31, 32… y generá sus placas. Cuando se terminan, el bot deja de publicar educativos hasta que agregues más.
- **Foto del reloj sin franja de texto:** agregá `OVERLAY: "0"` en el workflow.

## Si algo falla

- *"No encontré relojes disponibles"* → cambió el diseño del catálogo. Pasale el error a Claude.
- *Error de token* → generá un token nuevo (ver arriba) y actualizá `IG_TOKEN`.
- *El educativo no publica la imagen* → revisá que el repo sea **público**.
