// Aba Retorno (P49, decisão D2 b): o que fazer para o cliente voltar, em três blocos, nesta ordem.
// 1. Lembretes a mandar: confirmações e lembretes sem canal, com o texto pronto e "Mandar no WhatsApp" (wa.me). Abrir o
//    WhatsApp marca o passo como compartilhado por você; compartilhar não quer dizer que chegou.
// 2. Quem não volta: sem visita há 30 dias ou mais e sem horário marcado, com a última visita e "Chamar no WhatsApp".
// 3. Lista de espera: resumo e o caminho para a tela que já existe.
// A Tinindo não envia nada daqui: os links abrem o WhatsApp do dono.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Help, PageHeader, Section, StatusBanner, toast, whatsappHref } from "../../components/ui/index.tsx";
import { whatsappHref as chatHref } from "../../lib/phone.ts";
import { plural } from "../../lib/text/plural.ts";
import { agoText, daysSince, isLapsed, LAPSED_DAYS } from "../../lib/visits.ts";
import { explain, formatDate, formatDateTime } from "./labels.ts";
import { type LifecyclePort, type LifecycleStep, newKey } from "./port.ts";
import type { ReturnBoard, ReturnContact, ReturnSource } from "./retorno.ts";

/** Quantos itens cada bloco mostra antes do "Ver todos". */
const SHOW = 5;
const REMINDER_RULES = new Set<LifecycleStep["rule"]>(["confirmation", "reminder"]);
const RULE_SHORT: Partial<Record<LifecycleStep["rule"], string>> = { confirmation: "Confirmação", reminder: "Lembrete" };

type Load<T> = { data: T | null; error: unknown };

