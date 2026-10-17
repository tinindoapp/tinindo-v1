#!/usr/bin/env python3
"""Monta o pacote 'marca-pronta': todos os arquivos gráficos prontos para download e uso."""
import os, sys, json, re, struct, shutil
sys.path.insert(0, os.path.dirname(__file__))
import geom as G
T = os.environ["TOUT"]; TOOLS = os.path.dirname(os.path.abspath(__file__))
P = f"{T}/marca-pronta"; HT = f"{TOOLS}/pack_html"; os.makedirs(HT, exist_ok=True)
jobs = []; _n = [0]

def W(path, s, mode="w"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, mode).write(s)

def vb(svg): return [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]

def page(body, bg="transparent", extra_css=""):
    _n[0] += 1; h = f"{HT}/p{_n[0]}.html"
    open(h, "w").write(f"<!doctype html><html><head><meta charset='utf-8'><style>html,body{{margin:0;padding:0;background:{bg}}}{extra_css}</style></head><body>{body}</body></html>")
    return "file://" + h

def png_of(svgpath, out, w, h, bg=None):
    url = page(f"<img src='file://{svgpath}' style='width:{w}px;height:{h}px;display:block'>", bg or "transparent")
    jobs.append({"url": url, "out": out, "w": w, "h": h, "transparent": bg is None})

def pdf_of(svgpath, out, wpx, hpx):
    url = page(f"<img src='file://{svgpath}' style='width:{wpx}px;height:{hpx}px;display:block'>", extra_css="@page{margin:0}")
    jobs.append({"url": url, "out": out, "pdf": True, "pw": wpx, "ph": hpx, "w": wpx, "h": hpx})

VAR = {"cor": "color", "negativo": "dark", "preto": "black", "branco": "white"}
DESC = {"cor": "fundo claro (branco ou papel)", "negativo": "fundo escuro (preto)", "preto": "uma cor, impressão em preto", "branco": "uma cor, branco sobre fundo escuro ou foto calma"}

# ---------------------------------------------------------------- 01 palavra
for nm, m in VAR.items():
    s = G.wordmark_svg(m, pfx="w"); p = f"{P}/01-logotipo-palavra/svg/tinindo-palavra-{nm}.svg"; W(p, s)
    v = vb(s); ratio = v[3]/v[2]
    for wpx in (600, 1200, 2400):
        png_of(p, f"{P}/01-logotipo-palavra/png/tinindo-palavra-{nm}-{wpx}px.png", wpx, round(wpx*ratio))
    pdf_of(p, f"{P}/01-logotipo-palavra/pdf/tinindo-palavra-{nm}.pdf", 1200, round(1200*ratio))

# ---------------------------------------------------------------- 02 símbolo
SYMS = [("simbolo", dict(ring=False), (256, 512, 1024)), ("simbolo-com-anel", dict(ring=True), (256, 512, 1024)), ("simbolo-pequeno", dict(small=True), (32, 64, 128, 256))]
for base, kw, sizes in SYMS:
    for nm, m in VAR.items():
        s = G.symbol_svg(m, pad=4, **kw); p = f"{P}/02-simbolo/svg/tinindo-{base}-{nm}.svg"; W(p, s)
        for sz in sizes: png_of(p, f"{P}/02-simbolo/png/tinindo-{base}-{nm}-{sz}px.png", sz, sz)
        if base != "simbolo-pequeno": pdf_of(p, f"{P}/02-simbolo/pdf/tinindo-{base}-{nm}.pdf", 600, 600)

# ---------------------------------------------------------------- 03 ícone de app e favicon
A = f"{P}/03-icone-app-e-favicon"
W(f"{A}/svg/icone-app-quadrado.svg", G.app_icon_svg())
W(f"{A}/svg/icone-app-arredondado-previa.svg", G.app_icon_svg(rounded=True))
W(f"{A}/svg/favicon.svg", G.favicon_svg())
for sz, nm in ((1024, "ios-app-store-1024"), (512, "android-play-512"), (180, "apple-touch-icon-180"), (192, "pwa-192"), (512, "pwa-512")):
    png_of(f"{A}/svg/icone-app-quadrado.svg", f"{A}/png/{nm}.png", sz, sz, bg="#111111")
