#!/usr/bin/env python3
import os, sys, json, shutil
sys.path.insert(0, os.path.dirname(__file__))
import geom as G
T = os.environ["TOUT"]; TOOLS = f"{T}/../tools"
W = lambda p, s: (os.makedirs(os.path.dirname(p), exist_ok=True), open(p, "w").write(s))
jobs = []
_n=[0]
def png(svg, out, w, h, bg=None):
    _n[0]+=1; hp=f"{TOOLS}/png_{_n[0]}.html"
    open(hp,"w").write(f"<body style='margin:0;background:{bg or 'transparent'}'><img src='file://{svg}' style='width:{w}px;height:{h}px;display:block'></body>")
    jobs.append({"url": "file://"+hp, "out": out, "w": w, "h": h, "transparent": bg is None})

# ---------------- logotipo
NM = {"color": "color", "dark": "negativo-cor", "black": "preto", "white": "branco"}
WM_RATIO = None
import re
for m, n in NM.items():
    s = G.wordmark_svg(m, pfx="w"); p = f"{T}/assets/logo/tinindo-wordmark-{n}.svg"; W(p, s)
    vb = [float(x) for x in re.search(r'viewBox="([^"]+)"', s).group(1).split()]
    WM_RATIO = vb[3]/vb[2]
    png(p, p[:-4] + ".png", 1200, round(1200*WM_RATIO))
    s = G.symbol_svg(m, ring=False); p = f"{T}/assets/logo/tinindo-symbol-{n}.svg"; W(p, s); png(p, p[:-4] + ".png", 512, 512)
for m in ("color", "dark"):
    n = NM[m]; p = f"{T}/assets/logo/tinindo-symbol-anel-{n}.svg"; W(p, G.symbol_svg(m, ring=True)); png(p, p[:-4] + ".png", 512, 512)
    p = f"{T}/assets/logo/tinindo-symbol-pequeno-optico-{n}.svg"; W(p, G.symbol_svg(m, small=True)); png(p, p[:-4] + ".png", 256, 256)
for m in ("black", "white"):
    n = NM[m]; p = f"{T}/assets/logo/tinindo-symbol-pequeno-optico-{n}.svg"; W(p, G.symbol_svg(m, small=True)); png(p, p[:-4] + ".png", 256, 256)

# ---------------- app, avatar, favicon
W(f"{T}/assets/app-icons/app-icon-1024.svg", G.app_icon_svg())
W(f"{T}/assets/app-icons/app-icon-rounded-preview.svg", G.app_icon_svg(rounded=True))
for sz in (1024, 512, 192, 180): png(f"{T}/assets/app-icons/app-icon-1024.svg", f"{T}/assets/app-icons/app-icon-{sz}.png", sz, sz, bg="#111111")
png(f"{T}/assets/app-icons/app-icon-rounded-preview.svg", f"{T}/assets/app-icons/app-icon-rounded-preview.png", 512, 512)
W(f"{T}/assets/app-icons/avatar-whatsapp-claro.svg", G.avatar_svg(False)); W(f"{T}/assets/app-icons/avatar-whatsapp-escuro.svg", G.avatar_svg(True))
png(f"{T}/assets/app-icons/avatar-whatsapp-claro.svg", f"{T}/assets/app-icons/avatar-whatsapp-claro.png", 640, 640, bg="#F7F7F5")
png(f"{T}/assets/app-icons/avatar-whatsapp-escuro.svg", f"{T}/assets/app-icons/avatar-whatsapp-escuro.png", 640, 640, bg="#111111")
W(f"{T}/assets/icons/favicon.svg", G.favicon_svg())
for sz in (16, 32, 48): png(f"{T}/assets/icons/favicon.svg", f"{T}/assets/icons/favicon-{sz}.png", sz, sz)
shutil.copy(f"{TOOLS}/ui-icons-sprite.svg", f"{T}/assets/icons/ui-icons-sprite.svg")

