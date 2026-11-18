"""Genera las placas del PRÓXIMO educativo pendiente con fotos profesionales de Pixabay.

- Busca el primer educativo no publicado (contenido/educativo*.json vs posted-edu.json).
- Si ya tiene placas en contenido/generadas/, no hace nada.
- Con PIXABAY_KEY: baja una foto profesional según el campo "foto" del post
  (filtrando marcas que Valetto no vende) y arma el carrusel sobre esa foto.
- Sin clave o sin resultados: arma el carrusel con fondo navy de marca.

Uso: python3 generar_educativo.py            -> el próximo pendiente
     python3 generar_educativo.py 31 --force -> rehace el 31
"""
import io, json, os, sys, glob, random, urllib.request, urllib.parse
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

W, H = 1080, 1350
BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "contenido", os.environ.get("SALIDA", "generadas"))
NAVY = (11, 25, 41)
STEEL = (122, 148, 168)
STEEL_LIGHT = (200, 205, 212)
WHITE = (255, 255, 255)
TEXT = (232, 237, 243)
MARCAS_PROHIBIDAS = ["rolex", "omega", "patek", "audemars", "cartier", "breitling", "tag heuer", "hublot",
                     "apple", "smartwatch", "fitbit", "garmin", "samsung", "iwatch", "panerai", "iwc",
                     "longines", "tudor", "vacheron", "jaeger", "chopard", "richard mille", "phone", "woman", "girl"]


# ---------- tipografías ----------
def mont(size, weight=900, italic=True):
    f = ImageFont.truetype(os.path.join(BASE, "fonts", "Montserrat-Italic.ttf" if italic else "Montserrat.ttf"), size)
    f.set_variation_by_axes([weight])
    return f


def outfit(size, weight=400):
    f = ImageFont.truetype(os.path.join(BASE, "fonts", "Outfit.ttf"), size)
    f.set_variation_by_axes([weight])
    return f


# ---------- datos ----------
def leer(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def todos_los_posts():
    posts = []
    for p in sorted(glob.glob(os.path.join(BASE, "contenido", "educativo*.json"))):
        posts += leer(p, [])
    return sorted(posts, key=lambda p: p["n"])


# ---------- foto ----------
def log(msg):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "log.txt"), "a", encoding="utf-8") as f:
        import datetime
        f.write(f"{datetime.datetime.utcnow():%Y-%m-%d %H:%M} {msg}\n")

