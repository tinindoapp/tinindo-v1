#!/usr/bin/env python3
"""Tinindo — geometria do logotipo (identidade final proposta v0.2: 'sorriso').
Tudo é path preenchido, sem clipPath, máscara, texto, raster ou script: as duas metades do sorriso são
contornos fechados calculados analiticamente (arcos exatos + segmentos do corte).
Wordmark: versais finas; os pingos dos 'I' = olhos; o 'O' = rosto inclinado (-10°) cujo arco inferior é o sorriso;
o sorriso é cortado ao meio em dentes de serra (duas peças que se encaixam)."""
import math, os
import logos as L   # reaproveita rr/disc e o desenho das letras T I N D

f = L.f
ROT = -10
HALF = 110          # sorriso de 220°
L.STYLES["tn"] = dict(w=10, xh=110, asc=110, rad=0, gap=24, dot="round", case="upper")

def pt(cx, cy, r, a): return cx + r*math.cos(math.radians(a)), cy + r*math.sin(math.radians(a))

def sector(cx, cy, R, r, a1, a2):
    o1 = pt(cx, cy, R, a1); o2 = pt(cx, cy, R, a2); i1 = pt(cx, cy, r, a1); i2 = pt(cx, cy, r, a2)
    lg = 1 if (a2 - a1) % 360 > 180 else 0
    return (f"M{f(o1[0])},{f(o1[1])}A{f(R)},{f(R)} 0 {lg} 1 {f(o2[0])},{f(o2[1])}"
            f"L{f(i2[0])},{f(i2[1])}A{f(r)},{f(r)} 0 {lg} 0 {f(i1[0])},{f(i1[1])}Z")

def crescent(cx, cy, R, t, tmax, half):
    aR = 90 - half; aL = 90 + half
    PR = pt(cx, cy, R, aR); PL = pt(cx, cy, R, aL); QR = pt(cx, cy, R-t, aR); QL = pt(cx, cy, R-t, aL)
    c = abs(QR[0]-QL[0])/2; s = (cy+R-tmax) - QR[1]; r2 = (c*c + s*s)/(2*s); lg = 1 if s > r2 else 0
    return (f"M{f(PR[0])},{f(PR[1])}A{f(R)},{f(R)} 0 1 1 {f(PL[0])},{f(PL[1])}L{f(QL[0])},{f(QL[1])}"
            f"A{f(r2)},{f(r2)} 0 {lg} 0 {f(QR[0])},{f(QR[1])}Z")

# parâmetros do rosto (coordenadas 0..100)
P = {
 "normal": dict(t=8, tmax=20, er=12, dx_ring=22, ey_ring=34, dx_open=25.3, ey_open=20, cut="zig"),
 "small":  dict(t=8, tmax=26, er=15, dx_ring=22, ey_ring=34, dx_open=27,   ey_open=19, cut="straight"),
}
CUTS = {
 "zig":      [(50, 72), (57, 79), (43, 86), (57, 93), (43, 100), (50, 107)],
 "straight": [(50, 60), (50, 110)],
}
def cut_poly(kind, gap, side):
    zz = CUTS[kind]; s = side*gap/2; pts = [(x+s, y) for x, y in zz]; far = -30 if side < 0 else 130
    return [(far, -30), (pts[0][0], -30)] + pts + [(pts[-1][0], 130), (far, 130)]
def clip_defs(pfx, kind, gap):
    out = ""
    for cid, side in (("L", -1), ("R", +1)):
        pts = cut_poly(kind, gap, side)
        out += f'<clipPath id="{pfx}{cid}"><path d="M' + "L".join(f"{f(x)},{f(y)}" for x, y in pts) + 'Z"/></clipPath>'
    return f"<defs>{out}</defs>"


# ---------- metades do sorriso como contornos fechados (sem clipPath)
def _ang(cx, cy, P): return math.degrees(math.atan2(P[1]-cy, P[0]-cx)) % 360
def _seg_circle(P0, P1, C, r):
    dx, dy = P1[0]-P0[0], P1[1]-P0[1]; fx, fy = P0[0]-C[0], P0[1]-C[1]
    a = dx*dx+dy*dy; b = 2*(fx*dx+fy*dy); c = fx*fx+fy*fy-r*r; disc = b*b-4*a*c
    if disc < 0: return []
    sq = math.sqrt(disc); return sorted(t for t in ((-b-sq)/(2*a), (-b+sq)/(2*a)) if 0 <= t <= 1)
