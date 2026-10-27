# ADR-0031 · Equipes e recursos (P28)

Status: aceita · 2026-10-27 · integrador (sessão `claude-int-p28`, pedido do dono: "decida pelos docs")

## Contexto

O piloto é de profissionais sozinhos: o P03 tem **um recurso ativo por negócio** (`resources_one_active_per_tenant`) e a constraint de exclusão de `bookings` serializa a agenda inteira. Várias funções já em produção leem "o recurso ativo" com `select … where active` (P03 `scheduling_settings`/`day_plans`/`public_slots`, P11, P13, P18, P43). O P28 pede vários profissionais, salas, cadeiras, turmas e comissões, com o aceite "reserva composta não deixa recursos parcialmente comprometidos". A homologação está em uso no piloto de 28/10.

## Decisões

1. **Subsistema aditivo `team_*`, sem mexer no motor solo.** Relaxar o índice de um recurso ativo e reescrever as seis funções que leem "o recurso ativo" mudaria comportamento do piloto em véspera de uso. A equipe vive em tabelas próprias: `team_resources` (profissional, sala, cadeira, equipamento), `team_bookings`, `team_classes`, `team_class_seats`, `team_allocations`, `team_commission_rules`, `team_commission_entries`. Nenhuma função existente foi substituída.
2. **Reserva composta = reserva + alocações na mesma transação.** `team_allocations` tem `EXCLUDE (tenant_id =, resource_id =, occupied_range &&) WHERE active`, a autoridade final por recurso. A RPC grava a reserva e depois cada alocação; o primeiro conflito levanta `SLOT_CONFLICT` e desfaz a transação inteira (reserva e alocações anteriores). O campo do erro diz o tipo do recurso ocupado (`professional`, `room`, `chair`, `equipment`, `agenda`, `hours`), sem expor quem ocupa.
3. **Sem deadlock.** Os recursos pedidos são travados com `FOR UPDATE` em ordem de id; a agenda individual vinculada (P03) é travada depois, sempre na mesma ordem. O teste de concorrência manda os mesmos recursos em ordens diferentes.
4. **Agenda individual do dono, nos dois sentidos.** Um profissional da equipe pode ser vinculado ao recurso do P03 (`agenda_resource_id`, um vínculo por negócio). A alocação confere reservas e bloqueios daquela agenda sob o lock do P03; gatilhos `BEFORE INSERT OR UPDATE` em `bookings` e `availability_blocks` recusam (`SLOT_CONFLICT`, campo `team`) o que cruzar uma alocação ativa. Os gatilhos só olham alocações de profissionais vinculados: sem P28 em uso, não mudam nada.
5. **Horário de funcionamento = expediente da agenda principal.** Recursos da equipe não têm expediente próprio nesta versão; a reserva precisa caber no expediente da tela Horários. Expediente por profissional fica para quando houver demanda.
6. **Preço e comissão congelados na reserva.** O preço é o base do serviço no momento (como o P03 antes da cotação); a comissão vem da regra do serviço, senão do padrão do profissional, senão zero, e não muda se a regra mudar depois. Cotação (P05) na reserva da equipe fica para depois.
7. **Concluir não é receber; comissão uma vez.** Concluir uma reserva cria o recebível no Caixa (P07) pelo preço combinado e um lançamento de comissão; índice único por reserva/turma impede o segundo. Estorno é linha nova (`reversal_of` único), append-only. Arredondamento: centavo mais próximo, metade para cima. A comissão é informação para o dono pagar; pagamento ao profissional (contas a pagar) é do P31.
8. **Turmas.** Uma turma aloca profissional e sala juntos (mesma regra da reserva). Vagas: lotação conferida sob lock da turma; uma vaga viva por cliente. Concluir: presentes geram recebível por vaga, ausentes viram falta, comissão sobre as presenças.
9. **Acesso só do dono.** Todas as RPCs exigem papel `owner` (como P20). Login de profissional da equipe (`staff`) e visão "minha agenda" ficam para quando o papel `staff` tiver produto definido. RLS só do dono; motivo de cancelamento fora da leitura direta e da auditoria.
10. **Sem eventos novos.** Reservas da equipe não emitem `booking.*`: o P13 (lembretes) e o P07 (concluídos sem cobrança) continuam só sobre a agenda individual. Quando a equipe precisar de lembretes, um evento `team.booking.*.v1` entra com consumidor definido.

## Consequências

- O motor solo e o piloto ficam intactos; a equipe é opcional e fica no menu Negócio → Equipe.
- Duas agendas convivem: a individual (P03, com link público, lista de espera, cotação) e a da equipe. Unificar exige migrar o P03 para vários recursos e revisar as seis funções citadas; esta ADR deixa o caminho aberto (o vínculo `agenda_resource_id` já liga as duas).
- Link público (P43) e assistente (P08) não reservam na equipe nesta versão.