# ---------------- figuras do manual / apresentação
A = f"file://{T}/assets/logo"
def tile(bg, img, w, label, fg="#444"):
    return (f"<div style='background:{bg};border:1px solid #ddd;border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;"
            f"align-items:flex-start;justify-content:space-between;min-height:112px'><img src='{A}/{img}' style='width:{w}px'><span style='font:11px Inter;color:{fg}'>{label}</span></div>")
bgs = [("#F7F7F5", "tinindo-wordmark-color.svg", "Positivo · papel"), ("#FFFFFF", "tinindo-wordmark-color.svg", "Positivo · branco"),
       ("#111111", "tinindo-wordmark-negativo-cor.svg", "Negativo · tinta"), ("#FFFFFF", "tinindo-wordmark-preto.svg", "Uma cor · preto"),
       ("#111111", "tinindo-wordmark-branco.svg", "Uma cor · branco"), ("#FF4B1F", "tinindo-wordmark-preto.svg", "Preto sobre laranja")]
h = "<body style='margin:0;padding:20px;background:#fff;font-family:Inter'><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:14px;width:1000px'>"
for bg, img, lab in bgs: h += tile(bg, img, 250, lab, "#fff" if bg in ("#111111",) else "#222")
open(f"{TOOLS}/sheet_backgrounds.html", "w").write(h + "</div></body>")
jobs.append({"url": f"file://{TOOLS}/sheet_backgrounds.html", "out": f"{T}/guidelines/fig-fundos.png", "w": 1040, "h": 340})

wrong = [("Não distorcer", "transform:scaleX(1.5);transform-origin:left"), ("Não girar a palavra", "transform:rotate(-8deg)"),
         ("Não usar sombra, brilho ou vidro", "filter:drop-shadow(3px 4px 3px rgba(0,0,0,.6))"), ("Não recolorir fora da paleta", "filter:hue-rotate(150deg)"),
         ("Não usar sobre fundo movimentado", "background:repeating-linear-gradient(45deg,#8a5a44 0 8px,#2d6a4f 8px 16px,#caa05a 16px 24px);padding:14px"),
         ("Não reduzir abaixo do mínimo (120 px)", "width:70px!important")]
h = "<body style='margin:0;padding:20px;background:#fff;font-family:Inter'><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:14px;width:1000px'>"
for lab, st in wrong:
    h += (f"<div style='border:1px solid #e3c9c9;border-radius:10px;padding:18px;min-height:130px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden'>"
          f"<div style='height:60px;display:flex;align-items:center'><img src='{A}/tinindo-wordmark-color.svg' style='width:250px;{st}'></div><span style='font:12px Inter;color:#9b1c1c'>✕ {lab}</span></div>")
open(f"{TOOLS}/sheet_wrong.html", "w").write(h + "</div></body>")
jobs.append({"url": f"file://{TOOLS}/sheet_wrong.html", "out": f"{T}/guidelines/fig-uso-incorreto.png", "w": 1040, "h": 400})

# área de proteção (x = metade da altura das versais = raio do "O")
import logos as L
sv = G.wordmark_svg("color", pfx="c", pad=0)
vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', sv).group(1).split()]
x = 55; pad = x
inner = re.sub(r'^<svg[^>]*>|</svg>\s*$', '', sv.strip())
cs = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {vb[1]-pad} {vb[2]+2*pad} {vb[3]+2*pad}" style="width:700px;background:#F7F7F5;border:1px solid #ddd">'
      f'<rect x="{-pad}" y="{vb[1]-pad}" width="{vb[2]+2*pad}" height="{vb[3]+2*pad}" fill="none" stroke="#111" stroke-width="1.5"/>'
      f'<rect x="0" y="{vb[1]}" width="{vb[2]}" height="{vb[3]}" fill="none" stroke="#FF4B1F" stroke-width="1.5" stroke-dasharray="6 5"/>{inner}'
      f'<circle cx="{-pad/2}" cy="{vb[1]+vb[3]/2}" r="{x/2}" fill="none" stroke="#FF4B1F" stroke-width="1.5"/>'
      f'<text x="{-pad/2}" y="{vb[1]+vb[3]/2+6}" font-family="Inter" font-size="22" text-anchor="middle" fill="#FF4B1F">x</text></svg>')
