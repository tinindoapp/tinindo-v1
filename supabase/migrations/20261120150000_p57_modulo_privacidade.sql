-- P57 (D26), recado #137: a tela "Seus dados" (exportar e eliminar) entra no escopo do piloto como módulo `privacy`,
-- nível `pilot` (todo negócio vê; aparece em Conta). Só acrescenta a linha 28 ao catálogo; os 27 anteriores não mudam.
-- O mesmo mapa está em MODULE_LEVELS (@contracts) e em src/features/privacy/module.tsx; tests/contracts/setup compara.
create or replace function app.module_catalog() returns table (module text, level text, ord integer)
language sql immutable set search_path = '' as $$
  select * from (values
    ('scheduling', 'pilot', 1), ('crm', 'pilot', 2), ('finance', 'pilot', 3), ('identity', 'pilot', 4), ('setup', 'pilot', 5),
    ('network', 'pilot', 6), ('lifecycle', 'pilot', 7), ('pricing', 'pilot', 8), ('waitlist', 'pilot', 9), ('agent', 'pilot', 10),
    ('recurrence', 'activation', 11), ('sales', 'activation', 12), ('growth-advice', 'activation', 13),
    ('analytics', 'activation', 14), ('referrals', 'activation', 15), ('service-ops', 'activation', 16),
    ('messaging', 'stored', 17), ('payments', 'stored', 18), ('fiscal', 'stored', 19), ('presence', 'stored', 20),
    ('campaigns', 'stored', 21), ('reputation', 'stored', 22), ('field-service', 'stored', 23), ('discovery', 'stored', 24),
    ('resources', 'stored', 25), ('materials', 'stored', 26), ('finance-advanced', 'stored', 27),
    ('privacy', 'pilot', 28)
  ) as v(module, level, ord)
$$;
