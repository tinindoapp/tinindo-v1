#!/usr/bin/env python3
import os, json
T = os.environ["TOUT"]

PRIM = {
 "tinta":   {"950":"#111111","900":"#1C1C1A","800":"#2A2A28","700":"#3A3A37","600":"#4A4A46","500":"#62625D","400":"#8C8C86","300":"#BDBDB7","200":"#DEDED9","100":"#EDEDEA"},
 "papel":   {"50":"#F7F7F5"},
 "laranja": {"700":"#B33008","500":"#FF4B1F","400":"#FF6A3D","300":"#FF9A7A","200":"#FFC9B8","100":"#FFE9E1"},
 "verde":   {"700":"#1F6E3A","300":"#7CCB99","100":"#E0F2E6"},
 "ambar":   {"700":"#7A5200","300":"#F0C060","100":"#FDF0D2"},
 "vermelho":{"700":"#B3261E","300":"#F2958F","100":"#FBE4E2"},
 "azul":    {"700":"#1D5AA6","300":"#8DB6E8","100":"#E1ECF9"},
 "branco":  {"0":"#FFFFFF"},
}
def hx(ref):
    a, b = ref.split(".")
    return PRIM[a][b]

# semânticos: nome -> (claro, escuro) como referências "familia.tom"
SEM = {
 "bg":              ("papel.50",    "tinta.950"),
 "surface":         ("branco.0",    "tinta.900"),
 "surface-sunken":  ("tinta.100",   "tinta.950"),
 "text":            ("tinta.950",   "papel.50"),
 "text-muted":      ("tinta.600",   "tinta.300"),
 "text-on-action":  ("branco.0",    "tinta.950"),
 "border":          ("tinta.200",   "tinta.700"),
 "border-control":  ("tinta.500",   "tinta.400"),
 "brand":           ("tinta.950",   "papel.50"),
 "brand-accent":    ("laranja.500", "laranja.400"),
 "accent-text":     ("laranja.700", "laranja.300"),
 "action":          ("tinta.950",   "papel.50"),
 "action-hover":    ("tinta.800",   "tinta.200"),
 "action-subtle":   ("tinta.100",   "tinta.800"),
 "link":            ("tinta.950",   "papel.50"),
 "focus":           ("azul.700",    "azul.300"),
 "success-text":    ("verde.700",   "verde.300"),
 "success-bg":      ("verde.100",   "tinta.900"),
 "warning-text":    ("ambar.700",   "ambar.300"),
 "warning-bg":      ("ambar.100",   "tinta.900"),
 "danger-text":     ("vermelho.700","vermelho.300"),
 "danger-bg":       ("vermelho.100","tinta.900"),
 "info-text":       ("azul.700",    "azul.300"),
 "info-bg":         ("azul.100",    "tinta.900"),
}

OTHER = {
 "font": {"sans": '"Inter", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          "display": '"Inter Display", "Inter", system-ui, "Segoe UI", Roboto, Arial, sans-serif',
          "mono": 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'},
 "font-weight": {"regular": 400, "medium": 500, "semibold": 600, "bold": 700},
 "font-size": {"xs": "12px", "sm": "14px", "md": "16px", "lg": "18px", "xl": "20px", "2xl": "24px", "3xl": "32px", "4xl": "44px", "5xl": "56px"},
 "line-height": {"tight": 1.1, "snug": 1.25, "normal": 1.5},
 "letter-spacing": {"display": "-0.02em", "normal": "0", "caps": "0.06em"},
 "space": {"1": "4px", "2": "8px", "3": "12px", "4": "16px", "5": "20px", "6": "24px", "8": "32px", "10": "40px", "12": "48px", "16": "64px"},
 "radius": {"sm": "8px", "md": "12px", "lg": "20px", "pill": "999px"},
 "shadow": {"sm": "0 1px 2px rgba(17,17,17,.08)", "md": "0 6px 18px rgba(17,17,17,.10)", "lg": "0 18px 48px rgba(17,17,17,.16)"},
 "motion": {"fast": "120ms", "base": "200ms", "slow": "320ms", "ease": "cubic-bezier(.2,.7,.2,1)"},
 "size": {"touch": "44px", "touch-min": "24px", "focus-ring": "3px", "container": "1120px"},
 "material": {"glass-blur": "20px", "glass-saturate": "1.4"},
}

# --- contraste (WCAG 2.x)
def lum(h):
    h = h.lstrip("#"); r, g, b = [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]
    f = lambda c: c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4
    return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b)