open(f"{TOOLS}/sheet_clear.html", "w").write(f"<body style='margin:0;padding:16px;background:#fff'>{cs}<p style='font:13px Inter;color:#444;width:700px'>x = raio do “O” (metade da altura das versais). Nada entra na moldura externa.</p></body>")
jobs.append({"url": f"file://{TOOLS}/sheet_clear.html", "out": f"{T}/guidelines/fig-area-protecao.png", "w": 740, "h": 360})

# escalas reais (1×)
t = "<body style='margin:0;padding:14px;background:#F7F7F5;font:11px Inter;color:#444'><div style='display:flex;gap:18px;align-items:end'>"
for sidx, s in enumerate((16, 24, 32, 48)):
    src = "tinindo-symbol-pequeno-optico-color.svg" if s <= 24 else "tinindo-symbol-color.svg"
    t += f"<div style='text-align:center'><img src='{A}/{src}' style='width:{s}px;height:{s}px'><br>{s}px</div>"
t += "<span style='width:16px'></span>"
for w in (96, 120, 160, 200): t += f"<div style='text-align:center'><img src='{A}/tinindo-wordmark-color.svg' style='width:{w}px'><br>{w}px</div>"
open(f"{TOOLS}/sheet_small.html", "w").write(t + "</div></body>")
jobs.append({"url": f"file://{TOOLS}/sheet_small.html", "out": f"{T}/guidelines/fig-escalas.png", "w": 640, "h": 110})

# conceito / anatomia
sym = open(f"{T}/assets/logo/tinindo-symbol-color.svg").read(); ring = open(f"{T}/assets/logo/tinindo-symbol-anel-color.svg").read()
wm = open(f"{T}/assets/logo/tinindo-wordmark-color.svg").read()
box = lambda inner, cap: f"<div style='flex:1;background:#F7F7F5;border-radius:14px;padding:22px;display:flex;flex-direction:column;align-items:center;gap:14px;justify-content:space-between'>{inner}<div style='font:600 14px Inter;text-align:center;color:#111'>{cap}</div></div>"
dots_only = "".join(f'<circle cx="{50+s*25.3}" cy="20" r="12" fill="#FF4B1F"/>' for s in (-1, 1))
c1 = f'<svg viewBox="-6 -6 112 112" style="width:170px"><g transform="rotate(-10 50 50)">{dots_only}<path d="{G.crescent(50,50,50,8,20,110)}" fill="#E5E5E0"/></g></svg>'
c2 = f'<svg viewBox="-6 -6 112 112" style="width:170px"><g transform="rotate(-10 50 50)"><path d="{G.sector(50,50,50,42,200,340)}" fill="#111"/><path d="{G.crescent(50,50,50,8,20,110)}" fill="#FF4B1F"/></g></svg>'
c3 = f'<img src="{A}/tinindo-symbol-color.svg" style="width:170px">'
h = (f"<body style='margin:0;padding:20px;background:#fff;font-family:Inter'><div style='display:flex;gap:16px;width:1000px'>"
     + box(c1, "Dois pingos = duas pessoas<br><span style='font-weight:400;color:#555'>os pingos dos “I”, em laranja, são os olhos</span>")
     + box(c2, "O “O” = o rosto<br><span style='font-weight:400;color:#555'>cabeça inclinada, arco de baixo é o sorriso</span>")
     + box(c3, "O corte = o encaixe<br><span style='font-weight:400;color:#555'>duas metades, duas partes que se encontram</span>") + "</div></body>")
open(f"{TOOLS}/sheet_concept.html", "w").write(h)
jobs.append({"url": f"file://{TOOLS}/sheet_concept.html", "out": f"{T}/guidelines/fig-conceito.png", "w": 1040, "h": 330})

json.dump(jobs, open(f"{TOOLS}/jobs_kit.json", "w"))
print(len(jobs), "jobs; wordmark ratio", round(WM_RATIO, 4))
