// Histórico: Recebimentos, Despesas e Pacotes num segmentado de 3 opções, uma lista por vez, cada uma com 5 itens e
// "Ver todos (N)". "Estornar" fica no "⋯" de cada linha e continua pedindo confirmação.
import { useEffect, useRef, useState } from "react";
import type { ExpenseEntry, PackageDetail, PaymentRecord } from "@contracts";
import { Button, CappedList, Section, Segmented, SetupHint } from "../../../components/ui/index.tsx";
import { useCommand } from "../../../lib/idempotency.ts";
import { METHOD_LABEL } from "../../../lib/collect.ts";
import { formatCents, formatDate } from "../money.ts";
import { PackageForm } from "../forms.tsx";
import { CATEGORY_LABEL, explain, ReverseConfirm, Row, usePage, usePort } from "../shared.tsx";

type Tab = "payments" | "expenses" | "packages";
const TAB_TITLE: Record<Tab, string> = { payments: "Recebimentos no mês", expenses: "Despesas", packages: "Pacotes de sessões" };

export function History({ payments, expenses, packages, truncated }: {
  payments: PaymentRecord[];
  expenses: ExpenseEntry[];
  packages: PackageDetail[];
  truncated?: { payments?: boolean; expenses?: boolean };
}) {
  const [tab, setTab] = useState<Tab>("payments");
  const options: readonly { value: Tab; label: string }[] = [
    { value: "payments", label: "Recebimentos" },
    { value: "expenses", label: "Despesas" },
    { value: "packages", label: "Pacotes" },
  ];
  return (
    // Seção secundária (doc 07 regra 5.2): nasce recolhida em uma linha, com a contagem de lançamentos do mês.
    <Section id="fin-hist-title" title="Histórico do mês" count={payments.length + expenses.length} collapsed>
      <Segmented label="Mostrar" hideLabel value={tab} options={options} onChange={setTab} />
      <section aria-labelledby="fin-hist-panel" className="tn-fin-panel">
        <h3 id="fin-hist-panel" className="tn-visually-hidden">{TAB_TITLE[tab]}</h3>
        {tab === "payments" ? (
          <Payments list={payments} truncated={truncated?.payments} />
        ) : tab === "expenses" ? (
          <Expenses list={expenses} truncated={truncated?.expenses} />
        ) : (
          <Packages list={packages} />
        )}
      </section>
    </Section>
  );
}

function Payments({ list, truncated }: { list: PaymentRecord[]; truncated?: boolean }) {
  const ctx = usePage();
  const port = usePort();
  const command = useCommand();
  const [reversing, setReversing] = useState<string | null>(null);
  const recent = [...list].sort((a, b) => b.received_at.localeCompare(a.received_at));
  const reverse = (p: PaymentRecord) => async (reason: string) => {
    try {
      await command({ reversePayment: p.id, reason }, (key) => port.reversePayment({ payment_id: p.id, reason }, key));
      ctx.notify("success", `Recebimento de ${formatCents(p.amount_cents)} estornado. O registro original continua no histórico.`);
    } catch (err) {
      ctx.notify("danger", explain(err));
    } finally {
      ctx.reload();
    }
  };
  if (list.length === 0) {
    return (
      <>
        <p className="tn-muted">Nenhum recebimento registrado.</p>
        <SetupHint to="/app/agenda" action="Abrir a agenda">
          Ainda não configurado: conclua um atendimento na Agenda e registre aqui o que recebeu. O Caixa passa a mostrar o que entrou e o que falta cobrar.
        </SetupHint>
      </>
    );
  }
  return (
    <CappedList
      plain
      items={recent}
      label="Recebimentos no mês"
      truncated={truncated}
      render={(p) => {
        const what = `recebimento de ${formatCents(p.amount_cents)}`;
        const when = formatDate(p.received_at, ctx.base.timezone);
        return (
          <Row
            key={p.id}
            title={ctx.customerName(p.customer_id)}
            value={p.reversal_of ? `−${formatCents(p.amount_cents)}` : formatCents(p.amount_cents)}
            meta={`${p.reversal_of ? "Estorno · " : ""}${METHOD_LABEL[p.method]} · ${when} · manual${p.reversed ? " · estornado" : ""}`}
            more={!p.reversal_of && !p.reversed ? [{ label: "Estornar", onSelect: () => setReversing(p.id) }] : undefined}
            moreLabel={`Mais ações · ${what} de ${when}`}
            below={reversing === p.id ? (
              <ReverseConfirm label={what} onReverse={reverse(p)} onClose={() => setReversing(null)}
                consequence={`Sai ${formatCents(p.amount_cents)} do recebido no mês. O registro original continua no histórico.`} />
            ) : null}
          />
        );
      }}
    />
  );
}

