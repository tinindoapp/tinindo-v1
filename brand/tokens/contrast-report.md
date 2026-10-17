# Contraste — calculado a partir de tokens.json (WCAG 2.x, razão de luminância)

Gerado por script; razões arredondadas a 2 casas. Limiares: 4,5:1 texto normal; 3:1 texto grande, componentes de interface e gráficos. Isto verifica pares de cor, **não** a conformidade total da interface (foco, teclado, rótulos, leitores de tela exigem teste manual).

## Pares semânticos

| Tema | Par | Primeiro plano | Fundo | Razão | Mínimo | Resultado |
|---|---|---|---|---:|---:|---|
| claro | Texto principal sobre fundo | `text` #111111 | `bg` #F7F7F5 | 17.60 | 4.5 | passa |
| claro | Texto principal sobre superfície | `text` #111111 | `surface` #FFFFFF | 18.88 | 4.5 | passa |
| claro | Texto secundário sobre fundo | `text-muted` #4A4A46 | `bg` #F7F7F5 | 8.30 | 4.5 | passa |
| claro | Texto secundário sobre superfície | `text-muted` #4A4A46 | `surface` #FFFFFF | 8.90 | 4.5 | passa |
| claro | Texto do botão sobre ação | `text-on-action` #FFFFFF | `action` #111111 | 18.88 | 4.5 | passa |
| claro | Texto do botão sobre ação (hover) | `text-on-action` #FFFFFF | `action-hover` #2A2A28 | 14.38 | 4.5 | passa |
| claro | Link sobre fundo | `link` #111111 | `bg` #F7F7F5 | 17.60 | 4.5 | passa |
| claro | Link sobre superfície | `link` #111111 | `surface` #FFFFFF | 18.88 | 4.5 | passa |
| claro | Texto de destaque (barro) sobre fundo | `accent-text` #B33008 | `bg` #F7F7F5 | 5.86 | 4.5 | passa |
| claro | Borda de campo (controle) sobre superfície | `border-control` #62625D | `surface` #FFFFFF | 6.13 | 3.0 | passa |
| claro | Anel de foco sobre fundo | `focus` #1D5AA6 | `bg` #F7F7F5 | 6.39 | 3.0 | passa |
| claro | Anel de foco sobre superfície | `focus` #1D5AA6 | `surface` #FFFFFF | 6.85 | 3.0 | passa |
| claro | Sucesso: texto sobre fundo do aviso | `success-text` #1F6E3A | `success-bg` #E0F2E6 | 5.38 | 4.5 | passa |
| claro | Atenção: texto sobre fundo do aviso | `warning-text` #7A5200 | `warning-bg` #FDF0D2 | 6.12 | 4.5 | passa |
| claro | Erro: texto sobre fundo do aviso | `danger-text` #B3261E | `danger-bg` #FBE4E2 | 5.38 | 4.5 | passa |
| claro | Informação: texto sobre fundo do aviso | `info-text` #1D5AA6 | `info-bg` #E1ECF9 | 5.73 | 4.5 | passa |
| claro | Ponto/marca barro sobre fundo (não textual) | `brand-accent` #FF4B1F | `bg` #F7F7F5 | 3.12 | 3.0 | passa |
| claro | Texto de ação sutil | `action` #111111 | `action-subtle` #EDEDEA | 16.10 | 4.5 | passa |
| escuro | Texto principal sobre fundo | `text` #F7F7F5 | `bg` #111111 | 17.60 | 4.5 | passa |
| escuro | Texto principal sobre superfície | `text` #F7F7F5 | `surface` #1C1C1A | 15.91 | 4.5 | passa |
| escuro | Texto secundário sobre fundo | `text-muted` #BDBDB7 | `bg` #111111 | 10.00 | 4.5 | passa |
| escuro | Texto secundário sobre superfície | `text-muted` #BDBDB7 | `surface` #1C1C1A | 9.04 | 4.5 | passa |
| escuro | Texto do botão sobre ação | `text-on-action` #111111 | `action` #F7F7F5 | 17.60 | 4.5 | passa |
| escuro | Texto do botão sobre ação (hover) | `text-on-action` #111111 | `action-hover` #DEDED9 | 13.99 | 4.5 | passa |
| escuro | Link sobre fundo | `link` #F7F7F5 | `bg` #111111 | 17.60 | 4.5 | passa |
| escuro | Link sobre superfície | `link` #F7F7F5 | `surface` #1C1C1A | 15.91 | 4.5 | passa |
| escuro | Texto de destaque (barro) sobre fundo | `accent-text` #FF9A7A | `bg` #111111 | 9.13 | 4.5 | passa |
| escuro | Borda de campo (controle) sobre superfície | `border-control` #8C8C86 | `surface` #1C1C1A | 5.05 | 3.0 | passa |
| escuro | Anel de foco sobre fundo | `focus` #8DB6E8 | `bg` #111111 | 8.98 | 3.0 | passa |
| escuro | Anel de foco sobre superfície | `focus` #8DB6E8 | `surface` #1C1C1A | 8.12 | 3.0 | passa |
| escuro | Sucesso: texto sobre fundo do aviso | `success-text` #7CCB99 | `success-bg` #1C1C1A | 8.83 | 4.5 | passa |
| escuro | Atenção: texto sobre fundo do aviso | `warning-text` #F0C060 | `warning-bg` #1C1C1A | 10.09 | 4.5 | passa |
| escuro | Erro: texto sobre fundo do aviso | `danger-text` #F2958F | `danger-bg` #1C1C1A | 7.70 | 4.5 | passa |
| escuro | Informação: texto sobre fundo do aviso | `info-text` #8DB6E8 | `info-bg` #1C1C1A | 8.12 | 4.5 | passa |
| escuro | Ponto/marca barro sobre fundo (não textual) | `brand-accent` #FF6A3D | `bg` #111111 | 6.64 | 3.0 | passa |
| escuro | Texto de ação sutil | `action` #F7F7F5 | `action-subtle` #2A2A28 | 13.41 | 4.5 | passa |

## Pares fora da matriz

| Par | FG | BG | Razão | Mínimo | Resultado |
|---|---|---|---:|---:|---|
| Wordmark/ícone preto sobre papel | #111111 | #F7F7F5 | 17.60 | 3.0 | passa |
| Preto sobre laranja-500 (fundo laranja com logo preto) | #111111 | #FF4B1F | 5.65 | 3.0 | passa |
| Branco sobre laranja-500 (evitar texto; só elementos grandes) | #FFFFFF | #FF4B1F | 3.34 | 3.0 | passa |
| Laranja-500 como texto sobre papel (PROIBIDO) | #FF4B1F | #F7F7F5 | 3.12 | 4.5 | **NÃO PASSA — uso restrito/proibido** |
| Laranja-500 como ponto/olho sobre papel (não textual) | #FF4B1F | #F7F7F5 | 3.12 | 3.0 | passa |
| Laranja-400 (ponto/sorriso no negativo) sobre tinta-950 | #FF6A3D | #111111 | 6.64 | 3.0 | passa |
| Sorriso laranja claro #FFA588 sobre papel (REJEITADO) | #FFA588 | #F7F7F5 | 1.78 | 3.0 | **NÃO PASSA — uso restrito/proibido** |
