-- Recado #115 (P50) · Porquê do passo "Definir a antecedência para cancelar" no catálogo do servidor.
-- O P50 trocou o texto na tela de Configuração, no cartão da Home e no guia do Assistente; o catálogo comum
-- (src/lib/setup/steps.ts) e app.setup_steps() guardavam o antigo, e as telas sobrepunham pelo código do passo.
-- Só o texto `why` de cancellation_policy muda: mesma assinatura, mesmos passos, mesma ordem e obrigatoriedade.
-- `create or replace` mantém as permissões revogadas na P44.

create or replace function app.setup_steps() returns table (step text, ord integer, required boolean, title text, why text, link text)
language sql immutable set search_path = '' as $$
  select * from (values
    ('hours', 1, true, 'Definir seus horários de atendimento',
      'Sem expediente, o link público não mostra horários e ninguém consegue reservar.', '/app/agenda/horarios'),
    ('service', 2, true, 'Cadastrar um serviço com duração e preço',
      'O cliente escolhe o serviço no link: a duração vira o horário e o preço vira o valor combinado.', '/app/clientes/servicos'),
    ('cancellation_policy', 3, true, 'Definir a antecedência para cancelar',
      'Você define até quantas horas antes o cliente cancela sem custo. É a regra que o link público mostra a quem vai reservar.', '/app/conta'),
    ('profile', 4, true, 'Publicar seu perfil e mandar o link',
      'O link público é como o cliente reserva com você. Sem ele, só por mensagem.', '/app/perfil'),
    ('first_customer', 5, false, 'Cadastrar seu primeiro cliente',
      'Com o cliente na lista, o atendimento já sai com nome e WhatsApp.', '/app/clientes'),
    ('photo_whatsapp', 6, false, 'Pôr foto e WhatsApp no perfil',
      'Foto e WhatsApp passam confiança a quem chega pelo link.', '/app/perfil'),
    ('channel', 7, false, 'Conectar e verificar seu número',
      'Com o número verificado, o código da reserva pelo link e os lembretes saem pelo canal.', '/app/mensagens'),
    ('first_cash', 8, false, 'Registrar o primeiro recebimento',
      'O Caixa mostra o que entrou e o que falta cobrar a partir do primeiro registro.', '/app/caixa')
  ) as v(step, ord, required, title, why, link)
$$;
