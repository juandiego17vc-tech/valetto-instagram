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

## Paso 1 — Instagram como cuenta de Empresa

En la app: Configuración → Tipo de cuenta y herramientas → **cuenta profesional (Empresa)**. Vinculala a la **página de Facebook** de Valetto; si no tenés una, creala.

## Paso 2 — Crear la app de Meta (una vez, unos 15 minutos)

1. **developers.facebook.com** → Mis apps → **Crear app** → tipo **Empresa**.
2. Agregá el producto **Instagram** (opción "API de Instagram con inicio de sesión de Facebook").
3. Abrí el **Graph API Explorer**:
   - Elegí tu app.
   - Agregá los permisos `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement` y `business_management`.
   - Tocá **Generate Access Token**.
4. **Token que no vence:**
   - Pegá el token en el **Access Token Debugger** y tocá **"Extender token"**.
   - Con ese token largo, consultá `me/accounts` en el Explorer.
   - Copiá el `access_token` de la página de Valetto: ese es tu **IG_TOKEN**. Copiá también el `id` de la página.
5. Consultá `ID_DE_LA_PAGINA?fields=instagram_business_account`. El número que aparece es tu **IG_USER_ID**.

## Paso 3 — Subirlo a GitHub

1. github.com → **New repository** → nombre `valetto-instagram` → **Public**.
   - Tiene que ser público para que Instagram pueda leer las placas. Ahí no queda nada privado: los tokens van aparte, en "Secrets".
2. Subí todo el contenido de esta carpeta, incluida la carpeta `.github`.
   - Lo más fácil es pedirle a Claude Code: *"subí esta carpeta a mi repo valetto-instagram"*.
3. **Settings → Secrets and variables → Actions → New repository secret**:
   - `IG_USER_ID`
   - `IG_TOKEN`

## Paso 4 — Probar

**Actions** → **Publicar en Instagram** → **Run workflow**:
1. Elegí **reloj**, dejá tildado **Modo prueba** → Run. Revisá en el log el reloj, el link de la imagen y el texto.
2. Repetí con **educativo** en modo prueba.
3. Si está todo bien, corré uno de los dos **sin** modo prueba: se publica de verdad.

Desde ahí corre solo todos los días.

---

## Cambios rápidos

- **Horarios:** líneas `cron` del workflow. Van en hora UTC, que es Argentina + 3.
- **Editar un educativo:** cambiá el texto en `contenido/educativo.json` y corré `python generar_placas.py 5` (el número del post) para rehacer sus placas.
- **Sumar educativos nuevos:** agregalos al final del JSON con `n` 31, 32… y generá sus placas. Cuando se terminan, el bot deja de publicar educativos hasta que agregues más.
- **Foto del reloj sin franja de texto:** agregá `OVERLAY: "0"` en el workflow.

## Si algo falla

- *"No encontré relojes disponibles"* → cambió el diseño del catálogo. Pasale el error a Claude.
- *Error de token* → repetí el paso 2.4 y actualizá `IG_TOKEN`.
- *El educativo no publica la imagen* → revisá que el repo sea **público**.
