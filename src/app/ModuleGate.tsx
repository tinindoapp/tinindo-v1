// Porta de cada módulo (P51): a rota continua registrada, mas só abre se o módulo aparece para o negócio. Quem chega
// por endereço direto num módulo guardado ou desligado vê por quê e tem para onde ir; nunca uma tela vazia.
import { Outlet } from "react-router";
import { Button, Card, LinkButton } from "../components/ui/index.tsx";
import type { ModuleDefinition } from "./module-types.ts";
import { useScope } from "./scope.tsx";

export const MORE_FEATURES_PATH = "/app/conta/recursos";

export function ModuleGate({ module }: { module: ModuleDefinition }) {
  const scope = useScope();
  if (scope.isVisible(module.id)) return <Outlet />;
  if (scope.status === "loading") {
    return (
      <p className="tn-shell-loading" role="status">
        Carregando…
      </p>
    );
  }
  if (scope.status === "error") {
    return (
      <Card aria-labelledby="gate-title">
        <h1 id="gate-title">Não foi possível abrir {module.navLabel}</h1>
        <p>Não conseguimos conferir os recursos do seu negócio agora. Sua agenda, seus clientes e o caixa continuam no lugar.</p>
        <div className="tn-actions">
          <Button onClick={scope.reload}>Tentar de novo</Button>
          <LinkButton to="/app" variant="secondary">Voltar para Hoje</LinkButton>
        </div>
      </Card>
    );
  }
  if (scope.levelOf(module.id) === "activation") {
    return (
      <Card aria-labelledby="gate-title">
        <h1 id="gate-title">{module.navLabel} está desligado</h1>
        <p>
          {scope.canManage
            ? "Este recurso é opcional. Você liga quando precisar, em Conta › Mais recursos, e desliga quando quiser."
            : "Este recurso é opcional e está desligado neste negócio. Só quem é dono do negócio pode ligar."}
        </p>
        <div className="tn-actions">
          {scope.canManage ? <LinkButton to={MORE_FEATURES_PATH}>Abrir Mais recursos</LinkButton> : null}
          <LinkButton to="/app" variant="secondary">Voltar para Hoje</LinkButton>
        </div>
      </Card>
    );
  }
  return (
    <Card aria-labelledby="gate-title">
      <h1 id="gate-title">Não disponível no piloto</h1>
      <p>
        {module.navLabel} não faz parte do piloto. O que você usa no dia a dia continua em Hoje, Agenda, Clientes, Retorno e
        Dinheiro.
      </p>
      <div className="tn-actions">
        <LinkButton to="/app">Voltar para Hoje</LinkButton>
        {scope.canManage ? <LinkButton to={MORE_FEATURES_PATH} variant="secondary">Ver Mais recursos</LinkButton> : null}
      </div>
    </Card>
  );
}