def smile_halves(cx, cy, R, t, tmax, half, kind, gap):
    """retorna (d_esquerda, d_direita); cada metade é um contorno fechado"""
    aR = 90 - half; aL = 90 + half
    PR = pt(cx, cy, R, aR); PL = pt(cx, cy, R, aL); QR = pt(cx, cy, R-t, aR); QL = pt(cx, cy, R-t, aL)
    c = abs(QR[0]-QL[0])/2; sg = (cy+R-tmax) - QR[1]; r2 = (c*c + sg*sg)/(2*sg)
    C2 = (cx, (cy+R-tmax) - r2); C1 = (cx, cy)
    out = []
    for side in (-1, 1):
        sh = side*gap/2; poly = [(x+sh, y) for x, y in CUTS[kind]]
        pin = pout = None; mid = []
        for i in range(len(poly)-1):
            P0, P1 = poly[i], poly[i+1]
            ev = [(tt, "in") for tt in _seg_circle(P0, P1, C2, r2)] + [(tt, "out") for tt in _seg_circle(P0, P1, C1, R)]
            for tt, kd in sorted(ev):
                Q = (P0[0]+(P1[0]-P0[0])*tt, P0[1]+(P1[1]-P0[1])*tt)
                if kd == "in" and pin is None: pin = Q
                elif kd == "out" and pin is not None and pout is None: pout = Q
            if pin is not None and pout is None and i+1 < len(poly)-1: mid.append(poly[i+1])
        mid = [m for m in mid if (m[0]-C1[0])**2+(m[1]-C1[1])**2 < R*R and (m[0]-C2[0])**2+(m[1]-C2[1])**2 > r2*r2]
        F = lambda P: f"{f(P[0])},{f(P[1])}"
        a_out = _ang(cx, cy, pout)
        if side < 0:   # metade esquerda: pin -> corte -> pout -> arco externo até PL -> QL -> arco interno até pin
            span = (aL - a_out) % 360
            d = f"M{F(pin)}" + "".join(f"L{F(m)}" for m in mid) + f"L{F(pout)}A{f(R)},{f(R)} 0 {1 if span>180 else 0} 1 {F(PL)}L{F(QL)}"
            sp2 = (_ang(*C2, QL) - _ang(*C2, pin)) % 360
            d += f"A{f(r2)},{f(r2)} 0 {1 if sp2>180 else 0} 0 {F(pin)}Z"
        else:          # metade direita: pin -> corte -> pout -> arco externo até PR -> QR -> arco interno até pin
            span = (a_out - aR) % 360
            d = f"M{F(pin)}" + "".join(f"L{F(m)}" for m in mid) + f"L{F(pout)}A{f(R)},{f(R)} 0 {1 if span>180 else 0} 0 {F(PR)}L{F(QR)}"
            sp2 = (_ang(*C2, pin) - _ang(*C2, QR)) % 360
            d += f"A{f(r2)},{f(r2)} 0 {1 if sp2>180 else 0} 1 {F(pin)}Z"
        out.append(d)
    return out[0], out[1]

# paletas: (tinta, ponto/olhos, sorriso esq., sorriso dir., fresta)
PAL = {
 "color":  ("#111111", "#FF4B1F", "#FF4B1F", "#111111", 0),
 "dark":   ("#FFFFFF", "#FF6A3D", "#FF6A3D", "#FFFFFF", 0),
 "black":  ("#000000", "#000000", "#000000", "#000000", 3.6),
 "white":  ("#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF", 3.6),
}
def face_inner(mode, ring, small=False, pfx="a"):
    """grupo do rosto em coordenadas 0..100, já inclinado"""
    p = P["small" if small else "normal"]; ink, acc, sl, sr, gap = PAL[mode]
    if small and gap: gap = gap + 1.2
    dL, dR = smile_halves(50, 50, 50, p["t"], p["tmax"], HALF, p["cut"], gap)
    s = f'<path fill="{sl}" d="{dL}"/><path fill="{sr}" d="{dR}"/>'
    if ring:
        s = f'<path fill="{ink}" d="{sector(50,50,50,50-p["t"],90+HALF,90-HALF+360)}"/>' + s
        ey, dx = p["ey_ring"], p["dx_ring"]
    else:
        ey, dx = p["ey_open"], p["dx_open"]
    for sgn in (-1, 1): s += f'<path fill="{acc}" d="{L.disc(50+sgn*dx, ey, p["er"])}"/>'
    return s

