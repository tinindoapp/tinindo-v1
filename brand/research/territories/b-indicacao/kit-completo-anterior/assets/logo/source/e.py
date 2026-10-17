import sys,os,json
sys.path.insert(0,os.path.dirname(__file__)); import logos as L
T=os.environ["TOUT"]; D=f"{T}/research/territories/e-preto-fino"
base=dict(ink="#111111",accent="#FF4B1F",bg="#F7F7F5",dark_bg="#111111",dark_ink="#FFFFFF",dark_accent="#FF6A3D")
OPT={"e1":"i","e2":"ii","e3":"T-teto","e4":"N","e5":"anel+ponto"}
for k in OPT:
    L.PAL[k]=dict(base); L.STYLES[k]=dict(w=10,xh=110,asc=110,rad=0,gap=24,dot="round",case="upper")
rr,disc,ring=L.rr,L.disc,L.ring
def sym(tid,small=False):
    w=14 if not small else 20; r=11 if not small else 14
    if tid=="e1": return [(rr(r-w/2,46,w,84),"ink"),(disc(r,r+1,r),"accent")],2*r,130
    if tid=="e2":
        g=w*3.2; o=r-w/2; return [(rr(o,46,w,84),"ink"),(rr(o+g,46,w,84),"ink"),(disc(r,r+1,r),"accent"),(disc(r+g,r+1,r),"accent")],2*r+g,130
    if tid=="e3":
        W=100; return [(rr(0,0,W,w),"ink"),(rr(W/2-w/2,0,w,100),"ink"),(disc(80,w+7+r,r),"accent")],W,100
    if tid=="e4":
        Wn=66; d=rr(0,0,w,100)+rr(Wn-w,0,w,100)+f"M0,0H{w*1.15}L{Wn},100H{Wn-w*1.15}Z"
        return [(d,"ink"),(disc(41,26,r*0.85),"accent")],Wn,100
    if tid=="e5":
        R=50; t=12 if not small else 17
        return [(ring(50,50,R,R-t),"ink"),(disc(50+44*0.7071,50-44*0.7071,r+3),"accent")],100,100
L.symbol=sym
rows=""
wm=f"file://{D}/wordmark-color.svg"
L.write(f"{D}/wordmark-color.svg",L.wordmark_svg("e1","color")); L.write(f"{D}/wordmark-dark.svg",L.wordmark_svg("e1","dark"))
L.write(f"{D}/wordmark-black.svg",L.wordmark_svg("e1","black"))
for t,n in OPT.items():
    d=f"{D}/simbolo-{t}"
    L.write(f"{d}/symbol-color.svg",L.symbol_svg(t,"color")); L.write(f"{d}/symbol-small.svg",L.symbol_svg(t,"color",small=True))
    L.write(f"{d}/app-icon.svg",L.app_icon(t)); L.write(f"{d}/avatar.svg",L.avatar(t))
    u=f"file://{d}"
    rows+=f"<div style='display:flex;gap:26px;align-items:center;margin:14px 22px'><div style='width:84px;font:600 13px Inter'>{t[1]} · {n}</div><div style='background:#F7F7F5;border-radius:12px;width:130px;height:110px;display:grid;place-items:center'><img src='{u}/symbol-color.svg' style='height:80px'></div><img src='{u}/app-icon.svg' style='width:84px;border-radius:19px'><img src='{u}/avatar.svg' style='width:84px;border-radius:50%'><div style='display:flex;gap:12px;align-items:center;background:#F7F7F5;padding:10px 14px;border-radius:10px'><img src='{u}/symbol-small.svg' style='height:16px'><img src='{u}/symbol-small.svg' style='height:24px'><img src='{u}/symbol-color.svg' style='height:32px'><img src='{u}/symbol-color.svg' style='height:48px'></div></div>"
head=f"<div style='margin:18px 22px;display:flex;gap:30px;align-items:center'><div style='background:#F7F7F5;padding:20px;border-radius:12px'><img src='{wm}' style='width:330px'></div><div style='background:#111;padding:20px;border-radius:12px'><img src='file://{D}/wordmark-dark.svg' style='width:250px'></div><div style='display:flex;gap:16px;align-items:end;font:11px Inter'><div><img src='{wm}' style='width:80px'><br>80px</div><div><img src='{wm}' style='width:120px'><br>120px</div><div><img src='{wm}' style='width:160px'><br>160px</div></div></div>"
open("tools/e.html","w").write("<body style='margin:0;background:#fff;font-family:Inter'>"+head+rows+"</body>")
json.dump([{"url":"file://"+os.getcwd()+"/tools/e.html","out":D+"/comparativo-simbolos.png","w":1000,"h":820}],open("tools/je.json","w"))
