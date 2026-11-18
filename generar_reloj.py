"""Arma el carrusel del reloj del día (3 placas 1080x1350) con el estilo de los educativos.

Uso: python3 generar_reloj.py datos.json carpeta_salida
datos.json: {id, titulo, marca, precioTarjeta, precioTransferencia, movimiento, diametro, agua,
             cristal, correa, caja, usado, foto_ia, fotos:[urls]}
Placa 1: foto con fondo IA a pantalla completa + nombre y precio.
Placa 2: ficha técnica sobre la foto desenfocada.
Placa 3: segunda foto del reloj (si hay) + cómo comprarlo.
"""
import io, json, os, sys, urllib.request
from PIL import Image, ImageDraw
import generar_educativo as g

W, H = g.W, g.H
NAVY, STEEL, STEEL_LIGHT, WHITE, TEXT = g.NAVY, g.STEEL, g.STEEL_LIGHT, g.WHITE, g.TEXT


def bajar(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 valetto-bot"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def may(s):
    return s[:1].upper() + s[1:] if s else s


def portada(foto, r, total):
    img = g.degradado(g.cubrir(foto), desde=0.5, alfa_max=250)
    d = ImageDraw.Draw(img)
    g.pastilla(d, "RELOJ DEL DÍA", 90, 90, g.mont(24, 800, italic=False))
    estado = "USADO · ORIGINAL" if r.get("usado") else "ORIGINAL · CON GARANTÍA"
    fe = g.mont(24, 800, italic=False)
    d.text((W - 90 - d.textlength(estado, font=fe), 100), estado, font=fe, fill=WHITE)
    marca = (r.get("marca") or "").upper()
    modelo = r["titulo"][len(r.get("marca") or ""):].strip() or r["titulo"]
    f, lineas = g.titulo_ajustado(d, modelo.upper(), 70, W - 180, 3)
    fp = g.mont(96, 900)
    alto = 40 + len(lineas) * f.size * 1.05 + 30 + fp.size + 60
    y = H - 140 - alto
    d.text((90, y), marca, font=g.mont(34, 800, italic=False), fill=STEEL_LIGHT)
    y = g.escribir(img, lineas, f, y + 46, WHITE, interlineado=1.05)
    d = ImageDraw.Draw(img)
    d.rectangle((90, y + 18, 170, y + 26), fill=STEEL)
    g.escribir(img, [f"${r['precioTarjeta']}"], fp, y + 44, WHITE)
    ft = g.outfit(36, 400)
    d.text((90, y + 44 + fp.size + 14), f"${r['precioTransferencia']} por transferencia o efectivo",
           font=ft, fill=STEEL_LIGHT)
    g.pie(img, 1, total)
    return img


def ficha(fondo, r, total):
    img = fondo.copy()
    d = ImageDraw.Draw(img)
    f, lineas = g.titulo_ajustado(d, "FICHA TÉCNICA", 80, W - 180, 1)
    y = g.escribir(img, lineas, f, 170, WHITE)
    d = ImageDraw.Draw(img)
    d.rectangle((90, y + 20, 170, y + 28), fill=STEEL)
    datos = [("Movimiento", r.get("movimiento")), ("Diámetro", r.get("diametro")),
             ("Resistencia al agua", r.get("agua")), ("Cristal", r.get("cristal")),
             ("Malla", r.get("correa")), ("Caja", r.get("caja"))]
    datos = [(k, may(v)) for k, v in datos if v]
    fk, fv = g.outfit(30, 500), g.outfit(46, 400)
    y += 90
    for k, v in datos[:6]:
        d.text((90, y), k.upper(), font=fk, fill=STEEL)
        lineas = g.envolver(d, v, fv, W - 180)[:2]
        yy = y + 42
        for l in lineas:
            d.text((90, yy), l, font=fv, fill=WHITE)
            yy += fv.size * 1.25
        y = yy + 22
        d.line((90, y - 10, W - 90, y - 10), fill=(60, 84, 108), width=2)
    g.pie(img, 2, total)
    return img


def compra(foto2, r, total):
    img = g.degradado(g.cubrir(foto2), desde=0.3, alfa_max=252) if foto2 else g.fondo_marca()
    d = ImageDraw.Draw(img)
    f, lineas = g.titulo_ajustado(d, "LLEVALO HOY", 88, W - 180, 1)
    items = ["1 año de garantía Valetto",
             "Envío gratis desde $200.000 · en CABA siempre gratis",
             "Oficina en Av. Callao 468, CABA (con cita previa)",
             "Precio con tarjeta en 1 pago · cuotas en la web"]
    fi = g.outfit(40, 400)
    bloques = [g.envolver(d, t, fi, W - 230) for t in items]
    alto = f.size * 1.1 + 50 + sum(len(b) * fi.size * 1.3 + 26 for b in bloques) + 170
    y = H - 140 - alto
    y = g.escribir(img, lineas, f, y, WHITE)
    d = ImageDraw.Draw(img)
    y += 40
    for b in bloques:
        d.ellipse((92, y + 14, 106, y + 28), fill=STEEL)
        for l in b:
            d.text((130, y), l, font=fi, fill=TEXT)
            y += fi.size * 1.3
        y += 26
    fl = g.mont(38, 900)
    g.pastilla(d, "WHATSAPP 11 6931-2299", 90, y + 20, fl, fondo=WHITE, color=NAVY, pad=(34, 16))
    g.pie(img, 3, total)
    return img


def generar(datos, salida):
    os.makedirs(salida, exist_ok=True)
    foto = bajar(datos["foto_ia"])
    otras = [u for u in datos.get("fotos", []) if u][1:]
    foto2 = None
    for u in otras[:2]:
        try:
            foto2 = bajar(u)
            break
        except Exception as e:
            print("No pude bajar la segunda foto:", e)
    total = 3
    placas = [portada(foto, datos, total), ficha(g.velado(g.cubrir(foto)), datos, total), compra(foto2 or foto, datos, total)]
    rutas = []
    for k, img in enumerate(placas, 1):
        p = os.path.join(salida, f"reloj-{datos['id']}-{k}.jpg")
        img.save(p, "JPEG", quality=90, optimize=True, progressive=True)
        rutas.append(p)
    print("\n".join(rutas))
    return rutas


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as f:
        generar(json.load(f), sys.argv[2])
