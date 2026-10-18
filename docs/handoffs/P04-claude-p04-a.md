# Handoff · P04 Agenda e experiência web

Sessão: `claude-p04-a` (Claude Code, nuvem), em nome de @fffalleiros · 2026-10-18
Branch: `task/p04/claude-p04-a` → PR para `main` (link no PR). Reserva no quadro: `coordination:workboard.json`.

## Resultado

Módulo `src/features/scheduling/` substitui o placeholder do P00:

- **Hoje / Dia**: linha do tempo com atendimentos (estado com ícone + texto, preço combinado), pausa, bloqueio pessoal e horários livres com atalho "Agendar". Navegação anterior/hoje/próximo, estado na URL (`?data=AAAA-MM-DD&visao=dia|semana`).
- **Semana**: segunda a domingo, atendimentos e % ocupado por dia, "Fechado" sem expediente.
- **Ocupação** (ajuste do Gabriel): minutos confirmados / minutos vendáveis (expediente − bloqueios). Reservas provisórias não contam; bloqueios, faltas e cancelamentos aparecem à parte. Sem expediente, não inventa porcentagem.
- **Atendimento**: detalhe, reagendar, cancelar (motivo obrigatório, política de cancelamento visível, "nenhuma mensagem é enviada") e concluir (só após o início; avisa que não registra pagamento).
- **Novo / Reagendar**: serviço → dia e horários livres (`availability.list`) → cliente → valor (`pricing.quote`, com base, final, motivo, versão da regra e validade; "ver o valor não segura o horário") → revisão e confirmação. No reagendamento, mudança de preço explícita (antes → depois).
- **Erros 409 explicados**: `SLOT_CONFLICT` (nada foi criado / continua no horário antigo; horários recarregados e o ocupado some), `STALE_VERSION` (não sobrescreve; recarrega), `IDEMPOTENCY_MISMATCH`; falha transitória diz que repetir é seguro porque usa a mesma `Idempotency-Key`.
- **Data/fuso**: toda conversão e exibição usa o timezone IANA do negócio (`time.ts`), nunca o do navegador. Testado com o navegador em `Asia/Tokyo` e com dia de 23 h (DST de Nova York).
- **Mobile**: alvos ≥ 44 px, sem rolagem horizontal (verificado no Pixel 7), foco visível do tema, `aria-pressed`, `role=alert` em erros. Só tokens da marca: ação principal preta, laranja nunca em texto/estado.
- **Ganchos para oferta/lista (P05/P07)**: `SchedulingExtensionsProvider` com `freeSlotActions(slot)` renderiza ações nos horários livres sem um módulo importar o outro.

## Mocks e fixtures (IMPORTANTE)

O motor do P03 ainda não existe em `main`. **Sem Supabase configurado, a agenda usa `fixturePort.ts`, uma emulação do P03/P05 sobre as fixtures do contrato v1** (`bookingsA`, `services`, `FIXED_NOW`), sempre rotulada na tela: "Dados de exemplo… esta tela ainda não guarda nem altera dados no servidor; as mudanças valem só nesta aba". Nada sai do navegador.

- Complemento local fictício em `demoData.ts` (não está nas fixtures comuns): nomes "Cliente Exemplo Ana/Bruno", expediente seg–sex 09–19 (pausa 12–13) e sáb 09–14, bloqueio qui 22/10 14–16, quatro reservas extras da semana (concluído, falta, cancelado, confirmado), regra de terça à tarde −15% (`rule_version` 3, explica o R$ 51,00 da fixture) e política de cancelamento de exemplo.
- `?simular=conflito` e `?simular=versao` na URL fazem a emulação devolver um 409 uma vez (outro canal ocupa o horário / outro aparelho edita). Só existem na emulação; servem para demonstrar e testar.
- **Com Supabase configurado**, usa `serverPort.ts`: `availability.list`, `pricing.quote` e `booking.create|reschedule|cancel|complete` chamam `POST /functions/v1/<módulo>/<operação>` com envelope validado. **As leituras sem contrato v1** (listar atendimentos, detalhe, serviços, clientes, expediente) lançam `NotConnectedError` e a tela mostra "Ainda não conectado ao servidor", sem dado falso. Ou seja: em homologação a agenda fica vazia até as propostas abaixo e o P03.

## Propostas ao integrador (mudanças globais; não feitas aqui)

