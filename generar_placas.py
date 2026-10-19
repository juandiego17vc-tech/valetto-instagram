"""Genera las placas (JPG 1080x1350) de los carruseles educativos de Valetto.

Estilo: el de @valetto.relojes -> títulos en Montserrat Black Italic, mayúsculas,
azul eléctrico con sombra; fondos navy y blanco.

Uso:  python generar_placas.py          -> genera los 30
      python generar_placas.py 1 3      -> genera solo el 1 y el 3
Salida: contenido/imagenes/NN-K.jpg
"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1350
# Paleta de valetto.com.ar
NAVY = (11, 25, 41)           # #0B1929 (fondo principal de la web)
NAVY_TXT = (11, 25, 41)
BLUE_TOP = (45, 74, 98)       # #2D4A62
BLUE_BOT = (11, 25, 41)       # #0B1929
BLUE = (122, 148, 168)        # #7A94A8 (azul acero de la web)
STEEL_LIGHT = (200, 205, 212) # #C8CDD4
WHITE = (255, 255, 255)
LIGHT = (240, 242, 245)       # #F0F2F5 (fondo de las tarjetas)
GREY = (122, 148, 168)
BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "contenido", "imagenes")


def body(size, weight=500):
    f = ImageFont.truetype(os.path.join(BASE, "fonts", "Outfit.ttf"), size)
    f.set_variation_by_axes([weight])
    return f


def font(size, weight=800, italic=False):
    f = ImageFont.truetype(os.path.join(BASE, "fonts", "Montserrat-Italic.ttf" if italic else "Montserrat.ttf"), size)
    f.set_variation_by_axes([weight])
    return f


def gradiente(w, h):
    g = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(g)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(BLUE_TOP, BLUE_BOT)))
    return g


def fondo(oscuro):
    img = Image.new("RGB", (W, H), NAVY if oscuro else LIGHT)
    if oscuro:  # brillo azul suave arriba a la derecha
        glow = Image.new("L", (W, H), 0)
        gd = ImageDraw.Draw(glow)
        for r in range(760, 0, -12):
            gd.ellipse((W * 0.9 - r, H * 0.0 - r, W * 0.9 + r, H * 0.0 + r), fill=int(70 * (1 - r / 760)))
        img = Image.composite(Image.new("RGB", (W, H), (45, 74, 98)), img, glow)
    return img


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


def titulo(img, texto, size, y, ancho, oscuro, max_lineas=5):
    """Título estilo Instagram: Black Italic, mayúsculas, azul degradé + sombra."""
    d = ImageDraw.Draw(img)
    texto = texto.upper()
    while True:
        f = font(size, 900, italic=True)
        lineas = envolver(d, texto, f, ancho)
        if len(lineas) <= max_lineas or size < 50:
            break
        size -= 6
    alto = size * 1.08
    for linea in lineas:
        tw = d.textlength(linea, font=f)
        x = (W - tw) / 2
        # sombra
        sombra = (0, 0, 0) if oscuro else STEEL_LIGHT
        d.text((x + 6, y + 7), linea, font=f, fill=sombra)
        # relleno degradé a través de una máscara
        mask = Image.new("L", (W, int(alto + size)), 0)
        ImageDraw.Draw(mask).text((x, 0), linea, font=f, fill=255,
                                  stroke_width=0)
        if oscuro:
            relleno = Image.new("RGB", mask.size, WHITE)
        else:
            relleno = gradiente(W, mask.size[1])
        img.paste(relleno, (0, int(y)), mask)
        y += alto
    return y


def parrafo(d, texto, f, fill, y, ancho=860, interlineado=1.42):
    for linea in envolver(d, texto, f, ancho):
        d.text(((W - d.textlength(linea, font=f)) / 2, y), linea, font=f, fill=fill)
        y += f.size * interlineado
    return y


def alto_titulo(d, texto, size, ancho):
    return len(envolver(d, texto.upper(), font(size, 900, True), ancho)) * size * 1.08


def alto_parrafo(d, texto, f, ancho=860, interlineado=1.42):
    return len(envolver(d, texto, f, ancho)) * f.size * interlineado


def espaciado(d, texto, f, fill, y, track):
    anchos = [d.textlength(c, font=f) for c in texto]
    x = (W - (sum(anchos) + track * (len(texto) - 1))) / 2
    for c, a in zip(texto, anchos):
        d.text((x, y), c, font=f, fill=fill)
        x += a + track


def marco(d, k, total, oscuro):
    tono = WHITE if oscuro else NAVY_TXT
    espaciado(d, "VALETTO", font(30, 800), tono, 92, 12)
    # puntitos de página
    r, gap = 7, 26
    x0 = W / 2 - (total - 1) * gap / 2
    for i in range(total):
        cx = x0 + i * gap
        color = BLUE if i == k - 1 else ((70, 90, 120) if oscuro else (200, 208, 220))
        d.ellipse((cx - r, H - 150 - r, cx + r, H - 150 + r), fill=color)
    espaciado(d, "@valetto.relojes", font(24, 600), GREY if not oscuro else (150, 170, 200), H - 112, 2)


def portada(post, total):
    img = fondo(True)
    d = ImageDraw.Draw(img)
    marco(d, 1, total, True)
    fs = body(46, 400)
    h1 = alto_titulo(d, post["gancho"], 96, 900)
    h2 = alto_parrafo(d, post["sub"], fs)
    y = (H - (h1 + 70 + h2)) / 2 + 10
    # etiqueta azul
    et = f"ESCUELA VALETTO · Nº {post['n']:02d}"
    fe = font(26, 800)
    tw = d.textlength(et, font=fe) + 48
    d.rounded_rectangle(((W - tw) / 2, y - 110, (W + tw) / 2, y - 60), radius=25, fill=BLUE)
    d.text(((W - d.textlength(et, font=fe)) / 2, y - 101), et, font=fe, fill=NAVY)
    y = titulo(img, post["gancho"], 96, y, 900, True)
    parrafo(d, post["sub"], fs, STEEL_LIGHT, y + 40)
    espaciado(d, "DESLIZÁ  →", font(26, 800), WHITE, H - 235, 5)
    return img


def interior(tit, texto, k, total):
    img = fondo(False)
    d = ImageDraw.Draw(img)
    marco(d, k, total, False)
    fb = body(58, 400)
    ht = alto_titulo(d, tit, 92, 900)
    hb = alto_parrafo(d, texto, fb)
    y = (H - (ht + 90 + hb)) / 2
    y = titulo(img, tit, 92, y, 900, False)
    d.rounded_rectangle((W / 2 - 45, y + 32, W / 2 + 45, y + 40), radius=4, fill=BLUE)
    parrafo(d, texto, fb, NAVY_TXT, y + 85)
    return img


def cierre(k, total):
    img = fondo(True)
    d = ImageDraw.Draw(img)
    marco(d, k, total, True)
    y = titulo(img, "¿Te sirvió?", 110, 380, 900, True)
    y = parrafo(d, "Guardalo para tenerlo a mano y compartilo con quien lo necesite.",
                body(50, 400), STEEL_LIGHT, y + 40)
    y = parrafo(d, "Relojes originales con garantía", body(44, 400), BLUE, y + 70)
    fl = font(46, 900, True)
    url = "VALETTO.COM.AR"
    tw = d.textlength(url, font=fl) + 80
    d.rounded_rectangle(((W - tw) / 2, y + 40, (W + tw) / 2, y + 130), radius=45, fill=BLUE)
    d.text(((W - d.textlength(url, font=fl)) / 2, y + 58), url, font=fl, fill=NAVY)
    return img


def generar(post):
    total = len(post["slides"]) + 2
    nn = f"{post['n']:02d}"
    placas = [portada(post, total)]
    placas += [interior(t, x, i + 2, total) for i, (t, x) in enumerate(post["slides"])]
    placas.append(cierre(total, total))
    for k, img in enumerate(placas, 1):
        img.save(os.path.join(OUT, f"{nn}-{k}.jpg"), "JPEG", quality=92)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    posts = json.load(open(os.path.join(BASE, "contenido", "educativo.json"), encoding="utf-8"))
    pedidos = {int(a) for a in sys.argv[1:]}
    for p in posts:
        if not pedidos or p["n"] in pedidos:
            generar(p)
            print("ok", p["n"])
