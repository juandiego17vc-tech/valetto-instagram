// Publica automáticamente un reloj del catálogo de Valetto en Instagram.
// Corre en GitHub Actions (gratis). No necesita instalar nada: usa Node 20.
//
// Variables (se cargan como "Secrets" en GitHub):
//   IG_TOKEN    -> token de acceso de Instagram (app "Valetto Publicador")
//   IG_USER_ID  -> opcional; si no está, usa la cuenta dueña del token
// Opcionales:
//   DRY_RUN=1   -> modo prueba: muestra qué publicaría, pero NO publica
//   OVERLAY=0   -> publica la foto sola, sin la franja con nombre y precio

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CATALOGO = "https://valetto.com.ar/catalogo";
const GRAPH = `https://graph.instagram.com/${process.env.GRAPH_VERSION || "v23.0"}`;
const DRY_RUN = process.env.DRY_RUN === "1";
const OVERLAY = process.env.OVERLAY !== "0";
const HISTORIAL = "posted.json";

// ---------- 1. Leer el catálogo ----------

const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

async function leerCatalogo() {
  const res = await fetch(CATALOGO, { headers: { "User-Agent": "Mozilla/5.0 valetto-bot" } });
  if (!res.ok) throw new Error(`No pude abrir el catálogo (HTTP ${res.status})`);
  const html = await res.text();

  return parsearCatalogo(html);
}