def cr(a, b):
    la, lb = lum(a), lum(b)
    if la < lb: la, lb = lb, la
    return (la+0.05)/(lb+0.05)

PAIRS = [  # (descrição, fg, bg, mínimo exigido, tema)
 ("Texto principal sobre fundo", "text", "bg", 4.5), ("Texto principal sobre superfície", "text", "surface", 4.5),
 ("Texto secundário sobre fundo", "text-muted", "bg", 4.5), ("Texto secundário sobre superfície", "text-muted", "surface", 4.5),
 ("Texto do botão sobre ação", "text-on-action", "action", 4.5), ("Texto do botão sobre ação (hover)", "text-on-action", "action-hover", 4.5),
 ("Link sobre fundo", "link", "bg", 4.5), ("Link sobre superfície", "link", "surface", 4.5),
 ("Texto de destaque (barro) sobre fundo", "accent-text", "bg", 4.5),
 ("Borda de campo (controle) sobre superfície", "border-control", "surface", 3.0),
 ("Anel de foco sobre fundo", "focus", "bg", 3.0), ("Anel de foco sobre superfície", "focus", "surface", 3.0),
 ("Sucesso: texto sobre fundo do aviso", "success-text", "success-bg", 4.5),
 ("Atenção: texto sobre fundo do aviso", "warning-text", "warning-bg", 4.5),
 ("Erro: texto sobre fundo do aviso", "danger-text", "danger-bg", 4.5),
 ("Informação: texto sobre fundo do aviso", "info-text", "info-bg", 4.5),
 ("Ponto/marca barro sobre fundo (não textual)", "brand-accent", "bg", 3.0),
 ("Texto de ação sutil", "action", "action-subtle", 4.5),
]
rows = []
for mode, idx in (("claro", 0), ("escuro", 1)):
    for d, fg, bg, need in PAIRS:
        a = hx(SEM[fg][idx]); b = hx(SEM[bg][idx]); r = cr(a, b)
        rows.append((mode, d, fg, bg, a, b, r, need, r >= need))
# pares extras fora da matriz semântica
EXTRA = [("Wordmark/ícone preto sobre papel", "#111111", "#F7F7F5", 3.0),
         ("Preto sobre laranja-500 (fundo laranja com logo preto)", "#111111", "#FF4B1F", 3.0),
         ("Branco sobre laranja-500 (evitar texto; só elementos grandes)", "#FFFFFF", "#FF4B1F", 3.0),
         ("Laranja-500 como texto sobre papel (PROIBIDO)", "#FF4B1F", "#F7F7F5", 4.5),
         ("Laranja-500 como ponto/olho sobre papel (não textual)", "#FF4B1F", "#F7F7F5", 3.0),
         ("Laranja-400 (ponto/sorriso no negativo) sobre tinta-950", "#FF6A3D", "#111111", 3.0),
         ("Sorriso laranja claro #FFA588 sobre papel (REJEITADO)", "#FFA588", "#F7F7F5", 3.0)]
extra_rows = [(d, a, b, cr(a, b), need, cr(a, b) >= need) for d, a, b, need in EXTRA]

# --- escrita
def pref(path): return "--tn-" + "-".join(path)
json_out = {"$description": "Tinindo — design tokens v0.2 (provisório; identidade 'sorriso'). Primitivos e semânticos separados.",
            "primitive": {"color": {fam: {k: {"$value": v, "$type": "color"} for k, v in sc.items()} for fam, sc in PRIM.items()}},
            "semantic": {"light": {k: {"$value": "{primitive.color." + v[0] + "}", "$resolved": hx(v[0]), "$type": "color"} for k, v in SEM.items()},
                         "dark":  {k: {"$value": "{primitive.color." + v[1] + "}", "$resolved": hx(v[1]), "$type": "color"} for k, v in SEM.items()}},
            "core": {grp: {k: {"$value": v} for k, v in d.items()} for grp, d in OTHER.items()}}
os.makedirs(f"{T}/tokens", exist_ok=True)
json.dump(json_out, open(f"{T}/tokens/tokens.json", "w"), indent=2, ensure_ascii=False)

