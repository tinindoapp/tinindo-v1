-- Preparo do "negócio técnico" no banco descartável de tests/e2e-staging/local.sh (aplicado por run.sh depois do
-- seed, via E2E_SERVIDOR_PREPARO). Só dado sintético do seed: o negócio técnico local é a Barbearia Exemplo A
-- (dono.a@exemplo.test). Espelha as pré-condições da homologação descritas no README desta pasta:
--   1. expediente que cobre a hora em que a jornada roda (aqui, os sete dias, das 00:00 às 23:59);
--   2. perfil publicado com o link de reserva (slug abaixo = STAGING_PUBLIC_SLUG do local.sh);
--   3. Mensagens ligado, como quem opera a homologação faz com app.module_admin_set (P51 deixou Mensagens guardado).
-- O número simulado NÃO é conectado aqui: a jornada conecta pela tela (Mensagens › Conectar número).

insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
select '10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000a', d, time '00:00', time '23:59'
from generate_series(0, 6) d;

insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
values ('10000000-0000-4000-8000-00000000000a', 'tecnico-uat-local', 'barber', 'Bairro Exemplo',
        array['area', 'display_name', 'booking_link'], now());

select app.module_admin_set('10000000-0000-4000-8000-00000000000a', 'messaging', true);
