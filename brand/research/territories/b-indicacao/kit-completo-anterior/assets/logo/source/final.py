#!/usr/bin/env python3
"""Ativos finais (direção B provisória) + ícones de interface + folhas de verificação."""
import os, sys, json, subprocess
sys.path.insert(0, os.path.dirname(__file__))
import logos as L
T = os.environ["TOUT"]
tid = "b"
jobs = []

def png(svgpath, outpath, w, h, bg=None):
    html = f"<body style='margin:0;background:{bg or 'transparent'}'><img src='file://{svgpath}' style='width:{w}px;height:{h}px;display:block'></body>"
    jobs.append({"html": html, "out": outpath, "w": w, "h": h, "transparent": bg is None})

# ---- logotipo
wi, WW, top, bot = L.word(tid)
wm_ratio = (bot - top) / WW
si, SW, SH = L.symbol(tid)
for m in L.MODES:
    nm = {"color": "color", "dark": "negativo-cor", "black": "preto", "white": "branco"}[m]
    p = f"{T}/assets/logo/tinindo-wordmark-{nm}.svg"; L.write(p, L.wordmark_svg(tid, m))
    png(p, p[:-4] + ".png", 1200, round(1200 * wm_ratio))
    p = f"{T}/assets/logo/tinindo-symbol-{nm}.svg"; L.write(p, L.symbol_svg(tid, m))
    png(p, p[:-4] + ".png", 512, 512)
p = f"{T}/assets/logo/tinindo-symbol-small-optical.svg"; L.write(p, L.symbol_svg(tid, "color", small=True))
png(p, p[:-4] + ".png", 256, 256)

# ---- ícone de app, avatar
for nm, svg in [("app-icon-1024", L.app_icon(tid)), ("app-icon-rounded-preview", L.app_icon(tid, rounded=True))]:
    p = f"{T}/assets/app-icons/{nm}.svg"; L.write(p, svg)
png(f"{T}/assets/app-icons/app-icon-1024.svg", f"{T}/assets/app-icons/app-icon-1024.png", 1024, 1024, bg="#0B4F5C")
for s in (512, 192, 180):
    png(f"{T}/assets/app-icons/app-icon-1024.svg", f"{T}/assets/app-icons/app-icon-{s}.png", s, s, bg="#0B4F5C")
png(f"{T}/assets/app-icons/app-icon-rounded-preview.svg", f"{T}/assets/app-icons/app-icon-rounded-preview.png", 512, 512)
L.write(f"{T}/assets/app-icons/avatar-whatsapp-claro.svg", L.avatar(tid, 640))
L.write(f"{T}/assets/app-icons/avatar-whatsapp-escuro.svg", L.avatar_dark(tid, 640))
png(f"{T}/assets/app-icons/avatar-whatsapp-claro.svg", f"{T}/assets/app-icons/avatar-whatsapp-claro.png", 640, 640, bg="#FBF8F2")
png(f"{T}/assets/app-icons/avatar-whatsapp-escuro.svg", f"{T}/assets/app-icons/avatar-whatsapp-escuro.png", 640, 640, bg="#0A1E22")

# ---- favicon (variante óptica, adapta ao tema do navegador por CSS embutido; sem script)
fav_items, FW, FH = L.symbol(tid, small=True)
pa = "".join(f'<path class="{"i" if r=="ink" else "a"}" d="{d}"/>' for d, r in fav_items)
L.write(f"{T}/assets/icons/favicon.svg",
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 112 112" width="32" height="32"><title>Tinindo</title>'
        f'<style>.i{{fill:#0B4F5C}}.a{{fill:#D9602B}}@media (prefers-color-scheme:dark){{.i{{fill:#F3EDE2}}.a{{fill:#F08A56}}}}</style>{pa}</svg>\n')
