import sys,os,json,math
sys.path.insert(0,os.path.dirname(__file__)); import logos as L
import importlib.util
T=os.environ["TOUT"]; D=f"{T}/research/territories/e-preto-fino/sorriso"
f=L.f; pt=lambda cx,cy,r,a:(cx+r*math.cos(math.radians(a)),cy+r*math.sin(math.radians(a)))
L.STYLES["e1"]=dict(w=10,xh=110,asc=110,rad=0,gap=24,dot="round",case="upper")
def sector(cx,cy,R,r,a1,a2):
    o1=pt(cx,cy,R,a1);o2=pt(cx,cy,R,a2);i1=pt(cx,cy,r,a1);i2=pt(cx,cy,r,a2);lg=1 if (a2-a1)%360>180 else 0
    return f"M{f(o1[0])},{f(o1[1])}A{f(R)},{f(R)} 0 {lg} 1 {f(o2[0])},{f(o2[1])}L{f(i2[0])},{f(i2[1])}A{f(r)},{f(r)} 0 {lg} 0 {f(i1[0])},{f(i1[1])}Z"
def crescent(cx,cy,R,t,tmax,half):
    """sorriso: borda externa = círculo; borda interna = arco mais raso, pontas com a espessura t do anel"""
    aR=90-half; aL=90+half
    PR=pt(cx,cy,R,aR); PL=pt(cx,cy,R,aL); QR=pt(cx,cy,R-t,aR); QL=pt(cx,cy,R-t,aL)
    c=abs(QR[0]-QL[0])/2; yq=QR[1]; s=(cy+R-tmax)-yq; r2=(c*c+s*s)/(2*s)
    lg=1 if s>r2 else 0
    return (f"M{f(PR[0])},{f(PR[1])}A{f(R)},{f(R)} 0 1 1 {f(PL[0])},{f(PL[1])}L{f(QL[0])},{f(QL[1])}"
            f"A{f(r2)},{f(r2)} 0 {lg} 0 {f(QR[0])},{f(QR[1])}Z")
def mouth(kind,R,t,tmax,half,cx=50,cy=50):
    return crescent(cx,cy,R,t,tmax,half) if kind=="cres" else sector(cx,cy,R,R-t,90-half,90+half)
SPAN=220; half=SPAN/2
VAR={ # nome: (boca, t_anel, tmax_boca, olho_r, olho_dx, olho_y, inclinação)
 "v0":("flat",11,11,9,18,40,0),
 "v1":("flat",11,11,11,21,35,0),
 "v2":("cres",11,17,11,21,35,0),
 "v3":("cres",8,20,12,22,34,0),
 "v4":("cres",8,20,12,22,34,-10),
}
def face(v,ring=True):
    kind,t,tm,er,edx,ey,rot=VAR[v]; items=[]
    if ring:
        items.append((sector(50,50,50,50-t,90+half,90-half+360),"ink"))
        items.append((mouth(kind,50,t,tm,half),"smile"))
        for dx in (-edx,edx): items.append((L.disc(50+dx,ey,er),"accent"))
    else:
        items.append((mouth(kind,50,t,tm,half),"smile"))
        for dx in (-edx*1.15,edx*1.15): items.append((L.disc(50+dx,ey-14,er),"accent"))
    return items,rot
def wordmark(v):
    kind,t,tm,er,edx,ey,rot=VAR[v]
    items,W,top,bot=L.word("e1"); R=55; w=10
    items=items[:-1]; cx,cy=W-R,-R
    items.append((sector(cx,cy,R,R-w,90+half,90-half+360),"ink"))
    items.append((mouth(kind,R,w,tm*R/50*0.8 if kind=="cres" else w,half,cx,cy),"smile"))
    return items,W,top,bot
COL=("#111111","#FF4B1F","#FF4B1F"); NEG=("#FFFFFF","#FF6A3D","#FF6A3D")
def paint(items,c): m=dict(ink=c[0],accent=c[1],smile=c[2]); return "".join(f'<path fill="{m[r]}" d="{d}"/>' for d,r in items)
def wm_svg(v,c=COL):
    it,W,top,bot=wordmark(v); return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {f(top)} {f(W)} {f(bot-top)}">{paint(it,c)}</svg>'
def face_svg(v,ring,c=COL,pad=6):
    it,rot=face(v,ring); return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {100+2*pad} {100+2*pad}"><g transform="rotate({rot} 50 50)">{paint(it,c)}</g></svg>'
def icon_svg(v,ring):
    it,rot=face(v,ring); k=1024*0.58/100; o=(1024-100*k)/2
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#111"/><g transform="translate({f(o)} {f(o)}) scale({f(k)}) rotate({rot} 50 50)">{paint(it,NEG)}</g></svg>'
cell=lambda s,w,bg="#F7F7F5",p=16,r=12:f"<div style='background:{bg};padding:{p}px;border-radius:{r}px;display:grid;place-items:center'><div style='width:{w}px'>{s}</div></div>"
LAB={"v0":"0 · atual","v1":"1 · olhos maiores, altos e abertos","v2":"2 · + sorriso mais grosso no meio","v3":"3 · + anel fino, sorriso mais cheio","v4":"4 · + cabeça inclinada"}
rows=""
for v in VAR:
    rows+=f"<div style='display:flex;gap:16px;align-items:center;margin:8px 18px'><div style='width:120px;font:600 12px Inter'>{LAB[v]}</div>"
    rows+=cell(wm_svg(v),300)+cell(wm_svg(v,NEG),210,"#111")+cell(face_svg(v,True),90)+cell(face_svg(v,False),90)+cell(icon_svg(v,False),66,"#fff",0,15)+"</div>"
rows+="<div style='margin:12px 18px 4px;font:600 12px Inter'>Teste de tamanho, variante 3 (sem anel e com anel)</div><div style='display:flex;gap:18px;align-items:end;margin:6px 18px;background:#F7F7F5;padding:12px;border-radius:10px;width:max-content'>"
for s in (16,24,32,48): rows+=f"<div style='width:{s}px'>{face_svg('v3',False,COL,0)}</div>"
for s in (16,24,32,48): rows+=f"<div style='width:{s}px'>{face_svg('v3',True,COL,0)}</div>"
for w in (96,120,160): rows+=f"<div style='width:{w}px'>{wm_svg('v3')}</div>"
rows+="</div>"
open("tools/h.html","w").write("<body style='margin:0;background:#fff;font-family:Inter;padding-top:8px'>"+rows+"</body>")
json.dump([{"url":"file://"+os.getcwd()+"/tools/h.html","out":D+"/mais-feliz.png","w":960,"h":720}],open("tools/jh.json","w"))