/** Leitura com recarga; `run` deve ser estável (useCallback). Falha depois de ter dados mantém os dados. */
function useLoad<T>(run: () => Promise<T>): Load<T> & { reload: () => void } {
  const [state, setState] = useState<Load<T>>({ data: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    run().then((data) => alive && setState({ data, error: null }), (error: unknown) => alive && setState((s) => ({ data: s.data, error: error ?? new Error("erro") })));
    return () => {
      alive = false;
    };
  }, [run, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

export function RetornoPage({ port, source }: { port: LifecyclePort; source: ReturnSource }) {
  const steps = useLoad(useCallback(async () => (await port.steps("manual")).steps.filter((s) => REMINDER_RULES.has(s.rule)), [port]));
  const board = useLoad(useCallback(() => source.board(), [source]));
  const contacts = new Map((board.data?.customers ?? []).map((c) => [c.id, c]));

  return (
    <div className="tn-stack">
      <div className="tn-page-intro">
        <PageHeader id="rt-title" title="Retorno" subtitle="Quem avisar, quem chamar de volta e quem espera vaga." />
        <Help>
          <p>
            Os textos abrem no seu WhatsApp para você revisar e mandar. A Tinindo não envia nada daqui, e abrir o WhatsApp não confirma que a
            mensagem chegou. As réguas de confirmação e lembrete ficam em <Link to="/app/relacionamento">Relacionamento</Link>.
          </p>
        </Help>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Clientes e textos de exemplo; nada é enviado.</StatusBanner> : null}
      </div>
      <Reminders load={steps} contacts={contacts} board={board.data} port={port} onShared={steps.reload} />
      <Lapsed load={board} />
      <Waitlist load={board} />
    </div>
  );
}

function Reminders({ load, contacts, board, port, onShared }: { load: Load<LifecycleStep[]>; contacts: Map<string, ReturnContact>; board: ReturnBoard | null; port: LifecyclePort; onShared: () => void }) {
  // Uma chave por passo: dois toques seguidos marcam uma vez só (ADR-0002).
  const keys = useRef(new Map<string, string>());
  const keyFor = (id: string) => keys.current.get(id) ?? keys.current.set(id, newKey()).get(id)!;
  const timezone = board?.timezone ?? "America/Sao_Paulo";
  const items = load.data ?? [];
  function shared(step: LifecycleStep) {
    port.markShared(step.id, keyFor(step.id)).then(
      () => {
        toast("WhatsApp aberto com o texto. Marcado como compartilhado por você; compartilhar não confirma que chegou.");
        onShared();
      },
      (e: unknown) => toast({ tone: "danger", message: explain(e) }),
    );
  }
  return (
    <Section id="rt-reminders" title="Lembretes a mandar" action={items.length > SHOW ? <Link to="/app/relacionamento">Ver todos ({items.length})</Link> : undefined}>
      {load.error ? <StatusBanner tone="danger">{explain(load.error)}</StatusBanner> : null}
      {!load.data && !load.error ? <p role="status" className="tn-muted">Carregando lembretes…</p> : null}
      {load.data && items.length === 0 ? <p className="tn-muted">Nenhum lembrete esperando você: as confirmações e os lembretes sem canal aparecem aqui com o texto pronto.</p> : null}
      {items.length > 0 ? (
        <ul className="tn-rt-list" aria-label="Lembretes a mandar">
          {items.slice(0, SHOW).map((s) => {
            const who = s.customer_name ?? "Cliente";
            const phone = s.customer_id ? (contacts.get(s.customer_id)?.phone ?? null) : null;
            return (
              <li key={s.id} className="tn-rt-item">
                <h3>{RULE_SHORT[s.rule]} · {who}</h3>
                <p className="tn-muted">Para você compartilhar · previsto {formatDateTime(s.due_at, timezone)}</p>
                <span className="tn-lc-body">{s.body}</span>
                <div className="tn-actions">
                  <a className="tn-button" data-variant="primary" href={whatsappHref(phone, s.body)} target="_blank" rel="noopener noreferrer" aria-label={`Mandar no WhatsApp para ${who}`} onClick={() => shared(s)}>
                    Mandar no WhatsApp
                  </a>
                </div>
                {phone ? null : <p className="tn-muted">Sem WhatsApp no cadastro: o WhatsApp abre e pede o contato.</p>}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}

function Lapsed({ load }: { load: Load<ReturnBoard> }) {
  const b = load.data;
  const now = b ? new Date(b.now) : null;
  const lapsed =
    b && now
      ? b.customers
          .filter((c) => isLapsed(b.visits.byCustomer[c.id], now, b.timezone))
          .map((c) => ({ ...c, last: b.visits.byCustomer[c.id]!.last_visit_at!, days: daysSince(b.visits.byCustomer[c.id]!.last_visit_at!, now, b.timezone) }))
          // Quem sumiu há menos tempo primeiro: é quem mais fácil volta.
          .sort((x, y) => x.days - y.days)
      : [];
  return (
    <Section
      id="rt-lapsed"
      title="Quem não volta"
      action={lapsed.length > SHOW ? <Link to="/app/clientes?filtro=sem-voltar">Ver todos ({lapsed.length})</Link> : undefined}
    >
      <p className="tn-muted">Sem visita há {LAPSED_DAYS} dias ou mais e sem horário marcado (agenda dos últimos 6 meses).</p>
      {load.error && !b ? <StatusBanner tone="danger">Não deu para ler a agenda agora. Tentar de novo é seguro.</StatusBanner> : null}
      {!b && !load.error ? <p role="status" className="tn-muted">Carregando clientes…</p> : null}
      {b && lapsed.length === 0 ? <p className="tn-muted">Ninguém sumido: quem veio nos últimos 6 meses voltou há menos de {LAPSED_DAYS} dias ou já tem horário marcado.</p> : null}
      {b && !b.visits.complete ? <StatusBanner tone="warning">A agenda tem mais atendimentos do que esta leitura alcança; a lista pode estar incompleta.</StatusBanner> : null}
      {lapsed.length > 0 ? (
        <ul className="tn-rt-list" aria-label="Quem não volta">
          {lapsed.slice(0, SHOW).map((c) => {
            // Abre a conversa sem texto pronto: chamar de volta é conversa sua, não campanha (essa pede consentimento).
            const wa = chatHref(c.phone);
            return (
              <li key={c.id} className="tn-rt-item tn-rt-row">
                <div className="tn-rt-row__main">
                  <Link to={`/app/clientes/${c.id}`} className="tn-rt-row__name">{c.name}</Link>
                  <span className="tn-muted tn-num">Última visita {agoText(c.days)} · {formatDate(c.last, b!.timezone)}</span>
                </div>
                {wa ? (
                  <a className="tn-button" data-variant="secondary" href={wa} target="_blank" rel="noopener noreferrer" aria-label={`Chamar ${c.name} no WhatsApp`}>
                    Chamar no WhatsApp
                  </a>
                ) : (
                  <span className="tn-muted">Sem WhatsApp no cadastro</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}

function Waitlist({ load }: { load: Load<ReturnBoard> }) {
  const w = load.data?.waitlist ?? null;
  return (
    <Section id="rt-waitlist" title="Lista de espera">
      {!load.data && !load.error ? <p role="status" className="tn-muted">Carregando lista de espera…</p> : null}
      {load.data || load.error ? (
        w === null ? (
          <p className="tn-muted">Quem pediu para ser avisado de vaga fica na lista de espera. Quando um horário é cancelado, ofereça a vaga por lá.</p>
        ) : w.waiting === 0 ? (
          <p className="tn-muted">Ninguém na lista de espera agora.</p>
        ) : (
          <p>
            {plural(w.waiting, "pessoa esperando vaga", "pessoas esperando vaga")}
            {w.openSlots > 0 ? ` · ${plural(w.openSlots, "vaga liberada para oferecer", "vagas liberadas para oferecer")}` : ""}
          </p>
        )
      ) : null}
      <div className="tn-actions">
        <Link className="tn-button" data-variant="secondary" to="/app/lista-de-espera">Abrir a lista de espera</Link>
      </div>
    </Section>
  );
}
