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
    writeFileSync(HISTORIAL, "[]\n");
  }
  const reloj = pendientes[Math.floor(Math.random() * pendientes.length)];
  return { reloj, nuevoHistorial: [...nuevoHistorial, reloj.clave] };
}

// ---------- 3. Armar la imagen (Cloudinary la genera sola) ----------

const textoCloudinary = (t) =>
  encodeURIComponent(t).replace(/%2C/g, "%252C").replace(/%2F/g, "%252F");

function armarImagen(reloj, conTexto, fuente = "Montserrat") {
  // Formato 4:5 (1080x1350), JPG (Instagram solo acepta JPG).
  // Con texto: foto arriba + franja navy (#0B1929, color de la web) con nombre y precio.
  if (!conTexto) {
    const tx = "c_fill,g_center,w_1080,h_1350/f_jpg,q_90";
    return reloj.foto.replace(/\/upload\/(?:[^/]+\/)*?(v\d+\/)/, `/upload/${tx}/$1`);
  }
  const nombre = reloj.titulo.length > 34 ? reloj.titulo.slice(0, 32) + "…" : reloj.titulo;
  const f = (size, extra) => `${fuente}_${size}_${extra}`;
  const tx = [
    "c_fill,g_center,w_1080,h_1110",
    "c_pad,w_1080,h_1350,g_north,b_rgb:0b1929",
    `l_text:${f(42, "bold_italic")}:${textoCloudinary(nombre.toUpperCase())},co_white/fl_layer_apply,g_south,y_150`,
    `l_text:${f(76, "bold_italic")}:${textoCloudinary("$" + reloj.precioTarjeta)},co_white/fl_layer_apply,g_south,y_52`,
    `l_text:${f(26, "bold_letter_spacing_10")}:${textoCloudinary("VALETTO")},co_rgb:7a94a8/fl_layer_apply,g_south_east,x_40,y_20`,
    "f_jpg,q_90",
  ].join("/");
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

const HIST_EDU = "posted-edu.json";
const leerJSON = (f, def) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : def);
const guardarJSON = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2) + "\n");

function planEducativo() {
  const posts = leerJSON("contenido/educativo.json", []);
  const hechos = leerJSON(HIST_EDU, []);
  const post = posts.find((p) => !hechos.includes(p.n));
  if (!post) return null;
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
  return { tipo: "educativo", clave: post.n, titulo: `Educativo #${post.n}: ${post.gancho}`, imagenes, caption };
}

async function planReloj() {
  const relojes = await leerCatalogo();
  console.log(`Relojes disponibles encontrados: ${relojes.length}`);
  if (relojes.length === 0) throw new Error("No encontré relojes disponibles en el catálogo");
  const { reloj } = elegir(relojes);
  let imagen = armarImagen(reloj, OVERLAY);
  if (OVERLAY && !(await imagenFunciona(imagen))) imagen = armarImagen(reloj, true, "Arial");
  if (OVERLAY && !(await imagenFunciona(imagen))) imagen = armarImagen(reloj, false);
  return { tipo: "reloj", clave: reloj.clave, titulo: `Reloj del día: ${reloj.titulo}`, imagenes: [imagen], caption: armarCaption(reloj) };
}

function marcarHecho(plan) {
  if (plan.tipo === "educativo") {
    guardarJSON(HIST_EDU, [...leerJSON(HIST_EDU, []), plan.clave]);
  } else {
    let h = leerJSON(HISTORIAL, []);
    guardarJSON(HISTORIAL, [...h, plan.clave]);
  }
}

// ---------- Telegram (vista previa antes de publicar) ----------

const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const hayTelegram = Boolean(TG_TOKEN && TG_CHAT);

async function tg(metodo, datos) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`Telegram: ${d.description}`);
  return d.result;
}

const recortar = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

async function enviarVistaPrevia(plan, hora) {
  if (plan.imagenes.length === 1) {
    await tg("sendPhoto", { chat_id: TG_CHAT, photo: plan.imagenes[0], caption: recortar(plan.caption, 1024) });
  } else {
    await tg("sendMediaGroup", {
      chat_id: TG_CHAT,
      media: plan.imagenes.map((url, i) => ({ type: "photo", media: url, ...(i === 0 ? { caption: recortar(plan.caption, 1024) } : {}) })),
    });
  }
  const aviso = await tg("sendMessage", {
    chat_id: TG_CHAT,
    text: `👀 VISTA PREVIA — ${plan.titulo}\n\nSale a las ${hora}.\nSi NO querés que se publique, respondé NO a este mensaje.\nSi está bien, no hagas nada.`,
  });
  return aviso.message_id;
}