// Ficha técnica de cada reloj: viene en los datos internos de la página (Next.js)
function fichas(html) {
  const plano = html.replace(/\\\\"/g, "'").replace(/\\"/g, '"');
  const res = {};
  for (const m of plano.matchAll(/\{"id":(\d+),"marca_id"[\s\S]*?"inventario_video"/g)) {
    const o = m[0];
    const campo = (k) => {
      const v = o.match(new RegExp(`"${k}":(?:"([^"]*)"|(true|false|null|-?[\\d.]+))`));
      return v ? (v[1] !== undefined ? v[1] : v[2]) : null;
    };
    const foto = (o.match(/upload\/[^"]*?\/([a-z0-9]+)\.(?:jpg|jpeg|png|webp)/i) || [])[1];
    const f = {
      id: m[1],
      ref: campo("ref"),
      movimiento: campo("movimiento"),
      diametro: campo("diametro"),
      agua: campo("agua"),
      correa: campo("correa"),
      cristal: campo("cristal"),
      caja: campo("caja"),
      condicion: campo("condicion"),
      stock: Number(campo("stock") || 0),
      reservado: campo("reservado") === "true",
      activo: campo("activo_catalogo") !== "false",
    };
    if (foto) res[foto] = f;
  }
  return res;
}

const limpio = (v) => (v && !/^(null|s\/n|-|n\/a)$/i.test(v.trim()) ? v.trim() : null);

function parsearCatalogo(html) {
  const datos = fichas(html);
  // Cada tarjeta tiene una foto con alt="Reloj <marca modelo ref>, original con garantía"
  const marcas = [...html.matchAll(/alt="Reloj ([^"]+?)"/g)];
  const relojes = [];

  marcas.forEach((m, i) => {
    const inicio = m.index;
    const fin = i + 1 < marcas.length ? marcas[i + 1].index : inicio + 4000;
    const tramo = html.slice(inicio, fin);
    const previo = html.slice(Math.max(0, inicio - 800), inicio);

    // La etiqueta <img> completa (el src puede estar antes o después del alt)
    const tagIni = html.lastIndexOf("<img", inicio);
    const tagFin = html.indexOf(">", inicio);
    const tag = html.slice(tagIni, tagFin + 1);
    const src = (tag.match(/src="([^"]+)"/) || [])[1];
    if (!src || !src.includes("res.cloudinary.com")) return;

    const texto = decode(tramo.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " "));
    if (/\b(Vendido|Reservado|Agotado)\b/.test(texto.slice(0, 400))) return;

    const precios = [...texto.matchAll(/\$\s?([\d.]+)/g)].map((p) => p[1]);
    if (precios.length < 2 || !/transferencia/i.test(texto)) return;

    const fotoId = (src.match(/\/([a-z0-9]+)\.(?:jpg|jpeg|png|webp)/i) || [])[1];
    const ficha = datos[fotoId] || {};
    if (ficha.reservado || ficha.activo === false || ficha.stock === 0) return;
    const id = ficha.id || null;

    const alt = decode(m[1]);
    const usado = /,\s*usado$/i.test(alt) || /usado/i.test(ficha.condicion || "");
    const titulo = alt.replace(/,\s*(original con garant[ií]a|usado)$/i, "").trim();

    relojes.push({
      clave: id || titulo,
      id,
      titulo,
      marca: titulo.split(" ")[0],
      usado,
      precioTarjeta: precios[0],
      precioTransferencia: precios[1],
      foto: src,
      movimiento: limpio(ficha.movimiento),
      diametro: limpio(ficha.diametro),
      agua: limpio(ficha.agua),
      correa: limpio(ficha.correa),
      cristal: limpio(ficha.cristal),
      caja: limpio(ficha.caja),
    });
  });

  // Sacar duplicados
  const vistos = new Set();
  return relojes.filter((r) => (vistos.has(r.clave) ? false : vistos.add(r.clave)));
}

// ---------- 2. Elegir un reloj que no se haya publicado ----------

function elegir(relojes) {
  const historial = existsSync(HISTORIAL) ? JSON.parse(readFileSync(HISTORIAL, "utf8")) : [];
  let pendientes = relojes.filter((r) => !historial.includes(r.clave));
  let nuevoHistorial = historial;
  if (pendientes.length === 0) {
    console.log("Ya se publicaron todos: arranco la vuelta de nuevo.");
    pendientes = relojes;
    nuevoHistorial = [];
  }
  const reloj = pendientes[Math.floor(Math.random() * pendientes.length)];
  return { reloj, nuevoHistorial: [...nuevoHistorial, reloj.clave] };
}

// ---------- 3. Armar la imagen (Cloudinary la genera sola) ----------

const textoCloudinary = (t) =>
  encodeURIComponent(t).replace(/%2C/g, "%252C").replace(/%2F/g, "%252F");

function armarImagen(reloj, conTexto) {
  // Formato 4:5 (1080x1350), fondo blanco, JPG (Instagram solo acepta JPG)
  let tx = "c_pad,w_1080,h_1350,b_white,g_north";
  if (conTexto) {
    const nombre = reloj.titulo.length > 38 ? reloj.titulo.slice(0, 36) + "…" : reloj.titulo;
    tx +=
      `/l_text:Arial_46_bold:${textoCloudinary(nombre.toUpperCase())},co_rgb:0b1929/fl_layer_apply,g_south,y_150` +
      `/l_text:Arial_70_bold:${textoCloudinary("$" + reloj.precioTarjeta)},co_rgb:0b1929/fl_layer_apply,g_south,y_55`;
  }
  tx += "/f_jpg,q_90";
  return reloj.foto.replace(/\/upload\/(?:[^/]+\/)*?(v\d+\/)/, `/upload/${tx}/$1`);
}

async function imagenFunciona(url) {
  try {
    const r = await fetch(url);
    return r.ok && (r.headers.get("content-type") || "").includes("image");
  } catch {
    return false;
  }
}

// ---------- 4. Texto del posteo ----------
// Reglas: el precio de tarjeta es en 1 pago; transferencia/efectivo 8% menos;
// las cuotas tienen interés a cargo del cliente. Nunca mencionar el origen de compra.

function armarCaption(r) {
  const link = r.id ? `valetto.com.ar/catalogo/${r.id}` : "valetto.com.ar/catalogo";
  const tagMarca = r.marca.toLowerCase().replace(/[^a-z0-9]/g, "");
  const may = (s) => s && s.charAt(0).toUpperCase() + s.slice(1);
  const agua = r.agua ? r.agua.replace(/^(\d+)\s*m\b/i, "$1 m") : null;
  const diam = r.diametro ? r.diametro.replace(/^([\d.,]+)\s*mm/i, "$1 mm") : null;
  const ficha = [
    r.movimiento && `⚙️ Movimiento: ${may(r.movimiento)}`,
    diam && `📏 Diámetro: ${diam}`,
    agua && `💧 Resistencia al agua: ${agua}`,
    r.cristal && `🔷 Cristal: ${may(r.cristal)}`,
    r.correa && `🔗 Malla: ${may(r.correa)}`,
    r.caja && /^con caja/i.test(r.caja) && "📦 Viene con su caja",
  ].filter(Boolean);
  return [
    `⌚ ${r.titulo}`,
    r.usado ? "Usado en excelente estado · original" : "Original con garantía oficial",
    "",
    ...(ficha.length ? [...ficha, ""] : []),
    `💳 $${r.precioTarjeta} en 1 pago con tarjeta`,
    `💵 $${r.precioTransferencia} por transferencia o efectivo (8% off)`,
    "📆 ¿En cuotas? Simulalas en la web (el interés lo cubre el comprador)",
    "",
    "✅ 1 año de garantía Valetto",
    "🚚 Envío gratis desde $200.000 · en CABA siempre gratis",
    "📍 Oficina en Av. Callao 468, CABA (con cita previa)",
    "",
    "👉 Consultas por WhatsApp: 11 6931-2299",
    `🔗 ${link} (link en la bio)`,
    "",
    `#relojes #relojesoriginales #${tagMarca} #relojeshombre #buenosaires #valetto`,
  ].join("\n");
}

// ---------- 5. Publicar en Instagram ----------

async function graph(path, params, method = "POST") {
  const url = new URL(`${GRAPH}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: process.env.IG_TOKEN });
  const res =
    method === "GET"
      ? await fetch(`${url}?${body}`)
      : await fetch(url, { method, body });
  const data = await res.json();
  if (data.error) throw new Error(`Instagram respondió: ${data.error.message}`);
  return data;
}

async function publicar(imagen, caption) {
  const ig = process.env.IG_USER_ID || "me";
  const { id: creacion } = await graph(`${ig}/media`, { image_url: imagen, caption });

  for (let i = 0; i < 12; i++) {
    const { status_code } = await graph(creacion, { fields: "status_code" }, "GET");
    if (status_code === "FINISHED") break;
    if (status_code === "ERROR") throw new Error("Instagram no pudo procesar la imagen");
    await new Promise((r) => setTimeout(r, 5000));
  }

  const { id } = await graph(`${ig}/media_publish`, { creation_id: creacion });
  return id;
}

async function publicarCarrusel(imagenes, caption) {
  const ig = process.env.IG_USER_ID || "me";
  const hijos = [];
  for (const image_url of imagenes) {
    const { id } = await graph(`${ig}/media`, { image_url, is_carousel_item: "true" });
    hijos.push(id);
  }
  const { id: creacion } = await graph(`${ig}/media`, {
    media_type: "CAROUSEL",
    children: hijos.join(","),
    caption,
  });
  for (let i = 0; i < 12; i++) {
    const { status_code } = await graph(creacion, { fields: "status_code" }, "GET");
    if (status_code === "FINISHED") break;
    if (status_code === "ERROR") throw new Error("Instagram no pudo procesar el carrusel");
    await new Promise((r) => setTimeout(r, 5000));
  }
  const { id } = await graph(`${ig}/media_publish`, { creation_id: creacion });
  return id;
}

// ---------- Contenido educativo (carrusel del día) ----------

async function educativoDelDia() {
  const posts = JSON.parse(readFileSync("contenido/educativo.json", "utf8"));
  const HIST = "posted-edu.json";
  const hechos = existsSync(HIST) ? JSON.parse(readFileSync(HIST, "utf8")) : [];
  const post = posts.find((p) => !hechos.includes(p.n));
  if (!post) {
    console.log("Ya se publicaron todos los educativos. Agregá nuevos en contenido/educativo.json.");
    return;
  }

  // Las placas ya están hechas en contenido/imagenes (NN-1.jpg ... NN-5.jpg)
  const repo = process.env.GITHUB_REPOSITORY;
  const nn = String(post.n).padStart(2, "0");
  const total = post.slides.length + 2; // portada + slides + cierre
  const imagenes = Array.from({ length: total }, (_, k) =>
    `https://raw.githubusercontent.com/${repo}/main/contenido/imagenes/${nn}-${k + 1}.jpg`);

  const caption = [
    post.caption,
    "",
    "Guardalo para tenerlo a mano y compartilo con quien lo necesite.",
    "⌚ Relojes originales con garantía · valetto.com.ar (link en la bio)",
    "👉 WhatsApp: 11 6931-2299",
    "",
    "#relojes #relojesoriginales #relojeria #watchtips #buenosaires #valetto",
  ].join("\n");

  console.log(`\n===== EDUCATIVO #${post.n} =====\n${post.gancho}\n`);
  console.log(imagenes.join("\n"));
  console.log("\n" + caption + "\n");

  if (DRY_RUN) return console.log("MODO PRUEBA: no se publicó nada.");
  if (!process.env.IG_TOKEN) throw new Error("Falta el secret IG_TOKEN");
  const id = await publicarCarrusel(imagenes, caption);
  writeFileSync(HIST, JSON.stringify([...hechos, post.n], null, 2) + "\n");
  console.log(`✅ Educativo publicado (id ${id})`);
}

// ---------- Mantener vivo el token (dura 60 días; cada uso lo renueva) ----------

async function renovarToken() {
  try {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${process.env.IG_TOKEN}`);
    const d = await r.json();
    if (d.expires_in) console.log(`Token renovado: vence en ${Math.round(d.expires_in / 86400)} días.`);
    else console.log("No se pudo renovar el token:", JSON.stringify(d.error || d));
  } catch (e) {
    console.log("No se pudo renovar el token:", e.message);
  }
}

// ---------- Programa principal ----------

if (process.env.IG_TOKEN) {
  try {
    const yo = await graph("me", { fields: "user_id,username" }, "GET");
    console.log(`Token OK: conectado como @${yo.username}`);
  } catch (e) {
    console.log("⚠️ El token no funciona:", e.message);
    if (!DRY_RUN) throw e;
  }
  if (!DRY_RUN) await renovarToken();
} else {
  console.log("⚠️ Todavía no está cargado el secret IG_TOKEN.");
}

if (process.env.TIPO === "educativo") {
  await educativoDelDia();
  process.exit(0);
}

const relojes = await leerCatalogo();
console.log(`Relojes disponibles encontrados: ${relojes.length}`);
if (relojes.length === 0) throw new Error("No encontré relojes disponibles en el catálogo");

const { reloj, nuevoHistorial } = elegir(relojes);

let imagen = armarImagen(reloj, OVERLAY);
if (OVERLAY && !(await imagenFunciona(imagen))) {
  console.log("La imagen con texto falló, uso la foto sola.");
  imagen = armarImagen(reloj, false);
}
const caption = armarCaption(reloj);

console.log("\n===== RELOJ ELEGIDO =====");
console.log(JSON.stringify(reloj, null, 2));
console.log("\n===== IMAGEN =====\n" + imagen);
console.log("\n===== TEXTO =====\n" + caption + "\n");

if (DRY_RUN) {
  console.log("MODO PRUEBA: no se publicó nada.");
} else {
  if (!process.env.IG_TOKEN) {
    throw new Error("Falta el secret IG_TOKEN");
  }
  const postId = await publicar(imagen, caption);
  writeFileSync(HISTORIAL, JSON.stringify(nuevoHistorial, null, 2) + "\n");
  console.log(`✅ Publicado en Instagram (id ${postId})`);
}
