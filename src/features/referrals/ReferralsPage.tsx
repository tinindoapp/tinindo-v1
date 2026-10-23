// Indicações (P21): o dono vê os convites de colega (gerados no Perfil, P09), a adesão de cada um medida pelo backend
// e os benefícios. O benefício é crédito de franquia do assistente no mês; nunca avaliação, nota ou posição.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, StatusBanner } from "../../components/ui/index.tsx";
import { activationLabel, explain, formatDate, formatMonth, STATE } from "./labels.ts";
import type { ReferralDashboard, ReferralReward, ReferralsPort } from "./port.ts";

export function ReferralsPage({ port }: { port: ReferralsPort }) {
  const [data, setData] = useState<ReferralDashboard | null>(null);
  const [rewards, setRewards] = useState<ReferralReward[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([port.dashboard(), port.rewards()]).then(([d, r]) => {
      if (!alive) return;
      setData(d);
      setRewards(r);
      setError(null);
    }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const rules = data?.rules;

  return (
    <div className="tn-ref">
      <Card aria-labelledby="ref-title">
        <h1 id="ref-title">Indicações</h1>
        <p className="tn-ref-muted">
          Convide colegas pelo seu <Link to="/app/perfil">Perfil</Link>: o link é pessoal e quem envia é você. Quando o negócio indicado passa a usar a Tinindo de verdade, você ganha crédito de perguntas do assistente no mês.
        </p>
        <StatusBanner tone="info">
          <strong>O benefício não é avaliação.</strong> Não existe nota, ranking nem posição por indicar. A Tinindo mede o uso real do negócio indicado
          {rules ? ` (${rules.min_customers} clientes e ${rules.min_completed_bookings} atendimentos concluídos em ${rules.window_days} dias)` : ""} e concede
          {rules ? ` ${rules.reward_questions} perguntas` : " o crédito"} uma única vez por negócio indicado, até {rules?.monthly_cap ?? 10} por mês. Convite aceito pelo seu próprio negócio ou por quem já aderiu não rende.
        </StatusBanner>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Dados de exemplo; nada é concedido de verdade.</StatusBanner> : null}
        {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
        {notice ? <StatusBanner tone="success">{notice}</StatusBanner> : null}
        {data ? (
          <dl className="tn-ref-summary" aria-label="Resumo">
            <div><dt>Convites</dt><dd>{data.summary.invites}</dd></div>
            <div><dt>Aceitos</dt><dd>{data.summary.claimed}</dd></div>
            <div><dt>Benefícios</dt><dd>{data.summary.rewarded}</dd></div>
            <div><dt>Crédito no mês</dt><dd>{data.summary.bonus_this_month ?? 0} perguntas{data.summary.agent_limit != null ? ` (franquia ${data.summary.agent_limit} + ${data.summary.bonus_this_month ?? 0}, usadas ${data.summary.agent_used ?? 0})` : ""}</dd></div>
          </dl>
        ) : null}
        {port.simulateActivity ? (
          <div className="tn-ref-actions">
            <Button variant="secondary" onClick={() => void port.simulateActivity!().then((r) => { setNotice(`Avaliação (simulação): ${r.rewarded} benefício(s) concedido(s).`); setNonce((x) => x + 1); })}>Simular uso real do indicado</Button>
          </div>
        ) : null}
      </Card>

      <Card aria-labelledby="ref-invites-title">
        <h2 id="ref-invites-title">Convites de colega</h2>
        {data && data.invites.length === 0 ? <p className="tn-ref-muted">Nenhum convite ainda. Gere um link no Perfil.</p> : null}
        <ul className="tn-ref-list" aria-label="Convites">
          {data?.invites.map((i) => (
            <li key={i.referral_id} className="tn-ref-item">
              <h3>{i.invitee_name}</h3>
              <p><strong>{STATE[i.state]}</strong> · gerado em {formatDate(i.created_at)}{i.claimed_at ? ` · aceito em ${formatDate(i.claimed_at)}` : ` · vale até ${formatDate(i.expires_at)}`}</p>
              <p className="tn-ref-muted">{activationLabel(i)}{i.reward ? ` · ${i.reward.amount} perguntas em ${formatMonth(i.reward.period_start)}` : ""}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-labelledby="ref-rewards-title">
        <h2 id="ref-rewards-title">Benefícios</h2>
        {rewards && rewards.length === 0 ? <p className="tn-ref-muted">Nenhum benefício ainda.</p> : null}
        <ul className="tn-ref-list" aria-label="Benefícios">
          {rewards?.map((r) => <li key={r.id}>{r.amount} perguntas do assistente em {formatMonth(r.period_start)} · por {r.invitee_name ?? "colega"} · {formatDate(r.created_at)}</li>)}
        </ul>
      </Card>
    </div>
  );
}