1. **Contrato `booking.list`** (P03): `{window: TimeRange, cursor?, limit ≤ 100}` → `{bookings: Booking[], next_cursor}` na visão do dono. Sem isso a agenda real não lista nada. `getBooking` pode ser `booking.get` ou filtro por id.
2. **Leitura de expediente** (P03): `schedule.day_plans {window}` → por dia `open[]`, `pauses[]`, `blocks[{range,label}]` (formato do `DayPlan` em `agenda.ts`). Necessária para ocupação e lacunas livres.
3. **`resource_id` em `ContextResponse`** (piloto: um recurso por negócio). `booking.create`/`availability.list` exigem o recurso; hoje o servidor não o informa ao frontend.
4. **Leituras do P02**: lista de serviços ativos e busca de clientes (id + nome, paginada) para o fluxo de novo agendamento.
5. **Política de cancelamento versionada** no contrato (texto + versão aceita na reserva), para trocar o texto de exemplo.
6. **Operação `booking.no_show`** (marcar/reverter falta com motivo): os estados existem no contrato, a operação não.
7. **ESLint `no-restricted-imports`**: o padrão `../*/*` impede subpastas dentro do próprio módulo (`ui/` → `../domain/`). Por isso a pasta ficou plana. Sugestão: restringir só `**/features/<outro>/**`.
8. **Testes do P00 que citam o placeholder**: `src/app/AppShell.test.tsx` e `tests/e2e/foundation/smoke.spec.ts` esperam "Pacote P04" e "ainda não guarda nem altera dados" em `/app/agenda`. Mantive os dois textos (são verdadeiros enquanto há emulação), mas quando o P03 conectar o integrador deve atualizar essas asserções.
9. Opcional: `@testing-library/user-event` como devDependency (usei `fireEvent`).

Nenhuma migration nem proposta DB (o P04 não cria tabela).

## Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | ok |
| `npm run lint` | ok, 0 avisos |
| `npm run typecheck` | ok |
| `npm run test` (unit + contratos) | unit 52/52 (30 novos do P04), contratos 26/26 |
| `npm run build` | ok (aviso de chunk > 500 kB já conhecido do P00) |
| `npm run test:e2e` | 14/14 (6 do P00 + 8 do P04: 4 cenários × desktop/Pixel 7) |

Cenários cobertos pelos testes do P04: disponibilidade com buffers/pausa/passado; cotação com regra e piso; idempotência (repetição devolve o mesmo; payload diferente → 409); conflito na criação e no reagendamento (reserva antiga permanece); versão desatualizada; cancelamento libera o horário e não duplica; entrada inválida; 404; envelope fora do contrato vira erro; header `Idempotency-Key` fora do corpo; leituras não conectadas; fluxo de tela criar/reagendar/cancelar no mobile; 409 explicado; fuso do navegador diferente do negócio; alvos de 44 px; sem rolagem horizontal.

O e2e encontrou e corrigiu um bug real: "Voltar para a agenda" no detalhe apontava para `/app/agenda/atendimento` (rota inexistente).

**Não executado:** Safari/iOS (só Chromium no ambiente) e qualquer chamada a servidor real (não há P03 nem projeto Supabase de homologação).

## Feature flags

Nenhuma nova. A escolha emulação × servidor segue o P00: sem `VITE_SUPABASE_*` ou em `offline_demo` → emulação rotulada; caso contrário → servidor.

## Limitações conhecidas

- Emulação guarda estado em memória por carregamento de página; recarregar volta às fixtures.
- O relógio da demonstração é fixo (`FIXED_NOW`, terça 20/10/2026 09:00) e a tela diz "data da demonstração".
- Reagendar não lista o próprio horário atual como livre (o contrato `availability.list` não tem "ignorar reserva X"); o servidor decide.
- Sem recorrência semanal, sem criação de bloqueio pela tela e sem reserva provisória (`mode: "hold"`) iniciada pelo dono: ficam para quando o P03 publicar as operações.

## Próximo passo preciso

1. Integrador revisa/mergeia este PR e decide as propostas 1–4 (contratos de leitura) com o P03/P02.
2. Com o P03 em `main`: implementar as leituras no `serverPort.ts` (substituir os `NotConnectedError`), rodar o e2e contra banco real em homologação e só então remover a emulação do caminho com Supabase (mantê-la para demonstração offline).
3. P05/P07 plugam ações de oferta/lista via `SchedulingExtensionsProvider`.