png(f"{T}/assets/icons/favicon.svg", f"{T}/assets/icons/favicon-32.png", 32, 32)
png(f"{T}/assets/icons/favicon.svg", f"{T}/assets/icons/favicon-48.png", 48, 48)
png(f"{T}/assets/icons/favicon.svg", f"{T}/assets/icons/favicon-16.png", 16, 16)

# ---- ícones de interface (24px, traço 2, pontas redondas). Traço aceitável: ícones de UI não são o logotipo.
ICONS = {
 "agenda":   '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
 "cliente":  '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
 "orcamento":'<path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4M8.5 13h7M8.5 16.5h5"/>',
 "receber":  '<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="2.6"/>',
 "mensagem": '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5Z"/>',
 "espera":   '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
 "avaliacao":'<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.6l-5 2.6.9-5.6-4-3.9 5.6-.8Z"/>',
 "local":    '<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
 "aprovar":  '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/>',
 "alerta":   '<path d="M12 4 21 19.5H3Z"/><path d="M12 10v4.2M12 17v.1"/>',
 "info":     '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>',
 "bloqueio": '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
}
sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + "".join(
    f'<symbol id="ti-{k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{v}</symbol>' for k, v in ICONS.items()) + "</svg>\n"
L.write(f"{T}/assets/icons/ui-icons-sprite.svg", sprite)
json.dump(list(ICONS), open(f"{T}/../tools/icons.json", "w"))

# ---- folha: monocromático / fundos / uso incorreto / área de proteção  (HTML renderizado -> PNG + usado no manual)
def img(p, w, extra=""): return f"<img src='file://{T}/assets/logo/{p}' style='width:{w}px;{extra}'>"
cell = lambda bg, inner, label, fg="#444": f"<div style='background:{bg};border:1px solid #ddd;border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;align-items:flex-start;justify-content:space-between;min-height:110px'>{inner}<span style='font:11px Inter;color:{fg}'>{label}</span></div>"
bgs = [("#FBF8F2", "tinindo-wordmark-color.svg", "Positivo · areia"), ("#FFFFFF", "tinindo-wordmark-color.svg", "Positivo · branco"),
       ("#0A1E22", "tinindo-wordmark-negativo-cor.svg", "Negativo · petróleo escuro"), ("#FFFFFF", "tinindo-wordmark-preto.svg", "Uma cor · preto"),
       ("#0B4F5C", "tinindo-wordmark-branco.svg", "Uma cor · branco sobre marca"), ("#D9602B", "tinindo-wordmark-branco.svg", "Branco sobre barro (ver nota de contraste)")]
sheet = "<body style='margin:0;padding:20px;background:#fff;font-family:Inter'><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:14px;width:1000px'>"
for bg, f, lab in bgs: sheet += cell(bg, img(f, 220), lab, "#fff" if bg in ("#0A1E22", "#0B4F5C", "#D9602B") else "#444")
sheet += "</div></body>"
open(f"{T}/../tools/sheet_backgrounds.html", "w").write(sheet)
jobs.append({"url": f"file://{T}/../tools/sheet_backgrounds.html", "out": f"{T}/guidelines/fig-fundos.png", "w": 1040, "h": 340, "scale": 1})

# uso incorreto (aplicado por CSS sobre o SVG mestre, somente para ilustrar o que NÃO fazer)
wrong = [("Não distorcer", "transform:scaleX(1.5);transform-origin:left"), ("Não girar", "transform:rotate(-8deg)"),
         ("Não usar sombra/brilho", "filter:drop-shadow(3px 4px 3px rgba(0,0,0,.6))"), ("Não recolorir fora da paleta", "filter:hue-rotate(110deg)"),
         ("Não aplicar sobre foto movimentada", "background:repeating-linear-gradient(45deg,#8a5a44 0 8px,#2d6a4f 8px 16px,#caa05a 16px 24px);padding:14px"),
         ("Não reduzir abaixo do mínimo", "width:46px!important")]
