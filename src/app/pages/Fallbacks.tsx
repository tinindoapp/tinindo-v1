import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Card } from "../../components/ui/index.tsx";

export function NotFound() {
  return (
    <main className="tn-auth">
      <Card aria-labelledby="nf-title">
        <h1 id="nf-title">Página não encontrada</h1>
        <p>O endereço pode ter mudado.</p>
        <Link to="/app">Voltar ao início</Link>
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
        <Link to="/app">Voltar ao início</Link>
      </Card>
    </main>
  );
}