png_of(f"{A}/svg/icone-app-arredondado-previa.svg", f"{A}/png/previa-arredondado-512.png", 512, 512)
# maskable / adaptativo: símbolo menor (zona segura de 66%)
def icon_scaled(scale, bg=True, mode="dark"):
    k = 1024*scale/100; o = (1024-100*k)/2
    b = '<rect width="1024" height="1024" fill="#111111"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><title>Tinindo</title>{b}'
            f'<g transform="translate({G.f(o)} {G.f(o)}) scale({G.f(k)}) rotate({G.ROT} 50 50)">{G.face_inner(mode, False, False, "m")}</g></svg>\n')
W(f"{A}/svg/pwa-maskable.svg", icon_scaled(0.44)); png_of(f"{A}/svg/pwa-maskable.svg", f"{A}/png/pwa-maskable-512.png", 512, 512, bg="#111111")
W(f"{A}/svg/android-adaptativo-frente.svg", icon_scaled(0.40, bg=False))
png_of(f"{A}/svg/android-adaptativo-frente.svg", f"{A}/png/android-adaptativo-frente-432.png", 432, 432)
W(f"{A}/svg/android-adaptativo-fundo.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#111111"/></svg>\n')
png_of(f"{A}/svg/android-adaptativo-fundo.svg", f"{A}/png/android-adaptativo-fundo-432.png", 432, 432, bg="#111111")
for sz in (16, 32, 48): png_of(f"{A}/svg/favicon.svg", f"{A}/png/favicon-{sz}.png", sz, sz)
W(f"{A}/site.webmanifest", json.dumps({"name": "Tinindo", "short_name": "Tinindo", "icons": [
    {"src": "/pwa-192.png", "sizes": "192x192", "type": "image/png"}, {"src": "/pwa-512.png", "sizes": "512x512", "type": "image/png"},
    {"src": "/pwa-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
    "theme_color": "#111111", "background_color": "#F7F7F5", "display": "standalone"}, indent=2, ensure_ascii=False) + "\n")
W(f"{A}/COMO-USAR.txt", """Cole no <head> do site (copie os arquivos de png/ e svg/favicon.svg para a raiz pública do site):

<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#111111">

Lojas de aplicativo:
- iOS (App Store): png/ios-app-store-1024.png (quadrado, sem transparência; a Apple arredonda os cantos).
- Android (Google Play): png/android-play-512.png.
- Ícone adaptativo do Android: png/android-adaptativo-frente-432.png (camada da frente, transparente) + png/android-adaptativo-fundo-432.png (fundo).
- O favicon usa a variante pequena (corte reto, olhos maiores) e troca o lado direito do sorriso para branco no tema escuro do navegador.
""")

# ---------------------------------------------------------------- 04 redes sociais
R = f"{P}/04-redes-sociais"
LOGO = f"{P}/01-logotipo-palavra/svg"; SY = f"{P}/02-simbolo/svg"
def avatar(mode, bg, size=1080, frac=0.50):
    k = size*frac/100; o = (size-100*k)/2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}"><title>Tinindo</title><rect width="{size}" height="{size}" fill="{bg}"/>'
            f'<g transform="translate({G.f(o)} {G.f(o)}) scale({G.f(k)}) rotate({G.ROT} 50 50)">{G.face_inner(mode, False, False, "a")}</g></svg>\n')
for nm, mode, bg in (("claro", "color", "#F7F7F5"), ("escuro", "dark", "#111111"), ("laranja", "black", "#FF4B1F")):
    p = f"{R}/svg/foto-de-perfil-{nm}.svg"; W(p, avatar(mode, bg))
    png_of(p, f"{R}/png/foto-de-perfil-{nm}-1080.png", 1080, 1080, bg=bg)
    png_of(p, f"{R}/png/foto-de-perfil-{nm}-640-whatsapp.png", 640, 640, bg=bg)
FONT = "font-family:Inter,system-ui,sans-serif"
def cover(w, h, dark=True, wm_w=None, sub=True):
    bg = "#111111" if dark else "#F7F7F5"; fg = "#FFFFFF" if dark else "#111111"; mu = "#BDBDB7" if dark else "#4A4A46"
    wm = f"{LOGO}/tinindo-palavra-{'negativo' if dark else 'cor'}.svg"; sym = f"{SY}/tinindo-simbolo-{'negativo' if dark else 'cor'}.svg"
    wm_w = wm_w or int(w*0.30)
    s = (f"<div style='width:{w}px;height:{h}px;background:{bg};position:relative;overflow:hidden;{FONT}'>"
         f"<img src='file://{sym}' style='position:absolute;right:{-int(h*0.18)}px;top:{-int(h*0.12)}px;height:{int(h*1.25)}px;opacity:1'>"
         f"<div style='position:absolute;left:{int(w*0.06)}px;top:50%;transform:translateY(-50%)'>"
         f"<img src='file://{wm}' style='width:{wm_w}px;display:block'>")
    if sub: s += f"<div style='margin-top:{int(h*0.07)}px;color:{mu};font-size:{max(16,int(h*0.075))}px;font-weight:500'>Para quem faz o serviço e para quem contrata.</div>"
    return s + "</div></div>"
for nm, (w, h) in {"capa-linkedin-1584x396": (1584, 396), "capa-x-twitter-1500x500": (1500, 500), "capa-facebook-1640x624": (1640, 624), "capa-youtube-2560x1440": (2560, 1440)}.items():
    for dark in (True, False):
        url = page(cover(w, h, dark, wm_w=int(w*(0.26 if w/h > 2 else 0.22))))
        jobs.append({"url": url, "out": f"{R}/png/{nm}-{'escuro' if dark else 'claro'}.png", "w": w, "h": h})
post = (f"<div style='width:1080px;height:1080px;background:#111;position:relative;overflow:hidden;{FONT};color:#fff'>"
        f"<img src='file://{SY}/tinindo-simbolo-negativo.svg' style='position:absolute;left:300px;top:150px;width:480px'>"
        f"<img src='file://{LOGO}/tinindo-palavra-negativo.svg' style='position:absolute;left:290px;top:720px;width:500px'>"
        f"<div style='position:absolute;left:0;right:0;top:900px;text-align:center;color:#BDBDB7;font-size:34px;font-weight:500'>Para quem faz o serviço e para quem contrata.</div></div>")
jobs.append({"url": page(post), "out": f"{R}/png/post-apresentacao-1080.png", "w": 1080, "h": 1080})
story = (f"<div style='width:1080px;height:1920px;background:#F7F7F5;position:relative;overflow:hidden;{FONT};color:#111'>"
         f"<img src='file://{SY}/tinindo-simbolo-cor.svg' style='position:absolute;left:240px;top:420px;width:600px'>"
         f"<img src='file://{LOGO}/tinindo-palavra-cor.svg' style='position:absolute;left:190px;top:1180px;width:700px'>"
         f"<div style='position:absolute;left:120px;right:120px;top:1430px;text-align:center;color:#4A4A46;font-size:44px;font-weight:500;line-height:1.3'>Para quem faz o serviço e para quem contrata.</div></div>")
jobs.append({"url": page(story), "out": f"{R}/png/story-1080x1920.png", "w": 1080, "h": 1920})

# ---------------------------------------------------------------- 05 papelaria
PA = f"{P}/05-papelaria"
def card(front=True):
    # 90×50 mm + 3 mm de sangria = 96×56 mm; marcas de área segura não impressas
    if front:
        inner = (f"<div style='position:absolute;inset:0;background:#111'></div>"
                 f"<img src='file://{LOGO}/tinindo-palavra-negativo.svg' style='position:absolute;left:9mm;top:9mm;width:34mm'>"
                 f"<div style='position:absolute;left:9mm;bottom:9mm;color:#fff;{FONT}'><div style='font-size:11pt;font-weight:700'>[Nome do profissional]</div>"
                 f"<div style='font-size:7.5pt;color:#BDBDB7;margin-top:1mm'>[Especialidade] · [telefone]</div></div>"
                 f"<img src='file://{SY}/tinindo-simbolo-negativo.svg' style='position:absolute;right:7mm;bottom:7mm;width:13mm'>")
    else:
        inner = (f"<div style='position:absolute;inset:0;background:#F7F7F5'></div>"
                 f"<img src='file://{SY}/tinindo-simbolo-cor.svg' style='position:absolute;left:9mm;top:8mm;width:11mm'>"
                 f"<div style='position:absolute;left:9mm;right:9mm;bottom:9mm;color:#111;{FONT}'><div style='font-size:10pt;font-weight:700'>Conhece alguém que faz bem-feito?</div>"
                 f"<div style='font-size:7pt;color:#4A4A46;margin-top:1.2mm'>Indique este profissional a um vizinho. [contato ou QR code]</div></div>")
    return f"<div style='width:96mm;height:56mm;position:relative;overflow:hidden'>{inner}</div>"
for nm, fr in (("frente", True), ("verso", False)):
    url = page(card(fr), extra_css="@page{size:96mm 56mm;margin:0}")
    jobs.append({"url": url, "out": f"{PA}/cartao-de-indicacao-{nm}-96x56mm-com-sangria.pdf", "pdf": True, "pmm": (96, 56), "w": 363, "h": 212})
    jobs.append({"url": url, "out": f"{PA}/cartao-de-indicacao-{nm}-previa.png", "w": 363, "h": 212, "scale": 3})
timbrado = (f"<div style='width:210mm;height:297mm;position:relative;background:#fff;{FONT}'>"
            f"<img src='file://{LOGO}/tinindo-palavra-cor.svg' style='position:absolute;left:20mm;top:18mm;width:42mm'>"
            f"<div style='position:absolute;left:20mm;right:20mm;top:60mm;color:#4A4A46;font-size:10.5pt;line-height:1.6'>[Texto da carta]</div>"
            f"<div style='position:absolute;left:20mm;right:20mm;bottom:14mm;border-top:0.3mm solid #DEDED9;padding-top:4mm;color:#62625D;font-size:8pt;display:flex;justify-content:space-between'>"
            f"<span>Tinindo · [endereço] · [CNPJ]</span><span>[e-mail] · [site]</span></div>"
            f"<img src='file://{SY}/tinindo-simbolo-cor.svg' style='position:absolute;right:20mm;top:16mm;width:12mm'></div>")
url = page(timbrado, extra_css="@page{size:210mm 297mm;margin:0}")
jobs.append({"url": url, "out": f"{PA}/papel-timbrado-a4.pdf", "pdf": True, "pmm": (210, 297), "w": 794, "h": 1123})
jobs.append({"url": url, "out": f"{PA}/papel-timbrado-a4-previa.png", "w": 794, "h": 1123})
assin = (f"<table cellpadding='0' cellspacing='0' style='{FONT};color:#111'><tr><td style='padding-right:14px;border-right:1px solid #DEDED9'>"
         f"<img src='SIMBOLO_URL' width='44' height='44' alt='Tinindo' style='display:block'></td>"
         f"<td style='padding-left:14px'><div style='font-size:14px;font-weight:700'>[Nome]</div><div style='font-size:12px;color:#4A4A46'>[Cargo] · Tinindo</div>"
         f"<div style='font-size:12px;color:#4A4A46'>[telefone] · [e-mail]</div></td></tr></table>")
W(f"{PA}/assinatura-de-email.html", "<!-- Troque SIMBOLO_URL pelo endereço público de tinindo-simbolo-cor-128px.png e preencha os campos entre colchetes -->\n" + assin + "\n")
url = page("<div style='padding:20px;background:#fff;display:inline-block'>" + assin.replace("SIMBOLO_URL", f"file://{SY}/tinindo-simbolo-cor.svg") + "</div>", bg="#fff")
jobs.append({"url": url, "out": f"{PA}/assinatura-de-email-previa.png", "w": 420, "h": 100, "scale": 2})
cartaz = (f"<div style='width:210mm;height:297mm;position:relative;background:#F7F7F5;{FONT};color:#111'>"
          f"<img src='file://{LOGO}/tinindo-palavra-cor.svg' style='position:absolute;left:20mm;top:20mm;width:55mm'>"
          f"<div style='position:absolute;left:20mm;right:20mm;top:55mm;font-size:40pt;font-weight:700;line-height:1.08;letter-spacing:-0.02em'>Precisa de alguém que faça bem-feito?</div>"
          f"<div style='position:absolute;left:20mm;right:40mm;top:122mm;font-size:15pt;color:#4A4A46;line-height:1.45'>Veja profissionais independentes que atendem na região, o que cada um faz e quando tem horário.</div>"
          f"<img src='file://{SY}/tinindo-simbolo-cor.svg' style='position:absolute;right:16mm;top:160mm;width:70mm'>"
          f"<div style='position:absolute;left:20mm;bottom:20mm;display:flex;gap:7mm;align-items:flex-end'><div style='width:32mm;height:32mm;border:0.5mm dashed #62625D;display:flex;align-items:center;justify-content:center;font-size:9pt;color:#4A4A46;text-align:center'>[QR code]</div>"
          f"<div style='font-size:8.5pt;color:#4A4A46;max-width:95mm;line-height:1.45'>Divulgação da Tinindo. Não é comunicado do condomínio nem indica aprovação da administração.</div></div></div>")
url = page(cartaz, extra_css="@page{size:210mm 297mm;margin:0}")
jobs.append({"url": url, "out": f"{PA}/cartaz-condominio-a4.pdf", "pdf": True, "pmm": (210, 297), "w": 794, "h": 1123})
jobs.append({"url": url, "out": f"{PA}/cartaz-condominio-a4-previa.png", "w": 794, "h": 1123})

# ---------------------------------------------------------------- 06 uniforme / bordado
U = f"{P}/06-uniforme-e-bordado"
for src, dst in (("02-simbolo/svg/tinindo-simbolo-preto.svg", "simbolo-1cor-preto.svg"), ("02-simbolo/svg/tinindo-simbolo-branco.svg", "simbolo-1cor-branco.svg"),
                 ("02-simbolo/svg/tinindo-simbolo-cor.svg", "simbolo-2cores-sobre-claro.svg"), ("02-simbolo/svg/tinindo-simbolo-negativo.svg", "simbolo-2cores-sobre-escuro.svg"),
                 ("01-logotipo-palavra/svg/tinindo-palavra-preto.svg", "palavra-1cor-preto.svg"), ("01-logotipo-palavra/svg/tinindo-palavra-branco.svg", "palavra-1cor-branco.svg")):
    os.makedirs(U, exist_ok=True); shutil.copy(f"{P}/{src}", f"{U}/{dst}")
W(f"{U}/ESPECIFICACAO.md", """# Uniforme e bordado — especificação (hipóteses a validar com o fornecedor)

| Peça | Arquivo | Posição | Tamanho sugerido |
|---|---|---|---|
| Polo/camiseta escura | `simbolo-2cores-sobre-escuro.svg` (laranja + branco) | peito esquerdo | 30–40 mm de largura |
| Polo/camiseta clara | `simbolo-2cores-sobre-claro.svg` (laranja + preto) | peito esquerdo | 30–40 mm |
| Boné | `simbolo-1cor-branco.svg` ou 2 cores | frente | 45–55 mm |
| Costas / colete | `palavra-1cor-preto.svg` ou `palavra-1cor-branco.svg` | costas, altura dos ombros | 220–260 mm |

- **Mínimos (hipótese, não testada em bordadeira):** símbolo 30 mm; palavra 60 mm. As letras são finas: abaixo disso o bordado não fecha.
- **Uma cor:** a divisão do sorriso vira uma fresta (já desenhada nos arquivos “1cor”).
- **Cores de linha:** laranja próximo de `#FF4B1F`, preto `#111111`, branco. Peça cartela de linhas ao fornecedor e aprove uma **prova bordada** antes do lote.
- Os arquivos são vetoriais de contorno fechado (sem máscaras): podem ser enviados direto para digitalização de bordado, serigrafia ou recorte de vinil.
""")

# ---------------------------------------------------------------- 07 cores
C = f"{P}/07-cores"
COLS = [("Tinta 950", "#111111"), ("Laranja 500", "#FF4B1F"), ("Laranja 400", "#FF6A3D"), ("Laranja 700", "#B33008"), ("Papel 50", "#F7F7F5"), ("Branco", "#FFFFFF"),
        ("Tinta 900", "#1C1C1A"), ("Tinta 600", "#4A4A46"), ("Tinta 500", "#62625D"), ("Tinta 300", "#BDBDB7"), ("Tinta 200", "#DEDED9"), ("Tinta 100", "#EDEDEA")]
def rgb(h): return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))
def cmyk(h):
    r, g, b = [x/255 for x in rgb(h)]; k = 1-max(r, g, b)
    if k >= 1: return (0, 0, 0, 100)
    return tuple(round(100*x) for x in ((1-r-k)/(1-k), (1-g-k)/(1-k), (1-b-k)/(1-k), k))
