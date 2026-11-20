// O que pede ação: atendimentos concluídos sem cobrança (cobrar em um toque) e cobranças em aberto ("A receber").
// Uma linha por registro, uma ação visível e compacta; o resto no "⋯".
import { type FormEvent, useState } from "react";
import type { PackageDetail, Receivable, UnchargedBooking } from "@contracts";
import { Button, Field, ListCutNote, type MenuAction, Segmented, StatusBanner, useFormErrors } from "../../../components/ui/index.tsx";
import "../../../components/ui/collect.css";
import { useAttemptValue, useCommand, useIdempotencyKey } from "../../../lib/idempotency.ts";
import { METHOD_LABEL, METHOD_PHRASE, METHODS, type Method, useCollectBooking } from "../../../lib/collect.ts";
import { plural } from "../../../lib/text/plural.ts";
import { centsToInput, formatCents, formatDate, noonOfLocalDay, parseBRL } from "../money.ts";
import { type Ctx, explain, FinSection, InlineConfirm, MethodField, Row, STATUS_LABEL, useFocusHandoff, usePage, usePort } from "../shared.tsx";

const METHOD_OPTIONS = METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }));

export function Uncharged({ list, packages }: { list: UnchargedBooking[]; packages: PackageDetail[] }) {
  const ctx = usePage();
  return (
    <FinSection id="fin-unch-title" title="Atendimentos concluídos sem cobrança" count={list.length}>
      {list.length === 0 ? (
        <p className="tn-muted">Nenhum atendimento concluído esperando cobrança.</p>
      ) : (
        <ul className="tn-list" data-plain aria-label="Sem cobrança">
          {list.map((b) => (
            <UnchargedItem key={b.booking_id} b={b} packages={packages.filter((p) => b.package_ids.includes(p.package_id))} ctx={ctx} />
          ))}
        </ul>
      )}
    </FinSection>
  );
}

/**
 * Atendimento concluído sem cobrança. Visível: "Recebi R$ 60,00 no Pix ▾" (a cobrança em um toque; ▾ troca a forma antes
 * de tocar). No "⋯": "Cobrar depois" e "Usar crédito do pacote (N restantes)". Sem valor, o crédito é a ação visível.
 */
