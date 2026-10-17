#!/usr/bin/env python3
"""Gera os logotipos Tinindo (3 territórios) como SVG vetorial puro.
Todas as letras são formas preenchidas (sem <text>, sem stroke, sem raster)."""
import os, json, sys
OUT = os.environ["TOUT"]

def f(x):
    s = ("%.2f" % x).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s

def rr(x, y, w, h, tl=0, tr=0, br=0, bl=0):
    d = f"M{f(x+tl)},{f(y)}H{f(x+w-tr)}"
    if tr: d += f"A{f(tr)},{f(tr)} 0 0 1 {f(x+w)},{f(y+tr)}"
    d += f"V{f(y+h-br)}"
    if br: d += f"A{f(br)},{f(br)} 0 0 1 {f(x+w-br)},{f(y+h)}"
    d += f"H{f(x+bl)}"
    if bl: d += f"A{f(bl)},{f(bl)} 0 0 1 {f(x)},{f(y+h-bl)}"
    d += f"V{f(y+tl)}"
    if tl: d += f"A{f(tl)},{f(tl)} 0 0 1 {f(x+tl)},{f(y)}"
    return d + "Z"

def disc(cx, cy, r):
    return f"M{f(cx-r)},{f(cy)}A{f(r)},{f(r)} 0 1 1 {f(cx+r)},{f(cy)}A{f(r)},{f(r)} 0 1 1 {f(cx-r)},{f(cy)}Z"

def ring(cx, cy, R, r, icx=None, icy=None):
    icx = cx if icx is None else icx
    icy = cy if icy is None else icy
    return (disc(cx, cy, R) +
            f"M{f(icx-r)},{f(icy)}A{f(r)},{f(r)} 0 1 0 {f(icx+r)},{f(icy)}A{f(r)},{f(r)} 0 1 0 {f(icx-r)},{f(icy)}Z")

def arch(x0, ytop, W, w, cy_override=None):
    R = W / 2
    cy = ytop + R
    cx = x0 + R
    return (f"M{f(x0)},{f(cy)}A{f(R)},{f(R)} 0 0 1 {f(x0+W)},{f(cy)}"
            f"H{f(x0+W-w)}A{f(R-w)},{f(R-w)} 0 0 0 {f(x0+w)},{f(cy)}Z"), cy

# ---------------------------------------------------------------- estilos
STYLES = {
    # A — Tudo em ordem: monolinear médio, terminais firmes, pingos viram "blocos de agenda"
    "a": dict(w=15, xh=88, asc=122, rad=3.5, gap=15, dot="pill", case="lower"),
    # B — Indicação: peso alto, terminais totalmente arredondados, pingos viram "pessoas"
    "b": dict(w=22, xh=96, asc=134, rad=11, gap=13, dot="round", case="lower"),
    # C — Capricho: versal largo e fino, terminais cortados, anel excêntrico
    "c": dict(w=9, xh=110, asc=110, rad=0, gap=22, dot=None, case="upper"),
}
for _k in ("d1","d2","d3","d4"):
    STYLES[_k] = dict(w=13, xh=110, asc=110, rad=0, gap=24, dot="round", case="upper")

def lower_word(st):
    w, xh, asc, rad, gap = st["w"], st["xh"], st["asc"], st["rad"], st["gap"]
    yb = 0.0
    items = []   # (d, role)
    x = 0.0
    def stem(x, top, bottom, rt=None, rb=None):
        r = rad if rad <= w/2 else w/2
        return rr(x, top, w, bottom-top, r if rt is None else rt, r if rt is None else rt,
                  r if rb is None else rb, r if rb is None else rb)
    def letter_t(x):
        cbl = w*0.85; cbr = w*0.95
        d = stem(x+cbl, yb-asc*0.98, yb)
        d += rr(x, yb-xh, cbl+w+cbr, w, rad, rad, rad, rad)
        return d, cbl+w+cbr
    def letter_i(x):
        d = stem(x, yb-xh, yb)
        if st["dot"] == "round":
            r = w*0.62
            dd = disc(x+w/2, yb-xh-w*0.55-r, r)
        else:
            pw = w*1.9; ph = w*0.85
            dd = rr(x+w/2-pw/2, yb-xh-w*0.7-ph, pw, ph, rad, rad, rad, rad)
        return d, dd, w
    def letter_n(x):
        W = xh*0.74
        d = stem(x, yb-xh, yb)
        a, cy = arch(x, yb-xh, W, w)
        d += a + stem(x+W-w, cy, yb, rt=0)
        return d, W
    def letter_o(x):
        R = xh/2
        return ring(x+R, yb-R, R, R-w), xh
    def letter_d(x):
        R = xh/2
        d = ring(x+R, yb-R, R, R-w)
        d += stem(x+xh-w, yb-asc, yb)
        return d, xh
    for i, ch in enumerate("tinindo"):
        if ch == "t":
            d, adv = letter_t(x); items.append((d, "ink")); x += adv + gap*0.7
        elif ch == "i":
            d, dd, adv = letter_i(x); items.append((d, "ink")); items.append((dd, "accent")); x += adv + gap*1.15
        elif ch == "n":
            d, adv = letter_n(x); items.append((d, "ink")); x += adv + gap*(1.15 if "ni" in "tinindo"[i:i+2] or True else 1)
        elif ch == "d":
            d, adv = letter_d(x); items.append((d, "ink")); x += adv + gap*0.55
        elif ch == "o":
            d, adv = letter_o(x); items.append((d, "ink")); x += adv
    top = -asc - 4 if st["dot"] is None else -(xh + w*0.7 + (w*0.85 if st["dot"]=="pill" else w*1.24))
    top = min(top, -asc)
    return items, x, top, 0.0