# .ase (Adobe Swatch Exchange)
blocks = b""
for name, hx in COLS:
    nm = (name + "\0").encode("utf-16-be"); body = struct.pack(">H", len(name)+1) + nm + b"RGB " + struct.pack(">fff", *[x/255 for x in rgb(hx)]) + struct.pack(">H", 2)
    blocks += struct.pack(">HI", 1, len(body)) + body
os.makedirs(C, exist_ok=True)
open(f"{C}/tinindo-cores.ase", "wb").write(b"ASEF" + struct.pack(">HHI", 1, 0, len(COLS)) + blocks)
W(f"{C}/tinindo-cores.gpl", "GIMP Palette\nName: Tinindo\nColumns: 6\n#\n" + "".join(f"{r:3d} {g:3d} {b:3d}\t{n}\n" for n, hx in COLS for r, g, b in [rgb(hx)]))
W(f"{C}/tinindo-cores.css", ":root {\n" + "".join(f"  --tinindo-{n.lower().replace(' ', '-')}: {hx};\n" for n, hx in COLS) + "}\n")
W(f"{C}/tinindo-cores.json", json.dumps([{"nome": n, "hex": hx, "rgb": rgb(hx), "cmyk_aproximado": cmyk(hx)} for n, hx in COLS], ensure_ascii=False, indent=2) + "\n")
W(f"{C}/CORES.md", "# Cores da Tinindo\n\nCMYK é **aproximação** (depende do perfil de impressão e do papel); não há equivalência Pantone. O laranja vivo é difícil em CMYK: peça prova.\n\n| Nome | HEX | RGB | CMYK aprox. | Uso |\n|---|---|---|---|---|\n" +
  "".join(f"| {n} | `{hx}` | {', '.join(map(str, rgb(hx)))} | {'/'.join(map(str, cmyk(hx)))} | {u} |\n" for (n, hx), u in zip(COLS, ["base da marca, texto, botão principal", "destaque: pingos, olhos, sorriso (nunca texto)", "destaque no fundo escuro", "texto em destaque", "fundo claro", "fundo", "superfície escura", "texto secundário", "bordas de controle", "texto secundário no escuro", "bordas leves", "fundos sutis"])) +
  "\nArquivos: `.ase` (Adobe Illustrator/Photoshop/InDesign), `.gpl` (GIMP, Inkscape, Krita), `.css`, `.json`.\n")
