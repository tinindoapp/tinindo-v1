import sys,os,json,math
sys.path.insert(0,os.path.dirname(__file__))
import h as H, logos as L
f=L.f; D=H.D
T_RING,TMAX,ER,EDX,EY,ROT=8,20,12,22,34,-10
half=110
def cut_pts(kind,g,side):
    s=side*g/2
    if kind=="zig":
        zz=[(50,72),(57,79),(43,86),(57,93),(43,100),(50,107)]
    else:
        zz=[(57,72),(57,80),(43,80),(43,88),(57,88),(57,96),(43,96),(43,107)]
    pts=[(x+s,y) for x,y in zz]
    far=-30 if side<0 else 130
    return [(far,-30),(pts[0][0],-30)]+pts+[(pts[-1][0],130),(far,130)]
def clip_def(cid,kind,g,side):
    pts=cut_pts(kind,g,side); d="M"+"L".join(f"{f(x)},{f(y)}" for x,y in pts)+"Z"
    return f'<clipPath id="{cid}"><path d="{d}"/></clipPath>'
def smile_paths(cL,cR,pfx,kind,g,transform=""):
    d=H.crescent(50,50,50,T_RING,TMAX,half)
    return (f'<defs>{clip_def(pfx+"L",kind,g,-1)}{clip_def(pfx+"R",kind,g,+1)}</defs>'
            f'<path fill="{cL}" clip-path="url(#{pfx}L)" d="{d}"/><path fill="{cR}" clip-path="url(#{pfx}R)" d="{d}"/>')
def head(ring,c,pfx,kind,g,two):
    ink,acc,smL,smR=c
    s=smile_paths(smL,smR,pfx,kind,g)
    ey=EY if ring else EY-14; dx=EDX if ring else EDX*1.15
    eyes="".join(f'<path fill="{acc}" d="{L.disc(50+d,ey,ER)}"/>' for d in (-dx,dx))
    r=f'<path fill="{ink}" d="{H.sector(50,50,50,50-T_RING,90+half,90-half+360)}"/>' if ring else ""
    return r+s+eyes
def sym_svg(ring,c,pfx,kind,g,pad=6):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {100+2*pad} {100+2*pad}"><g transform="rotate({ROT} 50 50)">{head(ring,c,pfx,kind,g,0)}</g></svg>'
def icon_svg(c,pfx,kind,g):
    k=1024*0.58/100;o=(1024-100*k)/2
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#111"/><g transform="translate({f(o)} {f(o)}) scale({f(k)}) rotate({ROT} 50 50)">{head(False,c,pfx,kind,g,0)}</g></svg>'
def wm_svg(c,pfx,kind,g):
    items,W,top,bot=L.word("e1"); R=55;w=10
    items=items[:-1]; cx,cy=W-R,-R
    ink,acc,smL,smR=c; letters="".join(f'<path fill="{ink if r=="ink" else acc}" d="{d}"/>' for d,r in items)
    kk=R/50
    O=(f'<g transform="translate({f(cx)} {f(cy)}) scale({f(kk)}) rotate({ROT}) translate(-50 -50)">'
       f'<path fill="{ink}" d="{H.sector(50,50,50,50-T_RING,90+half,90-half+360)}"/>{smile_paths(smL,smR,pfx,kind,g)}</g>')
    pad=4
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {f(top-pad)} {f(W+2*pad)} {f(bot-top+2*pad)}">{letters}{O}</svg>'
OR="#FF4B1F"; ORN="#FF6A3D"
VARS=[("Z1 · dentes de serra, uma cor, com fresta","zig",3,(  "#111",OR,OR,OR),("#fff",ORN,ORN,ORN)),
      ("Z2 · dedos, uma cor, com fresta","fin",3,("#111",OR,OR,OR),("#fff",ORN,ORN,ORN)),
      ("Z3 · dentes de serra, duas cores","zig",0,("#111",OR,OR,"#111"),("#fff",ORN,ORN,"#fff")),
      ("Z4 · dedos, duas cores","fin",0,("#111",OR,OR,"#111"),("#fff",ORN,ORN,"#fff"))]
cell=lambda s,w,bg="#F7F7F5",p=16,r=12:f"<div style='background:{bg};padding:{p}px;border-radius:{r}px;display:grid;place-items:center'><div style='width:{w}px'>{s}</div></div>"
rows=""
for i,(lab,kind,g,c,cn) in enumerate(VARS):
    p=f"z{i}"
    rows+=f"<div style='display:flex;gap:16px;align-items:center;margin:8px 18px'><div style='width:110px;font:600 12px Inter'>{lab}</div>"
    rows+=cell(wm_svg(c,p+'a',kind,g),300)+cell(wm_svg(cn,p+'b',kind,g),210,"#111")+cell(sym_svg(True,c,p+'c',kind,g),92)+cell(sym_svg(False,c,p+'d',kind,g),92)+cell(icon_svg(cn,p+'e',kind,g),66,"#fff",0,15)+"</div>"
rows+="<div style='margin:12px 18px 4px;font:600 12px Inter'>Teste de tamanho (Z3, sem anel): 16 · 24 · 32 · 48 px, e a palavra em 96 · 120 · 160 px</div><div style='display:flex;gap:18px;align-items:end;margin:6px 18px;background:#F7F7F5;padding:12px;border-radius:10px;width:max-content'>"
k,g,c=VARS[2][1],VARS[2][2],VARS[2][3]
for j,s in enumerate((16,24,32,48)): rows+=f"<div style='width:{s}px'>{sym_svg(False,c,f'q{j}',k,g,0)}</div>"
for j,w in enumerate((96,120,160)): rows+=f"<div style='width:{w}px'>{wm_svg(c,f'w{j}',k,g)}</div>"
rows+="</div>"
open("tools/i.html","w").write("<body style='margin:0;background:#fff;font-family:Inter;padding-top:8px'>"+rows+"</body>")
json.dump([{"url":"file://"+os.getcwd()+"/tools/i.html","out":D+"/maos.png","w":1000,"h":900,"full":True}],open("tools/ji.json","w"))
