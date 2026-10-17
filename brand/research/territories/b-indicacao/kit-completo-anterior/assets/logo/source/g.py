import sys,os,json,math
sys.path.insert(0,os.path.dirname(__file__)); import logos as L
T=os.environ["TOUT"]; D=f"{T}/research/territories/e-preto-fino/sorriso"
f=L.f
L.STYLES["e1"]=dict(w=10,xh=110,asc=110,rad=0,gap=24,dot="round",case="upper")
L.PAL["e1"]=dict(ink="#111111",accent="#FF4B1F",bg="#F7F7F5",dark_bg="#111111",dark_ink="#FFFFFF",dark_accent="#FF6A3D")
def pt(cx,cy,r,a): return cx+r*math.cos(math.radians(a)),cy+r*math.sin(math.radians(a))
def sector(cx,cy,R,r,a1,a2):
    o1=pt(cx,cy,R,a1);o2=pt(cx,cy,R,a2);i1=pt(cx,cy,r,a1);i2=pt(cx,cy,r,a2)
    large=1 if (a2-a1)%360>180 else 0
    return f"M{f(o1[0])},{f(o1[1])}A{f(R)},{f(R)} 0 {large} 1 {f(o2[0])},{f(o2[1])}L{f(i2[0])},{f(i2[1])}A{f(r)},{f(r)} 0 {large} 0 {f(i1[0])},{f(i1[1])}Z"
def wordmark(span):
    items,W,top,bot=L.word("e1"); w=10; cap=110; R=cap/2
    items=items[:-1]  # remove O ring
    cx,cy=W-R,-R; half=span/2
    items.append((sector(cx,cy,R,R-w,90+half,90-half+360),"ink"))
    items.append((sector(cx,cy,R,R-w,90-half,90+half),"smile"))
    return items,W,top,bot
def face(span,ring=True):
    half=span/2; t=11; items=[]
    if ring:
        items.append((sector(50,50,50,50-t,90+half,90-half+360),"ink"))
        items.append((sector(50,50,50,50-t,90-half,90+half),"smile"))
        for dx in (-18,18): items.append((L.disc(50+dx,40,9),"accent"))
    else:
        items.append((sector(50,50,50,50-t,90-half,90+half),"smile"))
        for dx in (-25,25): items.append((L.disc(50+dx,24,10),"accent"))
    return items
COL={ # modo: (ink, accent, smile)
 "laranja":("#111111","#FF4B1F","#FF4B1F"),
 "claro":("#111111","#FF4B1F","#FFA588"),
 "cinza":("#111111","#FF4B1F","#B5B3AD"),
 "neg_laranja":("#FFFFFF","#FF6A3D","#FF6A3D"),
 "neg_claro":("#FFFFFF","#FF6A3D","#FFB59C"),
}
def svg(items,vb,col,w=None,bg=None):
    ink,acc,sm=COL[col]; m={"ink":ink,"accent":acc,"smile":sm}
    x,y,ww,hh=vb; p="".join(f'<path fill="{m[r]}" d="{d}"/>' for d,r in items)
    b=f'<rect x="{x}" y="{y}" width="{ww}" height="{hh}" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(x)} {f(y)} {f(ww)} {f(hh)}" role="img" aria-label="Tinindo"><title>Tinindo</title>{b}{p}</svg>'
def wm_svg(span,col):
    it,W,top,bot=wordmark(span); return svg(it,(0,top,W,bot-top),col)
def face_svg(span,col,ring=True,pad=4): return svg(face(span,ring),(-pad,-pad,100+2*pad,100+2*pad),col)
def icon_svg(span,col,ring=True):
    items=face(span,ring); k=1024*0.56/100; o=(1024-100*k)/2
    ink,acc,sm=COL["neg_"+col] if "neg_"+col in COL else COL["neg_laranja"]; m={"ink":ink,"accent":acc,"smile":sm}
    p="".join(f'<path fill="{m[r]}" d="{d}"/>' for d,r in items)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#111111"/><g transform="translate({f(o)} {f(o)}) scale({f(k)})">{p}</g></svg>'
def cell(s,w,bg="#F7F7F5",pad=18,rad=12,extra=""): return f"<div style='background:{bg};padding:{pad}px;border-radius:{rad}px;display:grid;place-items:center;{extra}'><div style='width:{w}px'>{s}</div></div>"
rows=""
for span in (140,180,220):
    rows+=f"<div style='display:flex;gap:18px;align-items:center;margin:10px 20px'><div style='width:70px;font:600 12px Inter'>sorriso {span}°</div>"
    rows+=cell(wm_svg(span,"laranja"),330)+cell(wm_svg(span,"neg_laranja"),250,"#111")
    rows+=cell(face_svg(span,"laranja",True),86)+cell(face_svg(span,"laranja",False),86)
    rows+=cell(icon_svg(span,"laranja",True),70,"#fff",0,16)+"</div>"
rows+="<div style='margin:14px 20px 4px;font:600 12px Inter'>Cor do sorriso (largura 180°)</div>"
for col,neg in (("claro","neg_claro"),("cinza","neg_claro")):
    rows+=f"<div style='display:flex;gap:18px;align-items:center;margin:10px 20px'><div style='width:70px;font:600 12px Inter'>{'laranja claro' if col=='claro' else 'cinza claro'}</div>"
    rows+=cell(wm_svg(180,col),330)+cell(wm_svg(180,neg),250,"#111")+cell(face_svg(180,col,True),86)+cell(face_svg(180,col,False),86)+"</div>"
rows+="<div style='margin:14px 20px 4px;font:600 12px Inter'>Teste de tamanho (180°, laranja)</div><div style='display:flex;gap:20px;align-items:end;margin:8px 20px;background:#F7F7F5;padding:12px;border-radius:10px;width:max-content'>"
for s in (16,24,32,48): rows+=f"<div style='width:{s}px'>{face_svg(180,'laranja',True,0)}</div>"
for s in (16,24,32,48): rows+=f"<div style='width:{s}px'>{face_svg(180,'laranja',False,0)}</div>"
for w in (96,120,160): rows+=f"<div style='width:{w}px'>{wm_svg(180,'laranja')}</div>"
rows+="</div>"
open("tools/g.html","w").write("<body style='margin:0;background:#fff;font-family:Inter;padding-top:8px'>"+rows+"</body>")
os.makedirs(D,exist_ok=True)
json.dump([{"url":"file://"+os.getcwd()+"/tools/g.html","out":D+"/comparativo.png","w":980,"h":900}],open("tools/jg.json","w"))