sw = "<body style='margin:0;padding:20px;background:#fff;font-family:Inter'><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:14px;width:1000px'>"
for lab, st in wrong:
    sw += f"<div style='border:1px solid #e3c9c9;border-radius:10px;padding:18px;min-height:130px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden'><div style='height:60px;display:flex;align-items:center'><img src='file://{T}/assets/logo/tinindo-wordmark-color.svg' style='width:200px;{st}'></div><span style='font:12px Inter;color:#9b1c1c'>✕ {lab}</span></div>"
sw += "</div></body>"
open(f"{T}/../tools/sheet_wrong.html", "w").write(sw)
jobs.append({"url": f"file://{T}/../tools/sheet_wrong.html", "out": f"{T}/guidelines/fig-uso-incorreto.png", "w": 1040, "h": 400})

# área de proteção
x = 48  # = metade da altura-x do wordmark (xh=96); em unidades do viewBox
pad = x
items, W_, top_, bot_ = wi, WW, top, bot
vbw, vbh = W_ + 2*pad, (bot_ - top_) + 2*pad
paths = "".join(f'<path fill="{"#0B4F5C" if r=="ink" else "#D9602B"}" d="{d}"/>' for d, r in items)
cs = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {top_-pad} {vbw} {vbh}" style="width:620px;background:#FBF8F2;border:1px solid #ddd">'
      f'<rect x="{-pad}" y="{top_-pad}" width="{vbw}" height="{vbh}" fill="none"/>'
      f'<rect x="0" y="{top_}" width="{W_}" height="{bot_-top_}" fill="none" stroke="#D9602B" stroke-width="1.5" stroke-dasharray="6 5"/>'
      f'<rect x="{-pad}" y="{top_-pad}" width="{vbw}" height="{vbh}" fill="none" stroke="#0B4F5C" stroke-width="1.5"/>'
      f'<g opacity=".95">{paths}</g>'
      f'<circle cx="{-pad/2}" cy="{(top_+bot_)/2}" r="{x/2}" fill="none" stroke="#D9602B" stroke-width="1.5"/>'
      f'<text x="{-pad/2}" y="{(top_+bot_)/2+5}" font-family="Inter" font-size="26" text-anchor="middle" fill="#D9602B">x</text></svg>')
open(f"{T}/../tools/sheet_clear.html", "w").write(f"<body style='margin:0;padding:16px;background:#fff'>{cs}<p style='font:13px Inter;color:#444;width:620px'>x = metade da altura-x do wordmark (altura do “o”). Nenhum elemento entra na moldura externa.</p></body>")
jobs.append({"url": f"file://{T}/../tools/sheet_clear.html", "out": f"{T}/guidelines/fig-area-protecao.png", "w": 660, "h": 330})

# símbolo: teste de escala (pixels reais, 1x) + monocromático
t = "<body style='margin:0;padding:14px;background:#FBF8F2;font:11px Inter;color:#444'>"
t += "<div style='display:flex;gap:18px;align-items:end'>"
for s in (16, 24, 32, 48):
    src = "tinindo-symbol-small-optical.svg" if s <= 24 else "tinindo-symbol-color.svg"
    t += f"<div style='text-align:center'><img src='file://{T}/assets/logo/{src}' style='width:{s}px;height:{s}px'><br>{s}px</div>"
t += "<span style='width:20px'></span>"
for w in (80, 120, 160):
    t += f"<div style='text-align:center'><img src='file://{T}/assets/logo/tinindo-wordmark-color.svg' style='width:{w}px'><br>{w}px</div>"
t += "</div></body>"
open(f"{T}/../tools/sheet_small.html", "w").write(t)
jobs.append({"url": f"file://{T}/../tools/sheet_small.html", "out": f"{T}/guidelines/fig-escalas.png", "w": 560, "h": 110})

json.dump(jobs, open(f"{T}/../tools/jobs_final.json", "w"))
print(len(jobs), "jobs")