def buscar_foto(query, usadas):
    url = os.environ.get("FOTO_URL")  # para muestras: una foto puntual
    if url:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r:
            return Image.open(io.BytesIO(r.read())).convert("RGB"), {"id": 0, "user": "muestra", "pageURL": url}
    key = os.environ.get("PIXABAY_KEY")
    if not key or not query:
        log(f"Sin {'clave de Pixabay' if not key else 'búsqueda'}: uso fondo de marca")
        return None
    for orient in ("vertical", "all"):
        params = urllib.parse.urlencode({
            "key": key, "q": query, "image_type": "photo", "orientation": orient,
            "safesearch": "true", "per_page": 40, "min_width": 1080, "order": "popular"})
        try:
            req = urllib.request.Request(f"https://pixabay.com/api/?{params}",
                                         headers={"User-Agent": "Mozilla/5.0 (valetto-instagram bot)", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                hits = json.load(r).get("hits", [])
        except Exception as e:
            print("Pixabay error:", e)
            log(f"Pixabay error: {e}")
            return None
        log(f"Pixabay '{query}' ({orient}): {len(hits)} resultados")
        buenos = [h for h in hits
                  if h["id"] not in usadas
                  and not any(m in h.get("tags", "").lower() for m in MARCAS_PROHIBIDAS)]
        if buenos:
            h = random.choice(buenos[:6])  # una de las más populares, variando
            try:
                with urllib.request.urlopen(urllib.request.Request(h["largeImageURL"], headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r:
                    img = Image.open(io.BytesIO(r.read())).convert("RGB")
                print(f"Foto Pixabay {h['id']} de {h.get('user')} · {h.get('tags')}")
                return img, h
            except Exception as e:
                print("No pude bajar la foto:", e)
    return None


def cubrir(img):
    """Recorta la foto para llenar 1080x1350 sin deformar."""
    r = max(W / img.width, H / img.height)
    img = img.resize((round(img.width * r), round(img.height * r)), Image.LANCZOS)
    x, y = (img.width - W) // 2, (img.height - H) // 2
    return img.crop((x, y, x + W, y + H))


def fondo_marca():
    img = Image.new("RGB", (W, H), NAVY)
    glow = Image.new("L", (W, H), 0)
    g = ImageDraw.Draw(glow)
    for r in range(800, 0, -12):
        g.ellipse((W * 0.85 - r, -r, W * 0.85 + r, r), fill=int(80 * (1 - r / 800)))
    return Image.composite(Image.new("RGB", (W, H), (45, 74, 98)), img, glow)


def degradado(img, desde=0.35, hasta=1.0, alfa_max=245, arriba=True):
    """Oscurece la parte de abajo (y un poco la de arriba) con navy, para que el texto se lea."""
    capa = Image.new("RGBA", (W, H), NAVY + (0,))
    a = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(a)
    y0 = int(H * desde)
    for y in range(y0, H):
        t = (y - y0) / max(1, (H * hasta - y0))
        d.line([(0, y), (W, y)], fill=int(alfa_max * min(1, t) ** 1.2))
    if arriba:
        for y in range(0, 260):
            d.line([(0, y), (W, y)], fill=max(a.getpixel((0, y)), int(150 * (1 - y / 260))))
    capa.putalpha(a)
    base = img.convert("RGBA")
    base.alpha_composite(capa)
    return base.convert("RGB")


def velado(img, alfa=185, blur=24):
    """Foto desenfocada y oscurecida para las placas de adentro."""
    b = img.filter(ImageFilter.GaussianBlur(blur))
    b = ImageEnhance.Color(b).enhance(0.6)
    capa = Image.new("RGBA", (W, H), NAVY + (alfa,))
    b = b.convert("RGBA")
    b.alpha_composite(capa)
    return b.convert("RGB")


# ---------- texto ----------
def envolver(d, texto, f, ancho):
    lineas, actual = [], ""
    for palabra in texto.split():
        prueba = (actual + " " + palabra).strip()
        if d.textlength(prueba, font=f) <= ancho or not actual:
            actual = prueba
        else:
            lineas.append(actual)
            actual = palabra
    if actual:
        lineas.append(actual)
    return lineas


def titulo_ajustado(d, texto, size, ancho, max_lineas):
    while True:
        f = mont(size)
        lineas = envolver(d, texto, f, ancho)
        if len(lineas) <= max_lineas or size <= 52:
            return f, lineas
        size -= 4


def escribir(img, lineas, f, y, fill, align="left", x=90, interlineado=1.1, sombra=True):
    d = ImageDraw.Draw(img)
    alto = f.size * interlineado
    for l in lineas:
        tw = d.textlength(l, font=f)
        xx = (W - tw) / 2 if align == "center" else x
        if sombra:
            d.text((xx + 4, y + 5), l, font=f, fill=(0, 0, 0))
        d.text((xx, y), l, font=f, fill=fill)
        y += alto
    return y


def pastilla(d, texto, x, y, f, fondo=STEEL, color=NAVY, pad=(22, 12)):
    tw = d.textlength(texto, font=f)
    d.rounded_rectangle((x, y, x + tw + pad[0] * 2, y + f.size + pad[1] * 2), radius=(f.size + pad[1] * 2) // 2, fill=fondo)
    d.text((x + pad[0], y + pad[1] - 2), texto, font=f, fill=color)


def pie(img, k, total):
    d = ImageDraw.Draw(img)
    r, gap = 6, 24
    x0 = 90
    for i in range(total):
        cx = x0 + i * gap
        d.ellipse((cx - r, H - 96 - r, cx + r, H - 96 + r), fill=WHITE if i == k - 1 else (90, 110, 135))
    f = mont(24, 800, italic=False)
    tw = d.textlength("VALETTO", font=f) + 6 * 8
    x = W - 90 - tw
    for ch in "VALETTO":
        d.text((x, H - 110), ch, font=f, fill=STEEL_LIGHT)
        x += d.textlength(ch, font=f) + 8


# ---------- placas ----------
def portada(foto, post, total):
    img = degradado(cubrir(foto), desde=0.38) if foto else fondo_marca()
    d = ImageDraw.Draw(img)
    pastilla(d, f"ESCUELA VALETTO · Nº {post['n']:02d}", 90, 90, mont(24, 800, italic=False))
    f, lineas = titulo_ajustado(d, post["gancho"].upper(), 92, W - 180, 4)
    fs = outfit(42, 400)
    sub = envolver(d, post["sub"], fs, W - 180)
    alto = len(lineas) * f.size * 1.05 + 30 + len(sub) * fs.size * 1.3
    y = H - 170 - alto
    d.rectangle((90, y - 34, 170, y - 26), fill=STEEL)
    y = escribir(img, lineas, f, y, WHITE, interlineado=1.05)
    escribir(img, sub, fs, y + 24, STEEL_LIGHT, interlineado=1.3, sombra=False)
    d = ImageDraw.Draw(img)
    d.text((W - 90 - d.textlength("DESLIZÁ  →", font=mont(24, 800, False)), 100), "DESLIZÁ  →",
           font=mont(24, 800, False), fill=WHITE)
    pie(img, 1, total)
    return img


def interior(fondo, titulo, texto, k, total):
    img = fondo.copy()
    d = ImageDraw.Draw(img)
    num = f"{k - 1:02d}"
    d.text((90, 150), num, font=mont(150, 900), fill=(60, 84, 108))
    f, lineas = titulo_ajustado(d, titulo.upper(), 74, W - 180, 3)
    fb = outfit(50, 400)
    cuerpo = envolver(d, texto, fb, W - 180)
    y = 400
    y = escribir(img, lineas, f, y, WHITE, interlineado=1.08)
    d = ImageDraw.Draw(img)
    d.rectangle((90, y + 28, 170, y + 36), fill=STEEL)
    escribir(img, cuerpo, fb, y + 80, TEXT, interlineado=1.42, sombra=False)
    pie(img, k, total)
    return img


def cierre(fondo, total):
    img = fondo.copy()
    d = ImageDraw.Draw(img)
    f, lineas = titulo_ajustado(d, "¿TE SIRVIÓ?", 110, W - 180, 2)
    y = escribir(img, lineas, f, 420, WHITE, align="center")
    y = escribir(img, envolver(d, "Guardalo para tenerlo a mano y compartilo con quien lo necesite.", outfit(48), W - 220),
                 outfit(48), y + 40, TEXT, align="center", interlineado=1.4, sombra=False)
    y = escribir(img, ["Relojes originales con garantía"], outfit(40, 300), y + 60, STEEL_LIGHT, align="center", sombra=False)
    d = ImageDraw.Draw(img)
    fl = mont(44, 900)
    tw = d.textlength("VALETTO.COM.AR", font=fl)
    pastilla(d, "VALETTO.COM.AR", (W - tw - 80) / 2, y + 40, fl, fondo=WHITE, color=NAVY, pad=(40, 18))
    pie(img, total, total)
    return img


def generar(post):
    usadas = leer(os.path.join(OUT, "usadas.json"), [])
    res = buscar_foto(post.get("foto"), usadas)
    foto, hit = res if res else (None, None)
    total = len(post["slides"]) + 2
    fondo_int = velado(cubrir(foto)) if foto else fondo_marca()
    placas = [portada(foto, post, total)]
    placas += [interior(fondo_int, t, x, i + 2, total) for i, (t, x) in enumerate(post["slides"])]
    placas.append(cierre(fondo_int, total))
    os.makedirs(OUT, exist_ok=True)
    nn = f"{post['n']:02d}"
    for k, img in enumerate(placas, 1):
        img.save(os.path.join(OUT, f"{nn}-{k}.jpg"), "JPEG", quality=90, optimize=True, progressive=True)
    info = {"n": post["n"], "total": total,
            "foto": {"id": hit["id"], "autor": hit.get("user"), "pagina": hit.get("pageURL")} if hit else None}
    with open(os.path.join(OUT, f"{nn}.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
    if hit and hit["id"]:
        with open(os.path.join(OUT, "usadas.json"), "w") as f:
            json.dump(usadas + [hit["id"]], f)
    print(f"Placas del educativo #{post['n']} listas ({total}) · foto: {'Pixabay ' + str(hit['id']) if hit else 'fondo de marca'}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    forzar = "--force" in sys.argv
    posts = todos_los_posts()
    if args:
        objetivo = [p for p in posts if p["n"] in {int(a) for a in args}]
    else:
        hechos = set(leer(os.path.join(BASE, "posted-edu.json"), []))
        objetivo = [p for p in posts if p["n"] not in hechos][:1]
    for p in objetivo:
        if p["n"] <= 30 and not args:
            continue  # los 1-30 ya tienen sus placas viejas
        ya = os.path.exists(os.path.join(OUT, f"{p['n']:02d}-1.jpg"))
        info = leer(os.path.join(OUT, f"{p['n']:02d}.json"), {})
        if ya and info.get("foto") is None and os.environ.get("PIXABAY_KEY"):
            ya = False  # se había hecho sin foto: ahora que hay clave, la rehago con foto
        if ya and not forzar:
            print(f"El educativo #{p['n']} ya tiene placas.")
            continue
        generar(p)
