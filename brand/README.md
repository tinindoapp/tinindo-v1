# tinindo-brand · v0.3 · 2026-10-11 · arte aprovada

Kit de identidade da Tinindo, identidade **“sorriso”** (preto + laranja): versais finas, pingos laranja nos dois “I” (os olhos), “O” inclinado cujo arco de baixo é um sorriso cortado em dentes de serra (duas peças que se encaixam). **Proposta**: não está aprovada pelo sócio, nem registrada, nem juridicamente liberada.

**Para usar a marca agora:** `marca-pronta/` (ou o ZIP `tinindo-marca-pronta.zip`). **Mockups:** `mockups/` (site e app).

Comece por: `apresentacao/Tinindo-apresentacao-socio.pptx` (27 slides, com notas do apresentador) → `STATUS.md` → `BRAND.md` → `guidelines/brand-manual.pdf` → `applications/preview.html` (abra no navegador).

```
BRAND.md  DECISIONS.md  STATUS.md  LICENSES.md
apresentacao/ Tinindo-apresentacao-socio.pptx (+ .pdf)
guidelines/   brand-manual.md|html|pdf · fig-*.png
assets/       logo/ (svg+png, source/) · icons/ (favicon, sprite de UI) · app-icons/ (app, avatar)
tokens/       tokens.json · tokens.css · contrast-report.md
applications/ preview.html (vitrine) · pieces.html · exports/pecas.png
handoff/      lovable · claude-code · codex · canva · figma
research/     references.md (pendente) · creative-territories.md · evaluation.md · territories/ (A, B, C, D, E, sorriso)
              territories/b-indicacao/kit-completo-anterior/  (kit v0.1 do território B, arquivado)
```

Regenerar: scripts em `assets/logo/source/` (`geom.py`, `build_kit.py`; Python 3; variável `TOUT` = pasta raiz; PNG e PDF usam Chromium via Playwright). Fontes (Inter) não estão incluídas; ver LICENSES.md.
Não há repositório Git da Tinindo; nada foi commitado nem publicado.