def symbol_svg(mode, ring=False, small=False, pad=6, pfx="s", title="Símbolo Tinindo"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {100+2*pad} {100+2*pad}" role="img" aria-label="{title}">'
            f'<title>{title}</title><g transform="rotate({ROT} 50 50)">{face_inner(mode, ring, small, pfx)}</g></svg>\n')

def wordmark_svg(mode, pfx="w", pad=4):
    items, W, top, bot = L.word("tn"); R = 55
    items = items[:-1]; cx, cy = W - R, -R
    ink, acc, sl, sr, gap = PAL[mode]
    letters = "".join(f'<path fill="{ink if r=="ink" else acc}" d="{d}"/>' for d, r in items)
    O = (f'<g transform="translate({f(cx)} {f(cy)}) scale({f(R/50)}) rotate({ROT}) translate(-50 -50)">'
         f'{face_inner_O(mode, pfx)}</g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {f(top-pad)} {f(W+2*pad)} {f(bot-top+2*pad)}" role="img" aria-label="Tinindo">'
            f'<title>Tinindo</title>{letters}{O}</svg>\n')

def face_inner_O(mode, pfx):
    """o 'O' da palavra = anel + sorriso do símbolo (sem olhos: os olhos são os pingos dos I)"""
    p = P["normal"]; ink, acc, sl, sr, gap = PAL[mode]
    dL, dR = smile_halves(50, 50, 50, p["t"], p["tmax"], HALF, p["cut"], gap)
    return (f'<path fill="{ink}" d="{sector(50,50,50,50-p["t"],90+HALF,90-HALF+360)}"/>'
            f'<path fill="{sl}" d="{dL}"/><path fill="{sr}" d="{dR}"/>')

def app_icon_svg(size=1024, rounded=False):
    k = size*0.58/100; o = (size-100*k)/2
    bg = f'<rect width="{size}" height="{size}" rx="{int(size*0.2237)}" fill="#111111"/>' if rounded else f'<rect width="{size}" height="{size}" fill="#111111"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img" aria-label="Ícone do app Tinindo"><title>Ícone do app Tinindo</title>{bg}'
            f'<g transform="translate({f(o)} {f(o)}) scale({f(k)}) rotate({ROT} 50 50)">{face_inner("dark", False, False, "i")}</g></svg>\n')

def avatar_svg(dark=False, size=640):
    k = size*0.50/100; o = (size-100*k)/2
    mode = "dark" if dark else "color"; bg = "#111111" if dark else "#F7F7F5"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img" aria-label="Avatar Tinindo"><title>Avatar Tinindo</title>'
            f'<rect width="{size}" height="{size}" fill="{bg}"/><g transform="translate({f(o)} {f(o)}) scale({f(k)}) rotate({ROT} 50 50)">{face_inner(mode, False, False, "v")}</g></svg>\n')

def favicon_svg():
    """variante óptica (corte reto, olhos maiores); troca a cor do lado direito conforme o tema do navegador"""
    p = P["small"]; dL, dR = smile_halves(50, 50, 50, p["t"], p["tmax"], HALF, "straight", 0)
    eyes = "".join(f'<path class="e" d="{L.disc(50+s*p["dx_open"], p["ey_open"], p["er"])}"/>' for s in (-1, 1))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 112 112" width="32" height="32"><title>Tinindo</title>'
            f'<style>.e,.l{{fill:#FF4B1F}}.r{{fill:#111111}}@media (prefers-color-scheme:dark){{.e,.l{{fill:#FF6A3D}}.r{{fill:#FFFFFF}}}}</style>'
            f'<g transform="rotate({ROT} 50 50)"><path class="l" d="{dL}"/><path class="r" d="{dR}"/>{eyes}</g></svg>\n')
