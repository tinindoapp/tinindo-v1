// SQL direto no banco da jornada (PG* vêm de run.sh). Como o `sql()` do harness de integração: só
// para preparar o que a tela não permite e para conferir o que ficou gravado, nunca para o caminho testado.
// (O harness não é importado aqui porque ele monta todas as funções; quem as monta nesta jornada é o gateway.)
import pg from "pg";

export async function sql<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client();
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/**
 * "O tempo passou": leva o agendamento (criado pela tela para um horário futuro) para `daysAgo` dias atrás, ao
 * meio-dia no fuso do negócio. É a única coisa que a tela não consegue fazer e que o ciclo exige: o banco só deixa
 * concluir depois do início (scheduling_booking_complete) e só conta "não volta" depois de 30 dias da visita.
 * Meio-dia local, e não "agora menos N": a conta de dias da tela é por data no fuso do negócio e não muda com a hora.
 */
export async function moveBookingToPast(bookingId: string, daysAgo: number): Promise<void> {
  const rows = await sql(
    `with alvo as (
       select b.id, b.starts_at,
              (((now() at time zone t.timezone)::date - $2::int) + time '12:00') at time zone t.timezone as novo
       from public.bookings b join public.tenants t on t.id = b.tenant_id
       where b.id = $1 and b.status = 'confirmed'
     )
     update public.bookings b
     set starts_at = a.novo,
         ends_at = b.ends_at + (a.novo - a.starts_at),
         occupied_range = tstzrange(lower(b.occupied_range) + (a.novo - a.starts_at), upper(b.occupied_range) + (a.novo - a.starts_at), '[)')
     from alvo a where b.id = a.id
     returning b.id`,
    [bookingId, daysAgo]);
  if (rows.length !== 1) throw new Error(`agendamento ${bookingId} não está confirmado no banco: nada foi movido`);
}
