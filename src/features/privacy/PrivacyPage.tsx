// Privacidade (P57, D26): o dono baixa os dados do negócio ou de um cliente, elimina um cliente a pedido dele e pede
// a eliminação do negócio com carência de 7 dias, cancelável. O que a tela promete é o que o banco garante: só o dono
// faz, a exportação vale 24 h e o link 15 minutos, eliminar é anonimizar (valores e documentos fiscais ficam).
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSession } from "../../app/session.tsx";
import { Button, Card, ConfirmAction, Field, PageHeader, StatusBanner, toast } from "../../components/ui/index.tsx";
import { explainError } from "../../lib/errors.ts";
import { useCommand } from "../../lib/idempotency.ts";
import { formatDateTime } from "../../lib/time.ts";
import type { CustomerOption, PrivacyErasure, PrivacyExport, PrivacyExportOutput, PrivacyPort } from "./port.ts";
import "./privacy.css";

// Datas no fuso do negócio (primeiro acesso: o negócio novo pode não ser de Brasília); São Paulo só enquanto carrega.
const TimeZone = createContext("America/Sao_Paulo");
const CONFIRM_WORD = "ELIMINAR";
const explain = (err: unknown) => explainError(err, {
  FORBIDDEN: "Só o dono do negócio pode fazer isto.",
  QUOTA_EXCEEDED: "Você já pediu 5 exportações nas últimas 24 horas. Use um dos arquivos abaixo ou tente amanhã.",
  POLICY_REJECTED: "Isto não pode ser feito agora: confira o estado do pedido abaixo.",
});
function useWhen() {
  const tz = useContext(TimeZone);
  return (iso: string | null) => (iso ? formatDateTime(iso, tz) : "");
}
const SCOPE_LABEL = { business: "Todo o negócio", customer: "Um cliente" } as const;
const EXPORT_STATUS = { generating: "Gerando", ready: "Pronto", failed: "Falhou", expired: "Vencido" } as const;
const ERASE_STATUS = { scheduled: "Agendada", cancelled: "Cancelada", done: "Feita" } as const;