def upper_word(st):
    w, cap, gap = st["w"], st["xh"], st["gap"]
    yt, yb = -cap, 0.0
    items = []; x = 0.0
    def T(x):
        Wt = cap*0.66
        return rr(x, yt, Wt, w) + rr(x+Wt/2-w/2, yt, w, cap), Wt
    def I(x): return rr(x, yt, w, cap), w
    def N(x):
        Wn = cap*0.66
        d = rr(x, yt, w, cap) + rr(x+Wn-w, yt, w, cap)
        d += f"M{f(x)},{f(yt)}H{f(x+w*1.15)}L{f(x+Wn)},{f(yb)}H{f(x+Wn-w*1.15)}Z"
        return d, Wn
    def D(x):
        R = cap/2; xs = x + w/2
        d = rr(x, yt, w, cap)
        d += (f"M{f(xs)},{f(yt)}A{f(R)},{f(R)} 0 0 1 {f(xs)},{f(yb)}L{f(xs)},{f(yb-w)}"
              f"A{f(R-w)},{f(R-w)} 0 0 0 {f(xs)},{f(yt+w)}Z")
        return d, R + w/2
    def O(x):
        R = cap/2
        return ring(x+R, -R, R, R-w), cap
    top = -cap
    for ch in "TININDO":
        fn = {"T": T, "I": I, "N": N, "D": D, "O": O}[ch]
        d, adv = fn(x); items.append((d, "ink"))
        if ch == "I" and st["dot"]:
            r = w*0.75; items.append((disc(x+w/2, yt-w*0.9-r, r), "accent")); top = yt-w*0.9-2*r
        x += adv + gap
    x -= gap
    return items, x, top, 0.0

def word(tid):
    st = STYLES[tid]
    return (lower_word(st) if st["case"] == "lower" else upper_word(st))

# ---------------------------------------------------------------- símbolos
def symbol(tid, small=False):
    """retorna (items, W, H) com origem (0,0) no canto superior esquerdo"""
    if tid == "a":
        h = 18 if not small else 24
        segs = [48, 28, 16]; gap = 8 if not small else 6
        x = 0; items = []
        for i, sw in enumerate(segs):
            items.append((rr(x, 0, sw, h, h/2, h/2, h/2, h/2), "accent" if i == 2 else "ink")); x += sw + gap
        W = x - gap
        sw_ = 18 if not small else 24
        items.append((rr(W/2-sw_/2, h+gap, sw_, 66, 4, 4, h/2, h/2), "ink"))
        return items, W, h+gap+66
    if tid == "b":
        w = 26 if not small else 32; W = 100; items = []
        a, cy = arch(0, 0, W, w)
        legs = rr(0, cy-0.01, w, 100-cy, 0, 0, w/2, w/2) + rr(W-w, cy-0.01, w, 100-cy, 0, 0, w/2, w/2)
        items.append((a + legs, "ink"))
        r = 13 if not small else 16
        items.append((disc(W/2, 100-r-0.0, r), "accent"))
        return items, W, 100
    if tid.startswith("d"):
        w = 26; r = 17
        return [(rr(0, 46, w, 84), "ink"), (disc(w/2, r+1, r), "accent")], w, 130
    if tid == "c":
        R = 50; r = 34 if not small else 30
        return [(ring(50, 50, R, r, 54 if not small else 55, 46 if not small else 45), "ink")], 100, 100

PAL = {
    "a": dict(ink="#1B3FAD", accent="#E8A100", bg="#F4F7FC", dark_bg="#0A1430", dark_ink="#EAF0FF", dark_accent="#FFC233"),
    "b": dict(ink="#0B4F5C", accent="#D9602B", bg="#FBF8F2", dark_bg="#0A1E22", dark_ink="#F3EDE2", dark_accent="#F08A56"),
    "d1": dict(ink="#1D3BD4", accent="#FF5A1F", bg="#F5F6FF", dark_bg="#0B1240", dark_ink="#FFFFFF", dark_accent="#FF7A45"),
    "d2": dict(ink="#E0361A", accent="#131A1C", bg="#FFF6F2", dark_bg="#2A0E08", dark_ink="#FFFFFF", dark_accent="#FFC2B3"),
    "d3": dict(ink="#0A7D55", accent="#FFB000", bg="#F2FBF7", dark_bg="#04261B", dark_ink="#FFFFFF", dark_accent="#FFC933"),
    "d4": dict(ink="#111111", accent="#FF4B1F", bg="#F7F7F5", dark_bg="#111111", dark_ink="#FFFFFF", dark_accent="#FF6A3D"),
    "c": dict(ink="#17191F", accent="#B8892B", bg="#F5F4F1", dark_bg="#0E0F13", dark_ink="#F5F4F1", dark_accent="#D9B15A"),
}
MODES = ["color", "dark", "black", "white"]