function UnchargedItem({ b, packages, ctx }: { b: UnchargedBooking; packages: PackageDetail[]; ctx: Ctx }) {
  const port = usePort();
  const itemRef = useFocusHandoff("fin-unch-title");
  // Atalho compartilhado com a Agenda e a Hoje (src/lib/collect.ts): uma chave por registro, então repetir depois de
  // falha reaproveita a cobrança já criada e não duplica nada.
  const collect = useCollectBooking(port, b.booking_id);
  // Qual ação está rodando: o carregando aparece só no botão tocado; os outros esperam.
  const [pending, setPending] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("pix");
  const [choosing, setChoosing] = useState(false);
  const label = `${ctx.serviceName(b.service_id)} · ${ctx.customerName(b.customer_id)}`;
  const busy = pending !== null;
  const amount = b.agreed_price_cents;

  async function run(which: string, action: () => Promise<string>) {
    setPending(which);
    try {
      ctx.notify("success", await action());
    } catch (err) {
      ctx.notify("danger", explain(err));
    } finally {
      setPending(null);
      ctx.reload();
    }
  }

  // Cobrança e recebimento são dois registros. Se o segundo falhar, a cobrança fica em aberto e visível.
  const markPaid = () =>
    run("paid", async () => {
      const r = await collect.receive(method);
      return `Recebido ${formatCents(r.amount_cents)} (${METHOD_LABEL[method]}) de ${label}. Registro manual.`;
    });
  const chargeLater = () =>
    run("later", async () => {
      const r = await collect.later();
      return `Cobrança de ${formatCents(r.amount_cents)} criada. Fica em "A receber" até registrar o recebimento.`;
    });
  const consumeCredit = (pkgId: string) =>
    run(pkgId, async () => {
      const bal = await collect.consumeCredit(pkgId, b.completed_event_id);
      return `Crédito usado. Saldo: ${bal.remaining_credits} ${bal.remaining_credits === 1 ? "sessão" : "sessões"}. Nenhum valor novo entra no caixa.`;
    });

  const creditText = (p: PackageDetail) => `Usar crédito do pacote (${plural(p.remaining_credits, "restante")})`;
  const credits: MenuAction[] = packages.map((p) => ({ label: creditText(p), disabled: busy, onSelect: () => void consumeCredit(p.package_id) }));
  let action;
  let more: MenuAction[];
  if (amount) {
    action = (
      <span className="tn-split">
        <Button size="compact" variant="secondary" loading={pending === "paid"} disabled={busy} onClick={() => void markPaid()}>
          <span>Recebi <span className="tn-num">{formatCents(amount)}</span> {METHOD_PHRASE[method]}<span className="tn-visually-hidden"> · {label}</span></span>
        </Button>
        <Button size="compact" variant="secondary" aria-expanded={choosing} aria-controls={`m-${b.booking_id}-methods`}
          aria-label={`Outra forma de pagamento · ${label}`} title="Outra forma de pagamento" disabled={busy} onClick={() => setChoosing((c) => !c)}>
          <span aria-hidden="true">▾</span>
        </Button>
      </span>
    );
    more = [{ label: "Cobrar depois", disabled: busy, onSelect: () => void chargeLater() }, ...credits];
  } else {
    const first = packages[0];
    action = first ? (
      <Button size="compact" variant="secondary" loading={pending === first.package_id} disabled={busy} onClick={() => void consumeCredit(first.package_id)}>
        {creditText(first)}<span className="tn-visually-hidden"> · {label}</span>
      </Button>
    ) : undefined;
    more = credits.slice(1);
  }

  return (
    <Row
      liRef={itemRef}
      id={`fin-b-${b.booking_id}`}
      focus={ctx.focusBooking === b.booking_id}
      stack
      title={label}
      meta={formatDate(b.starts_at, ctx.base.timezone)}
      action={action}
      more={more}
      moreLabel={`Mais ações · ${label}`}
      below={choosing ? (
        <div id={`m-${b.booking_id}-methods`} className="tn-collect__methods">
          <Segmented label={`Forma de pagamento · ${label}`} hideLabel value={method} options={METHOD_OPTIONS} onChange={setMethod} />
        </div>
      ) : null}
    />
  );
}

export function Receivables({ list, truncated }: { list: Receivable[]; truncated?: boolean }) {
  const ctx = usePage();
  return (
    <FinSection id="fin-rec-title" title="A receber" count={list.length}>
      {list.length === 0 ? (
        <p className="tn-muted">Nada em aberto.</p>
      ) : (
        <ul className="tn-list" data-plain aria-label="Cobranças em aberto">
          {list.map((r) => (
            <ReceivableItem key={r.id} r={r} ctx={ctx} />
          ))}
        </ul>
      )}
      {/* P56 (D31 a): o servidor devolve no máximo 200 por lista; quando cortou, a tela avisa em vez de parecer completa. */}
      {truncated ? <ListCutNote /> : null}
    </FinSection>
  );
}

