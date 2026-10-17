# Contraste — calculado a partir de tokens.json (WCAG 2.x, razão de luminância)

Gerado por script; razões arredondadas a 2 casas. Limiares: 4,5:1 texto normal; 3:1 texto grande, componentes de interface e gráficos. Isto verifica pares de cor, **não** a conformidade total da interface (foco, teclado, rótulos, leitores de tela exigem teste manual).

## Pares semânticos

| Tema | Par | Primeiro plano | Fundo | Razão | Mínimo | Resultado |
|---|---|---|---|---:|---:|---|
| claro | Texto principal sobre fundo | `text` #131A1C | `bg` #FBF8F2 | 16.62 | 4.5 | passa |
| claro | Texto principal sobre superfície | `text` #131A1C | `surface` #FFFFFF | 17.61 | 4.5 | passa |
| claro | Texto secundário sobre fundo | `text-muted` #46545A | `bg` #FBF8F2 | 7.40 | 4.5 | passa |
| claro | Texto secundário sobre superfície | `text-muted` #46545A | `surface` #FFFFFF | 7.85 | 4.5 | passa |
| claro | Texto do botão sobre ação | `text-on-action` #FFFFFF | `action` #0B4F5C | 9.18 | 4.5 | passa |
| claro | Texto do botão sobre ação (hover) | `text-on-action` #FFFFFF | `action-hover` #0A3A45 | 12.32 | 4.5 | passa |
| claro | Link sobre fundo | `link` #146577 | `bg` #FBF8F2 | 6.27 | 4.5 | passa |
| claro | Link sobre superfície | `link` #146577 | `surface` #FFFFFF | 6.65 | 4.5 | passa |
| claro | Texto de destaque (barro) sobre fundo | `accent-text` #A83F14 | `bg` #FBF8F2 | 5.85 | 4.5 | passa |
| claro | Borda de campo (controle) sobre superfície | `border-control` #5B6A70 | `surface` #FFFFFF | 5.61 | 3.0 | passa |
| claro | Anel de foco sobre fundo | `focus` #1D5AA6 | `bg` #FBF8F2 | 6.46 | 3.0 | passa |
| claro | Anel de foco sobre superfície | `focus` #1D5AA6 | `surface` #FFFFFF | 6.85 | 3.0 | passa |
| claro | Sucesso: texto sobre fundo do aviso | `success-text` #1F6E3A | `success-bg` #E0F2E6 | 5.38 | 4.5 | passa |
| claro | Atenção: texto sobre fundo do aviso | `warning-text` #8A5300 | `warning-bg` #FDF0D2 | 5.60 | 4.5 | passa |
| claro | Erro: texto sobre fundo do aviso | `danger-text` #B3261E | `danger-bg` #FBE4E2 | 5.38 | 4.5 | passa |
| claro | Informação: texto sobre fundo do aviso | `info-text` #1D5AA6 | `info-bg` #E1ECF9 | 5.73 | 4.5 | passa |
| claro | Ponto/marca barro sobre fundo (não textual) | `brand-accent` #D9602B | `bg` #FBF8F2 | 3.50 | 3.0 | passa |
| claro | Texto de ação sutil | `action` #0B4F5C | `action-subtle` #E1F1F4 | 7.91 | 4.5 | passa |
| escuro | Texto principal sobre fundo | `text` #FBF8F2 | `bg` #061E24 | 16.25 | 4.5 | passa |
| escuro | Texto principal sobre superfície | `text` #FBF8F2 | `surface` #0A3A45 | 11.63 | 4.5 | passa |
| escuro | Texto secundário sobre fundo | `text-muted` #B7C0C3 | `bg` #061E24 | 9.30 | 4.5 | passa |
| escuro | Texto secundário sobre superfície | `text-muted` #B7C0C3 | `surface` #0A3A45 | 6.66 | 4.5 | passa |
| escuro | Texto do botão sobre ação | `text-on-action` #061E24 | `action` #8CC3CF | 8.88 | 4.5 | passa |
| escuro | Texto do botão sobre ação (hover) | `text-on-action` #061E24 | `action-hover` #BFE0E7 | 12.33 | 4.5 | passa |
| escuro | Link sobre fundo | `link` #8CC3CF | `bg` #061E24 | 8.88 | 4.5 | passa |
| escuro | Link sobre superfície | `link` #8CC3CF | `surface` #0A3A45 | 6.35 | 4.5 | passa |
| escuro | Texto de destaque (barro) sobre fundo | `accent-text` #F08A56 | `bg` #061E24 | 6.95 | 4.5 | passa |
| escuro | Borda de campo (controle) sobre superfície | `border-control` #8A979B | `surface` #0A3A45 | 4.10 | 3.0 | passa |
| escuro | Anel de foco sobre fundo | `focus` #8CC3CF | `bg` #061E24 | 8.88 | 3.0 | passa |
| escuro | Anel de foco sobre superfície | `focus` #8CC3CF | `surface` #0A3A45 | 6.35 | 3.0 | passa |
| escuro | Sucesso: texto sobre fundo do aviso | `success-text` #7CCB99 | `success-bg` #0A3A45 | 6.37 | 4.5 | passa |
| escuro | Atenção: texto sobre fundo do aviso | `warning-text` #F0C060 | `warning-bg` #0A3A45 | 7.28 | 4.5 | passa |
| escuro | Erro: texto sobre fundo do aviso | `danger-text` #F2958F | `danger-bg` #0A3A45 | 5.56 | 4.5 | passa |
| escuro | Informação: texto sobre fundo do aviso | `info-text` #8DB6E8 | `info-bg` #0A3A45 | 5.86 | 4.5 | passa |
| escuro | Ponto/marca barro sobre fundo (não textual) | `brand-accent` #F08A56 | `bg` #061E24 | 6.95 | 3.0 | passa |
| escuro | Texto de ação sutil | `action` #8CC3CF | `action-subtle` #0B4F5C | 4.73 | 4.5 | passa |

## Pares fora da matriz

| Par | FG | BG | Razão | Mínimo | Resultado |
|---|---|---|---:|---:|---|
| Branco sobre marca petróleo-800 (logo branco) | #FFFFFF | #0B4F5C | 9.18 | 3.0 | passa |
| Branco sobre barro-600 (fundo de logo) | #FFFFFF | #D9602B | 3.71 | 3.0 | passa |
| Barro-600 como texto sobre areia-50 (PROIBIDO) | #D9602B | #FBF8F2 | 3.50 | 4.5 | **NÃO PASSA — uso restrito/proibido** |
| Pingo barro-400 sobre petróleo-950 (negativo) | #F08A56 | #0A1E22 | 6.94 | 3.0 | passa |
| Logo ink sobre areia-50 | #0B4F5C | #FBF8F2 | 8.66 | 3.0 | passa |
