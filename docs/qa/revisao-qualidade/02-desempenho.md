# Desempenho do front · bloco 2

Medido em 21/11/2026 sobre o build de produção (`vite preview`), na demonstração.

**Celular médio em 4G:**
- Chromium com o perfil Pixel 7.
- Rede "Slow 4G" do Lighthouse: 150 ms de ida e volta, 1,6 Mbps de descida.
- CPU 4× mais lenta.

**O que conta como "visível" e "interativa":**
- **Visível:** do início da navegação até o título "Hoje" aparecer.
- **Interativa:** até o primeiro toque (Menu) responder.

Os tempos são a mediana de cinco cargas, com o mesmo script nas duas versões: `main` em `b818dbe` contra este PR.

## Antes e depois

| Medida | Antes | Depois | Teto no teste |
|---|---|---|---|
| Hoje visível | 3.302 ms | 3.167 ms | 5.200 ms |
| Hoje interativa (primeiro toque responde) | 3.514 ms | 3.384 ms | 5.600 ms |
| JS baixado na Hoje, compactado | 338 KB | 327 KB | 345 KB |
| JS da Hoje sem compactar | 1.024 KB | 982 KB | 1.020 KB |
| CSS da Hoje | 130 KB | 123 KB | 130 KB |
| Pedidos de JS na Hoje | 50 | 54 | 60 |
| Maior pedaço de JS do build | 230 KB (`global`, react-dom) | 223 KB | 240 KB |
| JS total do build | 1.846 KB em 106 arquivos | 1.804 KB | 1.900 KB |
| CSS total do build | 134 KB | 134 KB | 145 KB |

O teste `tests/e2e/desempenho/desempenho.spec.ts` roda no projeto desktop do Chromium, em todo PR. Ele reprova quando uma medida passa do teto:

- **Tamanhos:** são determinísticos, então o teto tem folga pequena.
- **Tempos:** dependem da máquina do CI, então o teto tem cerca de 1,6× o medido aqui.

Para subir um teto: medida nova e motivo no PR.

Os pedidos de JS subiram de 50 para 54 porque três peças viraram pedaços próprios. Mesmo assim o total caiu, e as peças só chegam quando a tela precisa delas.

## Para onde vai o peso (Hoje, sem compactar)

| Pedaço | KB | O que é | Área |
|---|---|---|---|
| `global` | 223 | react-dom | base (fora) |
| `supabase` | 210 | `@supabase/supabase-js` inteiro: auth (423 KB de fonte), storage, realtime, postgrest, iceberg | `src/lib/supabase.ts` (fora) |
| `client` | 197 | react-router (367 KB de fonte) e zod (362 KB) | base (fora) |
| `mount` | 54 | shell, páginas, privacidade | `src/app` |
| `ui` | 35 | kit | esta área |
| `SchedulingLayout` + `use-port` | 31 + 46 | portas e emulação da demonstração | scheduling, comum |

Quase 60% do JS da Hoje é base que está fora desta área: React, roteador, zod e o cliente Supabase inteiro.

## Os três maiores custos atacados aqui

1. **Perfil público carregado com o app inteiro.** As rotas `/p/:slug`, `/reserva` e `/reserva/:slug` (`src/features/network/public-routes.tsx`) importavam as telas direto. Com isso, toda abertura do app baixava o perfil público (`PublicProfileView`, 24 KB), o kit público e o CSS deles. Agora cada rota carrega a tela sob demanda; o teste confere que o perfil público não entra na Hoje.
2. **Sugestão do dia na Hoje** (`Insights`, 45 KB, do módulo Metas, que é por ativação). Vinha mesmo com o módulo desligado. Agora chega sob demanda (`React.lazy`), e o lugar fica vazio até ela chegar.
3. **Ações do atendimento começado** (`attendance`, 37 KB + 15 KB de CSS). Só aparecem quando há atendimento já começado; agora chegam sob demanda. O teste de unidade espera por elas.

## O que fica para as outras áreas (recado com passo a passo)

1. **Cliente Supabase só com o que o app usa** (`src/lib/supabase.ts`).
   - O app usa auth e PostgREST. Storage, realtime e iceberg (cerca de 120 KB compactados de fonte) vêm junto.
   - Na demonstração, sem servidor, o cliente nem é criado, mas o pacote é baixado.
   - Caminho:
     1. Importar `createClient` por `import()` só quando há `VITE_SUPABASE_URL`.
     2. Ou usar `@supabase/auth-js` e `@supabase/postgrest-js` direto.
   - Ganho estimado: até 54 KB compactados na Hoje.
2. **CSS de todos os módulos na carga inicial.**
   - 23 `module.tsx` importam o CSS do módulo no manifesto (cerca de 66 KB sem compactar no total), e o manifesto é carregado de uma vez.
   - Mover o `import "./x.css"` para o arquivo das telas (`routes.tsx`).
   - Os de scheduling, crm, finance, lifecycle, setup e network são desta área. Ficaram para não misturar com o bloco de tela grande, que mexe no mesmo CSS. Os outros 17 são de outros módulos.
3. **`identity.css`, `public-kit.css` e `network.css` ainda chegam na Hoje.** Vêm de importações estáticas no shell (`src/app/mount.tsx` e `public-app.tsx`). Mesmo caminho do item 2.
4. **Fonte.**
   - Inter com o eixo de tamanho óptico (71 KB): já é `swap` e só o subconjunto latino.
   - Um `<link rel="preload">` em `index.html` (fora desta área) adiantaria o texto final em cerca de uma ida e volta.