async function fueCancelado(pendiente) {
  if (!hayTelegram || !pendiente.mensaje) return false;
  const updates = await tg("getUpdates", { allowed_updates: ["message"] });
  return updates.some((u) => {
    const m = u.message;
    if (!m || String(m.chat.id) !== String(TG_CHAT)) return false;
    if (m.date < pendiente.creado) return false;
    const dice_no = /^\s*no\b/i.test(m.text || "");
    const respondeA = m.reply_to_message?.message_id;
    return dice_no && (!respondeA || respondeA === pendiente.mensaje);
  });
}

async function avisar(texto) {
  if (!hayTelegram) return;
  try { await tg("sendMessage", { chat_id: TG_CHAT, text: texto }); } catch (e) { console.log(e.message); }
}

async function publicarPlan(plan) {
  return plan.imagenes.length === 1
    ? publicar(plan.imagenes[0], plan.caption)
    : publicarCarrusel(plan.imagenes, plan.caption);
}

async function enlace(id) {
  try { return (await graph(id, { fields: "permalink" }, "GET")).permalink || ""; } catch { return ""; }
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
// ACCION: "prueba" (no publica), "vista_previa" (manda a Telegram), "publicar"

const TIPO = process.env.TIPO === "educativo" ? "educativo" : "reloj";
const ACCION = DRY_RUN ? "prueba" : process.env.ACCION || "publicar";
const PENDIENTE = `pendiente-${TIPO}.json`;
const HORA = TIPO === "educativo" ? "11:52" : "18:52";
console.log(`Tipo: ${TIPO} · Acción: ${ACCION} · Telegram: ${hayTelegram ? "sí" : "no"}`);

if (process.env.IG_TOKEN) {
  try {
    const yo = await graph("me", { fields: "user_id,username" }, "GET");
    console.log(`Token OK: conectado como @${yo.username}`);
  } catch (e) {
    console.log("⚠️ El token no funciona:", e.message);
    if (ACCION === "publicar") {
      await avisar(`⚠️ No pude publicar en Instagram: el token no funciona (${e.message}). Hay que generar uno nuevo.`);
      throw e;
    }
  }
} else {
  console.log("⚠️ Todavía no está cargado el secret IG_TOKEN.");
}

const mostrar = (plan) => {
  console.log(`\n===== ${plan.titulo} =====`);
  console.log(plan.imagenes.join("\n"));
  console.log("\n" + plan.caption + "\n");
};

if (ACCION === "prueba" || ACCION === "vista_previa") {
  const plan = TIPO === "educativo" ? planEducativo() : await planReloj();
  if (!plan) {
    console.log("No quedan educativos sin publicar. Agregá nuevos en contenido/educativo.json.");
    await avisar("📚 Se terminaron los educativos programados. Pedile a Claude que arme más.");
    process.exit(0);
  }
  mostrar(plan);
  if (ACCION === "prueba") {
    console.log("MODO PRUEBA: no se publicó nada.");
  } else if (!hayTelegram) {
    console.log("Telegram no está configurado: no mando vista previa.");
  } else {
    const mensaje = await enviarVistaPrevia(plan, HORA);
    guardarJSON(PENDIENTE, { ...plan, creado: Math.floor(Date.now() / 1000), mensaje });
    console.log("📲 Vista previa enviada a Telegram.");
  }
  process.exit(0);
}

// ACCION === "publicar"
if (!process.env.IG_TOKEN) throw new Error("Falta el secret IG_TOKEN");
let pendiente = leerJSON(PENDIENTE, null);
if (pendiente && Date.now() / 1000 - pendiente.creado > 20 * 3600) pendiente = null; // vista previa vieja
const plan = pendiente || (TIPO === "educativo" ? planEducativo() : await planReloj());
if (!plan) {
  console.log("No hay nada para publicar.");
  process.exit(0);
}
mostrar(plan);

if (pendiente && (await fueCancelado(pendiente))) {
  console.log("❌ Cancelado desde Telegram: no se publica.");
  marcarHecho(plan); // para que mañana salga otro
  if (existsSync(PENDIENTE)) writeFileSync(PENDIENTE, "null\n");
  await avisar(`❌ Listo, NO publiqué: ${plan.titulo}. Mañana sale el siguiente.`);
  process.exit(0);
}

await renovarToken();
const postId = await publicarPlan(plan);
marcarHecho(plan);
if (existsSync(PENDIENTE)) writeFileSync(PENDIENTE, "null\n");
const link = await enlace(postId);
console.log(`✅ Publicado en Instagram (id ${postId}) ${link}`);
await avisar(`✅ Publicado: ${plan.titulo}\n${link}`);
