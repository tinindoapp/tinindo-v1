import { isRouteErrorResponse, useRouteError } from "react-router";
import { Card, LinkButton } from "../../components/ui/index.tsx";

export function NotFound() {
  return (
    <main className="tn-auth">
      <Card aria-labelledby="nf-title">
        <h1 id="nf-title">Página não encontrada</h1>
        <p className="tn-muted">O endereço pode ter mudado.</p>
        <LinkButton to="/app" variant="secondary">Voltar ao início</LinkButton>
      </Card>
    </main>
  );
}

/** Erro global de rota: mensagem acionável, sem stack nem dados internos. */
export function RouteError() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  return (
    <main className="tn-auth">
      <Card aria-labelledby="err-title">
        <h1 id="err-title">Algo deu errado</h1>
        <p>{status === 404 ? "Página não encontrada." : "Recarregue a página. Se continuar, fale com o suporte."}</p>
        <LinkButton to="/app" variant="secondary">Voltar ao início</LinkButton>
      </Card>
    </main>
  );
}