function CustomerPicker({ port, value, onChange, label }: { port: PrivacyPort; value: CustomerOption | null; onChange: (c: CustomerOption | null) => void; label: string }) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<CustomerOption[] | null>(null);
  useEffect(() => {
    let alive = true;
    port.customers(q).then((o) => alive && setOptions(o), () => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [port, q]);
  // Primeiro dia: sem cliente nenhum, nada para escolher; diz isso em vez de uma busca vazia.
  if (options !== null && options.length === 0 && !q) {
    return <p className="tn-muted">Ainda não há clientes cadastrados. Quando houver, você escolhe um aqui.</p>;
  }
  return (
    <div className="tn-privacy-picker">
      <Field label={`${label}: buscar`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou telefone" />
      <Field as="select" label={label} value={value?.id ?? ""} onChange={(e) => onChange((options ?? []).find((o) => o.id === e.target.value) ?? null)}>
        <option value="">Escolha…</option>
        {(options ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Field>
    </div>
  );
}

function Download({ out }: { out: PrivacyExportOutput }) {
  const when = useWhen();
  return (
    <StatusBanner tone="success">
      Arquivo pronto. <a href={out.download.url} download rel="noopener">Baixar o arquivo (JSON)</a>. O link vale até {when(out.download.expires_at)}; o arquivo fica disponível até {when(out.export.expires_at)}.
    </StatusBanner>
  );
}

function Exports({ port }: { port: PrivacyPort }) {
  const when = useWhen();
  const [items, setItems] = useState<PrivacyExport[] | null>(null);
  const [last, setLast] = useState<PrivacyExportOutput | null>(null);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const command = useCommand();
  const load = useCallback(() => {
    port.exports().then(setItems, () => setItems([]));
  }, [port]);
  useEffect(load, [load]);

  async function run(scope: "business" | "customer") {
    if (scope === "customer" && !customer) return;
    setBusy(scope);
    try {
      const input = scope === "business" ? { scope } : { scope, customer_id: customer!.id };
      setLast(await command(["privacy.export", input], (key) => port.exportData(input, key)));
      load();
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    } finally {
      setBusy(null);
    }
  }
  async function relink(id: string) {
    try {
      setLast(await port.exportLink(id));
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    }
  }

  return (
    <Card aria-labelledby="privacy-export-title">
      <h2 id="privacy-export-title">Baixar os dados</h2>
      <p className="tn-muted">Um arquivo com tudo o que está guardado: cadastro, clientes, agenda, caixa, mensagens. Segredos e códigos de verificação não entram.</p>
      <div className="tn-actions">
        <Button onClick={() => void run("business")} loading={busy === "business"} loadingText="Gerando…">Baixar os dados do negócio</Button>
      </div>
      <CustomerPicker port={port} value={customer} onChange={setCustomer} label="Cliente para exportar" />
      <div className="tn-actions">
        <Button variant="secondary" disabled={!customer} onClick={() => void run("customer")} loading={busy === "customer"} loadingText="Gerando…">
          Baixar os dados deste cliente
        </Button>
      </div>
      {last ? <Download out={last} /> : null}
      {items && items.length ? (
        <ul className="tn-privacy-list" aria-label="Exportações recentes">
          {items.map((e) => (
            <li key={e.id}>
              <span>{SCOPE_LABEL[e.scope]} · {when(e.created_at)} · {EXPORT_STATUS[e.status]}</span>
              {e.status === "ready" ? <Button variant="ghost" onClick={() => void relink(e.id)}>Novo link</Button> : null}
            </li>
          ))}
        </ul>
      ) : items ? <p className="tn-muted">Nenhum arquivo gerado ainda.</p> : null}
    </Card>
  );
}

function Erasures({ port }: { port: PrivacyPort }) {
  const when = useWhen();
  const [items, setItems] = useState<PrivacyErasure[] | null>(null);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [word, setWord] = useState("");
  const [bizWord, setBizWord] = useState("");
  const command = useCommand();
  const load = useCallback(() => {
    port.erasures().then(setItems, () => setItems([]));
  }, [port]);
  useEffect(load, [load]);
  const scheduled = items?.find((e) => e.scope === "business" && e.status === "scheduled") ?? null;

  async function eraseCustomer() {
    if (!customer) return;
    try {
      const input = { scope: "customer" as const, customer_id: customer.id, confirm: CONFIRM_WORD as typeof CONFIRM_WORD };
      await command(["privacy.erase", input], (key) => port.erase(input, key));
      toast(`Dados de ${customer.name} eliminados. Valores e documentos fiscais ficam, sem o nome.`);
      setCustomer(null);
      setWord("");
      load();
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    }
  }
  async function eraseBusiness() {
    try {
      const input = { scope: "business" as const, confirm: CONFIRM_WORD as typeof CONFIRM_WORD };
      const er = await command(["privacy.erase", input], (key) => port.erase(input, key));
      toast(`Eliminação agendada para ${when(er.execute_after)}. Até lá, você pode cancelar.`);
      setBizWord("");
      load();
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    }
  }
  async function cancel(id: string) {
    try {
      await command(["privacy.erase_cancel", id], (key) => port.cancelErasure(id, key));
      toast("Eliminação cancelada. Nada foi apagado.");
      load();
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    }
  }

  return (
    <>
      <Card aria-labelledby="privacy-erase-customer-title">
        <h2 id="privacy-erase-customer-title">Eliminar os dados de um cliente</h2>
        <p className="tn-muted">Use quando o próprio cliente pedir. O cadastro fica sem nome, telefone e e-mail; mensagens e pedidos pelo link somem. Valores, datas e documentos fiscais continuam, sem o nome. Não dá para desfazer.</p>
        <CustomerPicker port={port} value={customer} onChange={setCustomer} label="Cliente para eliminar" />
        <ConfirmAction triggerVariant="danger" trigger="Eliminar os dados deste cliente" disabled={!customer}
          title={customer ? `Eliminar os dados de ${customer.name}?` : "Eliminar os dados do cliente?"}
          consequence="Não dá para desfazer. Baixe os dados antes, se o cliente pediu uma cópia."
          confirmLabel="Eliminar agora" onConfirm={eraseCustomer} canConfirm={word === CONFIRM_WORD} missingHint={`Digite ${CONFIRM_WORD} para confirmar.`}>
          <Field label={`Digite ${CONFIRM_WORD}`} value={word} onChange={(e) => setWord(e.target.value.toUpperCase())} autoComplete="off" />
        </ConfirmAction>
      </Card>

      <Card aria-labelledby="privacy-erase-business-title">
        <h2 id="privacy-erase-business-title">Eliminar o negócio</h2>
        {scheduled ? (
          <>
            <StatusBanner tone="warning">Eliminação agendada para {when(scheduled.execute_after)}. Até lá, tudo continua funcionando e você pode cancelar.</StatusBanner>
            <div className="tn-actions">
              <Button variant="secondary" onClick={() => void cancel(scheduled.id)}>Cancelar a eliminação</Button>
            </div>
          </>
        ) : (
          <>
            <p className="tn-muted">Depois de 7 dias, o acesso acaba, o perfil sai do ar e os dados pessoais de clientes são eliminados. Até lá, você pode cancelar. Baixe os dados antes.</p>
            <ConfirmAction triggerVariant="danger" trigger="Pedir a eliminação do negócio" title="Eliminar o negócio daqui a 7 dias?"
              consequence="Você recebe 7 dias para mudar de ideia. Depois, o acesso acaba para todos e não dá para desfazer."
              confirmLabel="Agendar a eliminação" onConfirm={eraseBusiness} canConfirm={bizWord === CONFIRM_WORD} missingHint={`Digite ${CONFIRM_WORD} para confirmar.`}>
              <Field label={`Digite ${CONFIRM_WORD}`} value={bizWord} onChange={(e) => setBizWord(e.target.value.toUpperCase())} autoComplete="off" />
            </ConfirmAction>
          </>
        )}
        {items && items.length ? (
          <ul className="tn-privacy-list" aria-label="Pedidos de eliminação">
            {items.map((e) => (
              <li key={e.id}>{SCOPE_LABEL[e.scope]} · pedido em {when(e.requested_at)} · {ERASE_STATUS[e.status]}</li>
            ))}
          </ul>
        ) : null}
      </Card>
    </>
  );
}

export function PrivacyPage({ port }: { port: PrivacyPort }) {
  const { business, timezone } = useSession();
  const staff = business.status === "ready" && business.business.role !== "owner";
  return (
    <TimeZone.Provider value={timezone ?? "America/Sao_Paulo"}>
      <div className="tn-privacy">
        <div className="tn-page-intro">
          <PageHeader id="privacy-title" title="Seus dados" eyebrow="Privacidade" subtitle="Baixar e eliminar dados do negócio e dos clientes (LGPD)." />
          {port.kind === "demo" ? <StatusBanner tone="info">Demonstração: os arquivos e pedidos daqui valem só nesta aba, com dados de exemplo.</StatusBanner> : null}
          {staff ? <StatusBanner tone="info">Só quem é dono do negócio baixa ou elimina dados. Você pode ver o que já foi pedido.</StatusBanner> : null}
        </div>
        <Exports port={port} />
        <Erasures port={port} />
      </div>
    </TimeZone.Provider>
  );
}
