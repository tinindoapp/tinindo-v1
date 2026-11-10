// As três saídas de um atendimento concluído, com a mesma cara no Caixa, na Agenda e na Hoje (P48):
// "Recebi R$ 60,00 no Pix ▾" (▾ troca a forma antes de tocar), "Cobrar depois" e "Usar crédito do pacote" quando houver.
// Só a aparência e a escolha da forma: quem chama executa (src/lib/collect.ts) e diz qual ação está rodando.
import { useState } from "react";
import { formatCents } from "../../lib/money.ts";
import { METHOD_LABEL, METHOD_PHRASE, METHODS, type Method } from "../../lib/collect.ts";
import { plural } from "../../lib/text/plural.ts";
import { Button, Segmented } from "./index.tsx";
import "./collect.css";

const METHOD_OPTIONS = METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }));

export interface CollectCredit {
  package_id: string;
  remaining_credits: number;
}

export function CollectActions({
  idBase,
  label,
  amountCents,
  credits,
  pending,
  onReceive,
  onLater,
  onCredit,
}: {
  /** Prefixo único na tela, para ligar o ▾ à escolha da forma. */
  idBase: string;
  /** Complemento do nome acessível de cada botão ("Corte · Ana"); pode haver várias linhas na tela. Vazio: só o texto. */
  label: string;
  /** Valor calculado pelo servidor; sem valor, só o crédito do pacote aparece. */
  amountCents: number | null;
  credits: readonly CollectCredit[];
  /** "paid", "later" ou o id do pacote: o carregando aparece só no botão tocado; os outros esperam. */
  pending: string | null;
  onReceive: (method: Method) => void;
  onLater: () => void;
  onCredit: (packageId: string) => void;
}) {
  const [method, setMethod] = useState<Method>("pix");
  const [choosing, setChoosing] = useState(false);
  const busy = pending !== null;
  // Sem complemento (detalhe de um atendimento só), o nome do botão é só o texto visível.
  const suffix = (sep: string) => (label ? `${sep}${label}` : "");
  return (
    <>
      <div className="tn-actions tn-collect">
        {amountCents ? (
          <>
            <span className="tn-split">
              <Button loading={pending === "paid"} disabled={busy} onClick={() => onReceive(method)}>
                {/* Um texto só: o botão tem espaço (gap) entre filhos. */}
                <span>Recebi <span className="tn-num">{formatCents(amountCents)}</span> {METHOD_PHRASE[method]}{label ? <span className="tn-visually-hidden"> · {label}</span> : null}</span>
              </Button>
              <Button variant="secondary" aria-expanded={choosing} aria-controls={`${idBase}-methods`}
                aria-label={`Outra forma de pagamento${suffix(" · ")}`} title="Outra forma de pagamento" disabled={busy} onClick={() => setChoosing((c) => !c)}>
                <span aria-hidden="true">▾</span>
              </Button>
            </span>
            <Button variant="secondary" loading={pending === "later"} disabled={busy} onClick={onLater}>
              Cobrar depois{label ? <span className="tn-visually-hidden"> {label}</span> : null}
            </Button>
          </>
        ) : null}
        {credits.map((p) => (
          <Button key={p.package_id} variant="secondary" loading={pending === p.package_id} disabled={busy} onClick={() => onCredit(p.package_id)}>
            Usar crédito do pacote ({plural(p.remaining_credits, "restante")}){label ? <span className="tn-visually-hidden"> · {label}</span> : null}
          </Button>
        ))}
      </div>
      {choosing ? (
        <div id={`${idBase}-methods`} className="tn-collect__methods">
          <Segmented label={`Forma de pagamento${suffix(" · ")}`} hideLabel value={method} options={METHOD_OPTIONS} onChange={setMethod} />
        </div>
      ) : null}
    </>
  );
}
