// Conta › Mais recursos (P51, decisão D1 a): os seis módulos "por ativação". O dono liga quando precisar e desliga
// quando quiser; desligar só tira do menu, nenhum dado é apagado. O estado vem do escopo da sessão (servidor:
// `setup.scope` e `setup.module_set`, idempotente e auditado). Módulo guardado não aparece aqui nem em lugar nenhum.
import { useState } from "react";
import { Link } from "react-router";
import type { ModuleId, Profession } from "@contracts";
import { Button, Card, PageHeader, StatusBanner, toast } from "../../components/ui/index.tsx";
import { type ScopeModule, useScope } from "../../app/scope.tsx";
import { useIdempotencyKey } from "../../lib/idempotency.ts";
import { messageFor } from "./errors.ts";

/** Uma frase do que cada recurso faz. Sem promessa: só o que a tela entrega hoje. */
const WHAT: Partial<Record<ModuleId, string>> = {
  recurrence: "Plano mensal para o cliente fixo: a cada mês abre o pacote de sessões e a cobrança no Caixa.",
  sales: "Orçamento com itens e validade, que o cliente aceita por um link que você manda.",
  "growth-advice": "Metas do mês e sugestões calculadas com os seus números, com uma delas na Hoje.",
  analytics: "Indicadores do negócio com a conta à vista: ocupação, faltas, retorno e recebido.",
  referrals: "Acompanha os colegas que você convidou e o benefício de cada indicação.",
  "service-ops": "Mostra o seu plano e os serviços assistidos da equipe Tinindo. No piloto nada é cobrado.",
};

/**
 * O que muda ao ligar, no primeiro dia: onde aparece e por onde começar. A tela nova abre vazia; a frase diz o primeiro
 * passo, para a pessoa não ligar sem saber o que vem depois.
 */
const ON_START: Partial<Record<ModuleId, string>> = {
  recurrence: "Comece criando um plano (sessões por mês e preço) e depois escolha o aluno.",
  sales: "Comece com um orçamento para um cliente já cadastrado.",
  "growth-advice": "Com poucos atendimentos, as sugestões aparecem depois da primeira semana.",
  analytics: "Os números enchem conforme você registra atendimentos e recebimentos.",
  referrals: "Mostra só quem você convidou; sem convite, fica vazio.",
  "service-ops": "Fica para consulta. Nada muda no que você já usa.",
};

/** Para quem o recurso costuma servir primeiro (só destaque; todo negócio pode ligar qualquer um). */
const SUGGESTED: Partial<Record<Profession, ModuleId>> = { personal_trainer: "recurrence" };

function Feature({ module, suggested }: { module: ScopeModule; suggested: boolean }) {
  const scope = useScope();
  const { keyFor, reset } = useIdempotencyKey();
  const [busy, setBusy] = useState(false);
  const titleId = `feature-${module.id}`;

  async function toggle() {
    const enabled = !module.enabled;
    setBusy(true);
    try {
      // Mesma chave enquanto o pedido é o mesmo: repetir depois de uma falha de rede não liga duas vezes.
      await scope.setModule(module.id, enabled, keyFor({ module: module.id, enabled }));
      reset();
      toast(enabled ? { message: `${module.label} ligado. Já aparece no menu.` } : { tone: "info", message: `${module.label} desligado. O que você registrou continua guardado.` });
    } catch (err) {
      toast({ tone: "danger", message: messageFor(err, "business") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="tn-id-feature" data-on={module.enabled || undefined}>
      <div className="tn-id-feature__text">
        <h2 id={titleId} className="tn-id-feature__title">
          {module.label}{" "}
          <span className="tn-id-feature__state">{module.enabled ? "Ligado" : "Desligado"}</span>
        </h2>
        <p>{WHAT[module.id]}</p>
        {!module.enabled && ON_START[module.id] ? <p className="tn-muted">Ao ligar, {module.label} entra no menu. {ON_START[module.id]}</p> : null}
        {suggested && !module.enabled ? <p className="tn-muted">Costuma ajudar quem atende alunos fixos.</p> : null}
      </div>
      <div className="tn-actions">
        {scope.canManage ? (
          <Button variant={module.enabled ? "secondary" : "primary"} loading={busy} loadingText={module.enabled ? "Desligando…" : "Ligando…"}
            aria-describedby={titleId} onClick={() => void toggle()}>
            {module.enabled ? "Desligar" : "Ligar"}{" "}
            <span className="tn-visually-hidden">{module.label}</span>
          </Button>
        ) : null}
        {module.enabled ? <Link to={module.to}>Abrir{" "}<span className="tn-visually-hidden">{module.label}</span></Link> : null}
      </div>
    </li>
  );
}

export function MoreFeaturesPage() {
  const scope = useScope();
  const suggested = scope.profession ? SUGGESTED[scope.profession] : undefined;
  const order = Object.keys(WHAT);
  const features = scope.catalog
    .filter((m) => m.level === "activation")
    // O recurso indicado para a profissão vem primeiro; o resto, na ordem da lista acima (do mais usado ao mais raro).
    .sort((a, b) => Number(b.id === suggested) - Number(a.id === suggested) || order.indexOf(a.id) - order.indexOf(b.id));

  return (
    <div className="tn-stack">
      <div className="tn-page-intro">
        <PageHeader id="features-title" title="Mais recursos" eyebrow="Conta" subtitle="Ligue só o que for usar. Desligar tira do menu e não apaga nada." />
        <p><Link to="/app/conta">Voltar para a Conta</Link></p>
      </div>
      {scope.status === "loading" ? <p role="status" className="tn-muted">Carregando os recursos…</p> : null}
      {scope.status === "error" ? (
        <>
          <StatusBanner tone="danger">Não foi possível carregar os recursos do seu negócio.</StatusBanner>
          <div className="tn-actions">
            <Button variant="secondary" onClick={scope.reload}>Tentar de novo</Button>
          </div>
        </>
      ) : null}
      {scope.status === "ready" ? (
        <>
          {!scope.canManage ? <StatusBanner tone="info">Só quem é dono do negócio liga e desliga recursos.</StatusBanner> : null}
          {features.length === 0 ? (
            <StatusBanner tone="info">Nenhum recurso opcional disponível para o seu negócio agora.</StatusBanner>
          ) : (
            <Card aria-labelledby="features-title">
              <ul className="tn-id-features" aria-label="Recursos opcionais">
                {features.map((m) => <Feature key={m.id} module={m} suggested={m.id === suggested} />)}
              </ul>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