def colors(tid, mode):
    p = PAL[tid]
    return {"color": (p["ink"], p["accent"]), "dark": (p["dark_ink"], p["dark_accent"]),
            "black": ("#000000", "#000000"), "white": ("#FFFFFF", "#FFFFFF")}[mode]

def svg_doc(items, vb, mode, tid, title, bg=None, extra=""):
    ink, acc = colors(tid, mode)
    x, y, w, h = vb
    paths = ""
    for d, role in items:
        paths += f'<path fill="{ink if role=="ink" else acc}" d="{d}"/>'
    bgr = f'<rect x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(x)} {f(y)} {f(w)} {f(h)}" '
            f'width="{f(w)}" height="{f(h)}" role="img" aria-label="{title}"><title>{title}</title>{bgr}{paths}{extra}</svg>\n')

def write(path, s):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write(s)

def wordmark_svg(tid, mode, pad=0):
    items, W, top, bottom = word(tid)
    return svg_doc(items, (-pad, top-pad, W+2*pad, bottom-top+2*pad), mode, tid, "Tinindo")

def symbol_svg(tid, mode, small=False, pad=0):
    items, W, H = symbol(tid, small)
    return svg_doc(items, (-pad, -pad, W+2*pad, H+2*pad), mode, tid, "Símbolo Tinindo")

def lockup_svg(tid, mode):
    """símbolo + palavra; usado apenas quando necessário"""
    wi, WW, top, bot = word(tid); si, SW, SH = symbol(tid)
    hh = bot - top
    scale = hh / SH * 1.0
    gap = hh * 0.35
    items = []
    # símbolo escalado via transform seria permitido, mas mantemos geometria expandida: usa <g transform>
    return None

def app_icon(tid, mode="color", rounded=False, size=1024):
    p = PAL[tid]
    items, W, H = symbol(tid, small=False)
    bg = p["ink"] if tid != "c" else p["ink"]
    fg_ink = "#FFFFFF" if tid != "c" else p["dark_ink"]
    fg_acc = p["dark_accent"]
    # símbolo ocupa ~54% do lado; centralizado pela caixa do símbolo
    target = size * 0.54
    k = target / max(W, H)
    ox = (size - W*k)/2; oy = (size - H*k)/2
    g = "".join(f'<path fill="{fg_ink if r=="ink" else fg_acc}" d="{d}"/>' for d, r in items)
    clip = f'<rect width="{size}" height="{size}" rx="{int(size*0.2237)}" fill="{bg}"/>' if rounded else f'<rect width="{size}" height="{size}" fill="{bg}"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}" role="img" aria-label="Ícone do app Tinindo">'
            f'<title>Ícone do app Tinindo</title>{clip}<g transform="translate({f(ox)} {f(oy)}) scale({f(k)})">{g}</g></svg>\n')

def avatar(tid, size=1024):
    """quadrado cheio; o WhatsApp recorta em círculo. Símbolo em ~46% para sobrar margem no recorte."""
    p = PAL[tid]
    items, W, H = symbol(tid)
    k = size*0.46/max(W, H); ox = (size-W*k)/2; oy = (size-H*k)/2
    bg = p["bg"]
    g = "".join(f'<path fill="{p["ink"] if r=="ink" else p["accent"]}" d="{d}"/>' for d, r in items)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}" role="img" aria-label="Avatar Tinindo">'
            f'<title>Avatar Tinindo</title><rect width="{size}" height="{size}" fill="{bg}"/>'
            f'<g transform="translate({f(ox)} {f(oy)}) scale({f(k)})">{g}</g></svg>\n')

def avatar_dark(tid, size=1024):
    p = PAL[tid]
    items, W, H = symbol(tid)
    k = size*0.46/max(W, H); ox = (size-W*k)/2; oy = (size-H*k)/2
    g = "".join(f'<path fill="{p["dark_ink"] if r=="ink" else p["dark_accent"]}" d="{d}"/>' for d, r in items)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}" role="img" aria-label="Avatar Tinindo">'
            f'<title>Avatar Tinindo</title><rect width="{size}" height="{size}" fill="{p["dark_bg"]}"/>'
            f'<g transform="translate({f(ox)} {f(oy)}) scale({f(k)})">{g}</g></svg>\n')

if __name__ == "__main__":
    names = {"a": "ordem", "b": "indicacao", "c": "capricho"}
    for tid in "abc":
        d = f"{OUT}/research/territories/{tid}-{names[tid]}"
        for m in MODES:
            write(f"{d}/wordmark-{m}.svg", wordmark_svg(tid, m))
            write(f"{d}/symbol-{m}.svg", symbol_svg(tid, m))
        write(f"{d}/symbol-small.svg", symbol_svg(tid, "color", small=True))
        write(f"{d}/app-icon.svg", app_icon(tid))
        write(f"{d}/avatar.svg", avatar(tid))
    print("ok")