css = ["/* Tinindo — tokens v0.2 (provisório; identidade 'sorriso'). Gerado junto de tokens.json: mesmos nomes e valores. */", ":root {", "  /* Primitivos */"]
for fam, sc in PRIM.items():
    for k, v in sc.items(): css.append(f"  --tn-color-{fam}-{k}: {v};")
for grp, d in OTHER.items():
    css.append(f"  /* {grp} */")
    for k, v in d.items(): css.append(f"  --tn-{grp}-{k}: {v};")
css.append("  /* Semânticos — tema claro (padrão) */")
for k, v in SEM.items(): css.append(f"  --tn-{k}: var(--tn-color-{v[0].replace('.', '-')});")
css.append("  --tn-glass-bg: rgba(247,247,245,.74); --tn-glass-border: rgba(255,255,255,.6);")
css.append("}")
css.append("\n/* Tema escuro: automático (preferência do sistema) ou forçado com data-theme=\"dark\" */")
dark_body = "\n".join(f"  --tn-{k}: var(--tn-color-{v[1].replace('.', '-')});" for k, v in SEM.items()) + "\n  --tn-glass-bg: rgba(28,28,26,.70); --tn-glass-border: rgba(255,255,255,.14);\n  color-scheme: dark;"
css.append(f"@media (prefers-color-scheme: dark) {{\n  :root:not([data-theme=\"light\"]) {{\n{dark_body}\n  }}\n}}")
css.append(f":root[data-theme=\"dark\"] {{\n{dark_body}\n}}")
css.append("""
/* Material "vidro": só para camadas flutuantes (barra de navegação, sheets, diálogo do agente).
   Nunca em tabelas, campos, formulários ou blocos de leitura. Sempre com alternativa opaca. */
.tn-glass {
  background: var(--tn-surface);
  border: 1px solid var(--tn-border);
}
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .tn-glass {
    background: var(--tn-glass-bg);
    border-color: var(--tn-glass-border);
    -webkit-backdrop-filter: blur(var(--tn-material-glass-blur)) saturate(var(--tn-material-glass-saturate));
    backdrop-filter: blur(var(--tn-material-glass-blur)) saturate(var(--tn-material-glass-saturate));
  }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .tn-glass { background: var(--tn-surface) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; border-color: var(--tn-border-control) !important; }
}
@media (prefers-reduced-motion: reduce) {
  :root { --tn-motion-fast: 0ms; --tn-motion-base: 0ms; --tn-motion-slow: 0ms; }
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
""")
open(f"{T}/tokens/tokens.css", "w").write("\n".join(css) + "\n")

# relatório de contraste em Markdown
md = ["# Contraste — calculado a partir de tokens.json (WCAG 2.x, razão de luminância)\n",
      "Gerado por script; razões arredondadas a 2 casas. Limiares: 4,5:1 texto normal; 3:1 texto grande, componentes de interface e gráficos. "
      "Isto verifica pares de cor, **não** a conformidade total da interface (foco, teclado, rótulos, leitores de tela exigem teste manual).\n",
      "## Pares semânticos\n", "| Tema | Par | Primeiro plano | Fundo | Razão | Mínimo | Resultado |", "|---|---|---|---|---:|---:|---|"]
for mode, d, fg, bg, a, b, r, need, ok in rows:
    md.append(f"| {mode} | {d} | `{fg}` {a} | `{bg}` {b} | {r:.2f} | {need} | {'passa' if ok else '**FALHA**'} |")
md += ["\n## Pares fora da matriz\n", "| Par | FG | BG | Razão | Mínimo | Resultado |", "|---|---|---|---:|---:|---|"]
for d, a, b, r, need, ok in extra_rows:
    md.append(f"| {d} | {a} | {b} | {r:.2f} | {need} | {'passa' if ok else '**NÃO PASSA — uso restrito/proibido**'} |")
open(f"{T}/tokens/contrast-report.md", "w").write("\n".join(md) + "\n")
fails = [r for r in rows if not r[-1]]
print("pares:", len(rows), "falhas:", [(r[0], r[1], round(r[6], 2)) for r in fails])
print([(e[0], round(e[3], 2), e[5]) for e in extra_rows])
