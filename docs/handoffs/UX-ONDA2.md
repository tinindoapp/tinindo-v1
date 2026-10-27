# Handoff · UX onda 2 (auditoria de 27/10/2026)

Pedido do Felipe em 27/10: implementar a onda 2 de `docs/qa/AUDITORIA-UX-DESIGN-2026-10-27.md`, em dois blocos, um PR por bloco para a `main`, com merge feito pela sessão depois do CI verde. Só frontend e testes.

- **Bloco 1:** padrões do sistema, itens 5 a 15 e 17.
- **Bloco 2:** fluxos de impacto A, itens 24, 25, 27, 35, 36, 37, 47, E1, E4 e E5.

Na auditoria, ✓ ao lado do número marca o item feito.

## Coordenação

- **Sem `claim` no `coord.py`.** Não existe pacote de UX no quadro. O P42 (piloto) está reservado pelo Gabriel (`gabriel-p42-ux`). O trabalho veio por pedido direto do Felipe, como na onda 1, e não toca em migrations, contratos nem Edge Functions.
- **Branch:** `claude/dazzling-gates-ucc4sn`. No bloco 2 ela é recriada a partir da `main` depois do merge do bloco 1.
- **Frentes paralelas no bloco 1.** Os componentes ficaram prontos primeiro (b75ca31). Depois quatro frentes aplicaram os padrões nas telas, cada uma em arquivos separados:
  - Agenda: agenda, lista de espera, preços e páginas.
  - Clientes: clientes, mensagens, orçamentos, avaliações e relacionamento.
  - Dinheiro: caixa, pagamentos, assinaturas, notas, resultado, assistente, metas, campanhas e indicações.
  - Público: perfil, conta, diretório, site e Google, plano e serviços.
  
  As quatro foram mescladas na branch sem conflito.

## Bloco 1 · padrões do sistema

### Componentes novos em `src/components/ui`

| Arquivo | O que faz | Itens |
|---|---|---|
| `feedback.tsx` | `toast()` e `<Toaster/>`: um aviso por vez, fixo acima da barra de abas e da área segura do iPhone, `role="status"`, 5 s (6 s com ação), pausa com ponteiro ou foco, botão "Desfazer" e "Fechar aviso". `<ConfirmAction>`: confirmação no lugar do botão, com pergunta, consequência e botão `danger` "Sim, …"; foca a pergunta e "Voltar" devolve o foco | 5, 6 |
| `IconButton.tsx` | Botão só de ícone, 44 × 44 (40 dentro de avisos), nome acessível obrigatório | 17 |
| `form.tsx` | `<Field as="input\|select\|textarea" hint error>` liga rótulo, dica e erro (`aria-describedby`, `aria-invalid`). `useFormErrors()` grava os erros no envio e foca o primeiro campo com erro | 12, 15 |
| `selection.tsx` | `Segmented` (rádios), `ChipNav` (links com `aria-current`) e `ChoiceCard` (cartão com ✓; aceita `invalid` para o erro de grupo) | 9 |
| `tone.tsx` | Ícone diferente por tom: i, ✓, ! no triângulo, × | 7 |
| `index.tsx` | `Button` com `variant="danger"`, `loading` (spinner e `aria-busy`) e `loadingText` | 11 |

Também entrou no sistema de ícones a seta `voltar`.

### Tokens e CSS

- **Papéis de texto (item 10):** `--tn-text-title`, `section`, `group`, `body`, `support`, `label`, `number` e `number-lg` em `src/styles/global.css`. Todo `font-size` do app usa um desses papéis. `strong` tem peso 600.
- **Selecionado (item 9):** `--tn-selected-bg`, `-text`, `-border` e `-weight`.
- **Desabilitado (item 17):** `--tn-opacity-disabled`.
- **Perigo:** `--tn-danger-action`.
- **Tokens da marca:** nenhum valor novo de cor. Os tokens novos apontam para os de `brand/tokens`, e `brand/` não foi alterado.
- **Fonte dos controles (item 13):** um `font: inherit` global para controles. Os 20 que estavam nos módulos saíram. `tabular-nums` vem depois, em `.tn-num`, `time` e campos numéricos.
- **Hover e toque (item 14):** todo `:hover` está dentro de `@media (hover: hover)`. Há um `:active` comum para linhas, cartões-link, abas, chips e botões de ícone.
- **Avisos (item 7):** fundo `color-mix` do tom com a superfície (no tema escuro deixa de ser igual ao cartão) e barra de 4 px na cor do tom.
- **Utilitários (item 8):** `.tn-muted`, `.tn-stack`, `.tn-actions`, `.tn-form-grid` e `.tn-item-list` em `ui.css`. As classes `-muted`, `-actions` e `-stack` dos 22 módulos foram trocadas por eles.