sw = "".join(f"<div style='width:180px;height:150px;background:{hx};color:{'#111' if sum(rgb(hx))>400 else '#fff'};padding:12px;box-sizing:border-box;{FONT};font-size:14px;border:1px solid #0001'><b>{n}</b><br>{hx}</div>" for n, hx in COLS)
jobs.append({"url": page(f"<div style='display:grid;grid-template-columns:repeat(6,180px);width:1080px'>{sw}</div>", bg="#fff"), "out": f"{C}/paleta.png", "w": 1080, "h": 300})

# ---------------------------------------------------------------- 08 ícones de interface
I = f"{P}/08-icones-interface"
sprite = open(f"{T}/assets/icons/ui-icons-sprite.svg").read()
for m in re.finditer(r'<symbol id="ti-([^"]+)" viewBox="0 0 24 24"([^>]*)>(.*?)</symbol>', sprite):
    W(f"{I}/svg/{m.group(1)}.svg", f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"{m.group(2)}>{m.group(3)}</svg>\n')
shutil.copy(f"{T}/assets/icons/ui-icons-sprite.svg", f"{I}/sprite-todos-os-icones.svg")

# ---------------------------------------------------------------- 09 padrão de pontos
PD = f"{P}/09-padrao-de-pontos"
tile = ('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><title>Padrão Tinindo</title>'
        '<circle cx="16" cy="16" r="5" fill="#FF4B1F"/><circle cx="48" cy="48" r="5" fill="#111111"/></svg>\n')
W(f"{PD}/padrao-pontos-modulo.svg", tile)
W(f"{PD}/padrao-pontos-modulo-escuro.svg", tile.replace("#111111", "#FFFFFF"))
W(f"{PD}/USO.md", "# Padrão de pontos\n\nDerivado dos pingos dos “I”. Para embalagens, verso de cartão, fundos de redes sociais e materiais impressos.\nUse como textura repetida (`background-image: url(padrao-pontos-modulo.svg)` ou ‘padrão’ no Illustrator/Figma). Não usar atrás do logotipo nem em telas do app com conteúdo.\n")
for nm, bg, f2 in (("claro", "#F7F7F5", "padrao-pontos-modulo.svg"), ("escuro", "#111111", "padrao-pontos-modulo-escuro.svg")):
    jobs.append({"url": page(f"<div style='width:1200px;height:600px;background:{bg} url(file://{PD}/{f2});background-size:64px'></div>"), "out": f"{PD}/previa-{nm}.png", "w": 1200, "h": 600})

json.dump(jobs, open(f"{TOOLS}/jobs_pack.json", "w"))
print(len(jobs), "jobs")
