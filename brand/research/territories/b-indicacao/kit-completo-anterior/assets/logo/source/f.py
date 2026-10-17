import sys,os,json,math
sys.path.insert(0,os.path.dirname(__file__)); import logos as L
T=os.environ["TOUT"]; D=f"{T}/research/territories/e-preto-fino/mistura-2-5"
base=dict(ink="#111111",accent="#FF4B1F",bg="#F7F7F5",dark_bg="#111111",dark_ink="#FFFFFF",dark_accent="#FF6A3D")
OPT={"f1":"anel + 2 pontos","f2":"ii dentro do anel","f3":"anel aberto, pontos nas pontas","f4":"dois anéis + ponto"}
for k in OPT: L.PAL[k]=dict(base)
rr,disc,ring=L.rr,L.disc,L.ring
def pt(r,a): return 50+r*math.cos(math.radians(a)),50+r*math.sin(math.radians(a))
def sym(tid,small=False):
    t=12 if not small else 17; r=13 if not small else 16
    if tid=="f1":
        x1,y1=pt(50-t/2,-45); x2,y2=pt(50-t/2,135)
        return [(ring(50,50,50,50-t),"ink"),(disc(x1,y1,r),"accent"),(disc(x2,y2,r),"accent")],100,100
    if tid=="f2":
        w=9 if not small else 13; rd=7.5 if not small else 10
        s=[(ring(50,50,50,50-t),"ink")]
        for cx in (37,63):
            s+= [(rr(cx-w/2,48,w,26),"ink"),(disc(cx,48-4-rd,rd),"accent")]
        return s,100,100
    if tid=="f3":
        g=38; a1=-90+g; a2=-90-g+360
        ox1,oy1=pt(50,a1); ox2,oy2=pt(50,a2); ix1,iy1=pt(50-t,a1); ix2,iy2=pt(50-t,a2)
        d=f"M{L.f(ox1)},{L.f(oy1)}A50,50 0 1 1 {L.f(ox2)},{L.f(oy2)}L{L.f(ix2)},{L.f(iy2)}A{50-t},{50-t} 0 1 0 {L.f(ix1)},{L.f(iy1)}Z"
        c1=pt(50-t/2,a1); c2=pt(50-t/2,a2)
        return [(d,"ink"),(disc(*c1,r),"accent"),(disc(*c2,r),"accent")],100,100
    if tid=="f4":
        R=38;t2=t-1 if not small else t
        return [(ring(36,50,R,R-t2),"ink"),(ring(64,50,R,R-t2),"ink"),(disc(50,50,r*0.8),"accent")],102,100
L.symbol=sym
rows=""
for t,n in OPT.items():
    L.PAL[t]=dict(base); L.STYLES[t]=L.STYLES.get("e1",dict(w=10,xh=110,asc=110,rad=0,gap=24,dot="round",case="upper"))
    d=f"{D}/simbolo-{t}"
    L.write(f"{d}/symbol-color.svg",L.symbol_svg(t,"color",pad=0)); L.write(f"{d}/symbol-small.svg",L.symbol_svg(t,"color",small=True))
    L.write(f"{d}/app-icon.svg",L.app_icon(t)); L.write(f"{d}/avatar.svg",L.avatar(t))
    u=f"file://{d}"
    rows+=f"<div style='display:flex;gap:26px;align-items:center;margin:14px 22px'><div style='width:110px;font:600 13px Inter'>{t[1]} · {n}</div><div style='background:#F7F7F5;border-radius:12px;width:130px;height:110px;display:grid;place-items:center'><img src='{u}/symbol-color.svg' style='height:80px'></div><img src='{u}/app-icon.svg' style='width:84px;border-radius:19px'><img src='{u}/avatar.svg' style='width:84px;border-radius:50%'><div style='display:flex;gap:12px;align-items:center;background:#F7F7F5;padding:10px 14px;border-radius:10px'><img src='{u}/symbol-small.svg' style='height:16px'><img src='{u}/symbol-small.svg' style='height:24px'><img src='{u}/symbol-color.svg' style='height:32px'><img src='{u}/symbol-color.svg' style='height:48px'></div></div>"
open("tools/f.html","w").write("<body style='margin:0;background:#fff;font-family:Inter;padding-top:6px'>"+rows+"</body>")
json.dump([{"url":"file://"+os.getcwd()+"/tools/f.html","out":D+"/comparativo.png","w":900,"h":560}],open("tools/jf.json","w"))