### Regra de CSS no CI

Faz o papel do stylelint, sem dependência nova: `src/app/css-system.test.ts` falha quando um módulo tem:

- `font-size` fora dos papéis `--tn-text-*`;
- peso numérico;
- `font: inherit`;
- `:hover` fora de `@media (hover: hover)`;
- classe própria `-muted`, `-actions` ou `-stack`.

O `css-tokens.test.ts` ficou sem a lista de pendências: as duas reservas `var(--tn-x, valor)` que restavam foram corrigidas.

### Nas telas

- **Toast (item 5):** toda confirmação de sucesso saiu do topo da tela e virou Toast.
  - Erro de ação de um toque numa linha vira Toast de erro.
  - Ficam na tela: erro de formulário (perto do formulário), erro de carregamento e o que a pessoa precisa ler ou copiar (link gerado, código, Pix, relatório de importação).
- **Campos (itens 12 e 15):** todos os campos usam `Field`, e os wrappers próprios dos módulos foram removidos (`SelectField`, `FieldBox`, `.tn-*-field`).
  - O botão de enviar fica sempre ativo e só desliga enquanto envia (`loading`).
  - Continuam desligados: `readOnly` da demonstração do CRM e as regras de negócio. Exemplos: mensagem fora da janela de 24 h, modelo não aprovado, campanha sem público.
- **Cabeçalho (item 10):** as telas "Selecione um negócio" e as que abriam com cartão e `<h1>` usam `PageHeader`.
- **Seleção (item 9):**
  - Viraram `Segmented`: Dia/Semana da Agenda e nota de 1 a 5 em /avaliar.
  - Viraram `ChoiceCard`: serviço no novo agendamento, profissão e objetivo no onboarding.
  - O `crm-tabs`, que era CSS sem uso, saiu.
- **Botões de ícone (item 17):** ‹ e › da Agenda, do novo agendamento e do Caixa, e o fechar do menu, são `IconButton`.

### Ações destrutivas (item 6)

**Regra:** quando o port já tem a operação inversa e a ação não mandou mensagem, não mexeu em dinheiro nem invalidou um link de terceiro, ela executa na hora e o Toast oferece **Desfazer**. Nos outros casos, **ConfirmAction** com o verbo e a consequência concreta.

| Tela | Ação | Padrão |
|---|---|---|
| Clientes | Arquivar | Desfazer |
| Serviços | Arquivar e reativar | Desfazer nos dois sentidos |
| Horários | Remover bloqueio | Desfazer (recria o mesmo bloqueio) |
| Mensagens | Desvincular contato do cadastro | Desfazer |
| Mensagens | Desconectar número | Confirmar (diz o número e quantas mensagens ficam na fila) |
| Preços | Desativar regra | Confirmar (não há reativar: precisa de proposta nova) |
| Lista de espera | Retirar oferta, tirar da lista, "Não quero" (página pública) | Confirmar |
| Orçamentos | Cancelar, gerar novo link | Confirmar (o link do cliente para de funcionar) |
| Avaliações | Denunciar, retirar avaliação | Confirmar |
| Relacionamento | Cancelar passo, revogar consentimento | Confirmar (consentimento nunca volta por "Desfazer") |
| Caixa | Estornar recebimento, despesa e sessão de pacote; cancelar cobrança | Confirmar, com motivo quando o contrato guarda |
| Pagamentos | Estornar tudo, cancelar cobrança | Confirmar |
| Assinaturas | Cancelar no fim do ciclo | Desfazer (`resume`) |
| Assinaturas | Cancelar agora | Confirmar |
| Notas | Revogar autorização | Confirmar (é consentimento) |
| Notas | Cancelar nota | Confirmar (motivo com 15 letras ou mais) |
| Campanhas | Cancelar | Confirmar |
| Metas | Arquivar meta | Confirmar (não há desarquivar) |
| Metas | Remover apresentação do perfil | Desfazer (publica o mesmo texto) |
| Perfil | Tirar do ar | Desfazer (publica de novo com o mesmo endereço e campos) |
| Site | Tirar do ar | Desfazer (`restore` da mesma versão) |
| Site | Desligar domínio | Confirmar |
| Diretório | Sair (desmarcar e salvar) | Desfazer |
| Conta | Desvincular | Confirmar |
| Google e Plano e serviços | Revogar acesso; cancelar pedido | Confirmar |
| Equipe (P28, chegou na `main` durante o bloco) | Remover comissão por serviço, liberar vaga de turma | Desfazer (grava o mesmo percentual; inscreve a mesma cliente) |
| Equipe | Cancelar reserva, cancelar turma, estornar comissão | Confirmar |
| Agenda | Cancelar atendimento | Botão final `danger` e Toast. O fluxo é refeito no item 27 (bloco 2) |