function Expenses({ list, truncated }: { list: ExpenseEntry[]; truncated?: boolean }) {
  const ctx = usePage();
  const port = usePort();
  const command = useCommand();
  const [reversing, setReversing] = useState<string | null>(null);
  const recent = [...list].sort((a, b) => b.paid_at.localeCompare(a.paid_at));
  const reverse = (id: string) => async () => {
    try {
      await command({ reverseExpense: id }, (key) => port.reverseExpense({ expense_id: id }, key));
      ctx.notify("success", "Despesa estornada. O registro original continua no histórico.");
    } catch (err) {
      ctx.notify("danger", explain(err));
    } finally {
      ctx.reload();
    }
  };
  if (list.length === 0) return <p className="tn-muted">Nenhuma despesa no mês.</p>;
  return (
    <CappedList
      plain
      items={recent}
      label="Despesas"
      truncated={truncated}
      render={(x) => {
        const what = `despesa de ${formatCents(x.amount_cents)}`;
        const when = formatDate(x.paid_at, ctx.base.timezone);
        return (
          <Row
            key={x.id}
            title={x.description ? `${CATEGORY_LABEL[x.category]} · ${x.description}` : CATEGORY_LABEL[x.category]}
            value={x.reversal_of ? `−${formatCents(x.amount_cents)}` : formatCents(x.amount_cents)}
            meta={`${x.reversal_of ? "Estorno · " : ""}${when}${x.reversed ? " · estornada" : ""}`}
            more={!x.reversal_of && !x.reversed ? [{ label: "Estornar", onSelect: () => setReversing(x.id) }] : undefined}
            moreLabel={`Mais ações · ${what} de ${when}`}
            below={reversing === x.id ? (
              // O contrato do estorno de despesa não guarda motivo: confirma sem pedir um texto que seria descartado.
              <ReverseConfirm label={what} withReason={false} onReverse={reverse(x.id)} onClose={() => setReversing(null)}
                consequence={`Sai ${formatCents(x.amount_cents)} do gasto no mês. O registro original continua no histórico.`} />
            ) : null}
          />
        );
      }}
    />
  );
}

function Packages({ list }: { list: PackageDetail[] }) {
  const ctx = usePage();
  const port = usePort();
  const command = useCommand();
  const [selling, setSelling] = useState(false);
  const [reversing, setReversing] = useState<string | null>(null);
  const formBox = useRef<HTMLDivElement>(null);
  // Abre no lugar e leva o foco ao primeiro campo.
  useEffect(() => {
    if (selling) formBox.current?.querySelector<HTMLElement>("select, input")?.focus();
  }, [selling]);

  const reverse = (entryId: string) => async (reason: string) => {
    try {
      await command({ reversePackage: entryId, reason }, (key) => port.reversePackage({ entry_id: entryId, reason }, key));
      ctx.notify("success", "Crédito devolvido ao pacote. O débito original continua no histórico.");
    } catch (err) {
      ctx.notify("danger", explain(err));
    } finally {
      ctx.reload();
    }
  };
  const date = (iso: string) => formatDate(iso, ctx.base.timezone);

  return (
    <>
      <p className="tn-muted tn-fin-note">Vender o pacote gera um único valor a receber. Usar uma sessão debita crédito, não gera caixa.</p>
      {selling ? (
        <div ref={formBox} className="tn-card tn-stack">
          <PackageForm onDone={() => setSelling(false)} />
          <div className="tn-actions">
            <Button variant="ghost" onClick={() => setSelling(false)}>Fechar</Button>
          </div>
        </div>
      ) : (
        <div className="tn-actions">
          <Button size="compact" variant="secondary" onClick={() => setSelling(true)}>Vender pacote</Button>
        </div>
      )}
      {list.length === 0 ? (
        <p className="tn-muted">Nenhum pacote vendido.</p>
      ) : (
        <CappedList
          plain
          items={list}
          label="Pacotes de sessões"
          render={(p) => {
            const name = `${ctx.serviceName(p.service_id)} · ${ctx.customerName(p.customer_id)}`;
            const seen = new Map<string, number>();
            const more = p.entries
              .filter((e) => e.reason === "consume" && !e.reversed)
              .map((e) => {
                const base = `Estornar sessão usada em ${date(e.created_at)}`;
                const n = (seen.get(base) ?? 0) + 1;
                seen.set(base, n);
                return { label: n > 1 ? `${base} (${n})` : base, onSelect: () => setReversing(e.id) };
              });
            const open = p.entries.find((e) => e.id === reversing);
            return (
              <Row
                key={p.package_id}
                title={name}
                meta={
                  <>
                    Saldo: {p.remaining_credits} {p.remaining_credits === 1 ? "sessão" : "sessões"} de {p.purchased_credits} · {formatCents(p.total_price_cents)} contratado
                    {p.expires_at ? ` · válido até ${date(p.expires_at)}` : ""}
                    {p.entries.length ? (
                      <span className="tn-fin-entries">
                        {p.entries.map((e) => `${e.reason === "consume" ? "Sessão usada (−1)" : "Crédito devolvido (+1)"} em ${date(e.created_at)}${e.reversed ? ", estornado" : ""}`).join(" · ")}
                      </span>
                    ) : null}
                  </>
                }
                more={more}
                moreLabel={`Mais ações · pacote ${name}`}
                below={open ? (
                  <ReverseConfirm label={`sessão usada em ${date(open.created_at)}`} onReverse={reverse(open.id)} onClose={() => setReversing(null)}
                    consequence="A sessão volta ao saldo do pacote. O registro original continua no histórico." />
                ) : null}
              />
            );
          }}
        />
      )}
    </>
  );
}