function ReceivableItem({ r, ctx }: { r: Receivable; ctx: Ctx }) {
  const port = usePort();
  const itemRef = useFocusHandoff("fin-rec-title");
  const { keyFor, reset: resetKey } = useIdempotencyKey();
  // "Agora" entra no pedido. Na nova tentativa precisa ser o mesmo instante: com outro, a chave mudaria
  // e o recebimento seria gravado duas vezes.
  const instant = useAttemptValue<string>();
  const command = useCommand();
  // Vindo da Agenda com `?atendimento=<id>` já cobrado: o recebimento dessa cobrança abre direto.
  const [open, setOpen] = useState(() => !!r.booking_id && r.booking_id === ctx.focusBooking);
  const [cancelling, setCancelling] = useState(false);
  const [amount, setAmount] = useState(centsToInput(r.open_cents));
  const [method, setMethod] = useState<Method>("pix");
  const [date, setDate] = useState(ctx.today);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"amount">();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cents = parseBRL(amount);
    const amountError = !cents
      ? "Informe o valor recebido."
      : cents > r.open_cents
        ? `O valor passa do que falta receber (${formatCents(r.open_cents)}).`
        : null;
    if (!show({ amount: amountError }) || !cents) return;
    const received_at = date === ctx.today
      ? instant.valueFor({ receivable_id: r.id, cents, method, date }, () => port.now().toISOString())
      : noonOfLocalDay(date, ctx.base.timezone);
    const payload = { receivable_id: r.id, amount_cents: cents, method, received_at };
    setPending(true);
    setError(null);
    try {
      await port.recordPayment(payload, keyFor(payload));
      resetKey();
      instant.reset();
      ctx.notify("success", `Recebimento de ${formatCents(cents)} registrado (${METHOD_LABEL[method]}, manual).`);
      ctx.reload();
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  async function cancel() {
    try {
      await command({ cancel: r.id, version: r.version }, (key) => port.cancelReceivable({ receivable_id: r.id, expected_version: r.version }, key));
      ctx.notify("success", "Cobrança cancelada.");
    } catch (err) {
      ctx.notify("danger", explain(err));
    } finally {
      ctx.reload();
    }
  }

  const who = ctx.customerName(r.customer_id);
  const canCancel = r.status === "open" && !r.package_id;
  return (
    <Row
      liRef={itemRef}
      booking={r.booking_id}
      focus={!!r.booking_id && r.booking_id === ctx.focusBooking}
      wrap
      title={r.description}
      meta={
        <>
          {who} · Falta {formatCents(r.open_cents)} de {formatCents(r.amount_cents)}
          {r.status === "open" ? "" : ` · ${STATUS_LABEL[r.status]}`}
          {r.due_at ? ` · vence ${formatDate(r.due_at, ctx.base.timezone)}` : ""}
        </>
      }
      action={open ? undefined : (
        <Button size="compact" variant="secondary" onClick={() => setOpen(true)}>
          Registrar recebimento<span className="tn-visually-hidden"> de {r.description}</span>
        </Button>
      )}
      more={canCancel ? [{ label: "Cancelar cobrança", tone: "danger", onSelect: () => setCancelling(true) }] : undefined}
      moreLabel={`Mais ações · ${r.description}`}
      below={
        open || cancelling ? (
          <>
            {open ? (
              <form ref={formRef} className="tn-fin-form" onSubmit={(e) => void submit(e)} noValidate aria-label={`Recebimento de ${r.description}`}>
                <Field label="Valor recebido (R$)" id={`a-${r.id}`} inputMode="decimal" value={amount} error={errors.amount} onChange={(e) => setAmount(e.target.value)} />
                <MethodField id={`m-${r.id}`} value={method} onChange={setMethod} />
                <Field label="Data" id={`d-${r.id}`} type="date" max={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} />
                {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
                <div className="tn-actions">
                  <Button type="submit" loading={pending}>Registrar pagamento</Button>
                  <Button variant="ghost" onClick={() => setOpen(false)}>Fechar</Button>
                </div>
              </form>
            ) : null}
            {cancelling ? (
              <InlineConfirm
                title="Cancelar cobrança?"
                consequence={`${r.description} (${formatCents(r.amount_cents)}) sai de "A receber". Para cobrar de novo, crie outra cobrança.`}
                confirmLabel="Sim, cancelar"
                onConfirm={cancel}
                onClose={() => setCancelling(false)}
              />
            ) : null}
          </>
        ) : null
      }
    />
  );
}