### Decisões

- **Erro sem asterisco.** O campo obrigatório não tem marca visual: o `required` nativo e o erro no envio bastam. O asterisco quebrava os rótulos que os testes leem.
- **Erro sem `role="alert"`.** O erro do campo é lido pelo `aria-describedby` quando o foco chega nele. Com `role="alert"`, todos os erros seriam anunciados de uma vez.
- **Toast por cima de botões.** No celular, o Toast fica 5 a 6 s acima da barra de abas e pode cobrir o botão logo acima dela. Ele tem botão de fechar e pausa ao toque. Foi escolhido por ficar sempre à vista, que era o problema medido na auditoria (aviso a −667 px).
- **Aviso depois de mudar de tela.** No novo agendamento e no reagendar, o Toast sai depois que a tela do atendimento carrega. Voltar no histórico para essa entrada pode mostrar o aviso de novo.
- **Segmented com 44 px.** A opção tem 44 px e o rádio fica por cima, então o toque e o `check()` do Playwright caem no rádio.

### Testes do bloco 1

- **Unitários.** Os componentes são cobertos por `src/components/ui/ui.test.tsx`. Por tela, os testes cobrem três coisas: Desfazer chama a operação inversa, ConfirmAction não executa sem o "Sim" e o foco vai para o primeiro erro. Arquivos novos:
  - Caixa, Pagamentos, Assinaturas, Metas;
  - Orçamentos, Mensagens, Avaliações;
  - Espera, Preços, Entrar;
  - Diretório, Site, Plano e serviços.
- **e2e.** `tests/e2e/foundation/padroes.spec.ts` percorre todas as telas do menu e /entrar, /criar-conta e /diretorio. Roda em 375 px nos temas claro e escuro, e no desktop. Confere:
  - sem rolagem horizontal;
  - nenhuma fonte menor que 12 px;
  - todo botão com nome acessível;
  - botão de ícone com 40 px ou mais.
- **Specs ajustadas,** porque a ação agora pede confirmação ou o botão deixou de ficar desligado: caixa, pagamentos, assinaturas, notas, campanhas, orçamentos, avaliações, site, serviços, agenda e uma linha de `qa/jornada-integrada`.
- **Resultado local:**

  | Comando | Resultado |
  |---|---|
  | `npm run lint` | ok |
  | `npm run typecheck` | ok |
  | `npm run test:unit` | 499 passaram |
  | `npm run test:e2e` | desktop e mobile, 0 falhas; os 33 pulados são os `fixme` que já existiam |

  Na suíte completa com a máquina carregada, os testes da agenda e o novo de Orçamentos falharam uma vez por timeout de 1 s e passaram de novo isolados. Vale observar no CI.

### Para o bloco 2 e a onda 3

- **Fica para o E4:** os horários do perfil público e os horários livres do novo agendamento ainda são botões com `aria-pressed`. Usam os tokens de selecionado, mas não um componente.
- **Fica para a onda 3:**
  - item 18: Chip para dias da semana;
  - `share.tsx`, que está duplicado em vendas e relacionamento;
  - o `ActButton` local de Notas, Metas e Campanhas, que pode virar um botão compartilhado de ação assíncrona.
