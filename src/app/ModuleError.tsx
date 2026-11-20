// Fronteira de erro por módulo (P53, R8 do doc 15). Antes havia uma só, na raiz: uma exceção em qualquer tela trocava o
// app inteiro por "Algo deu errado", sem o menu. Agora o erro de um módulo fica no lugar da tela dele, dentro do shell:
// o menu, a Hoje e os outros módulos continuam usáveis. Sem stack nem dados internos na tela.
import { isRouteErrorResponse, useRouteError } from "react-router";
import { Button, Card, LinkButton } from "../components/ui/index.tsx";
import type { ModuleDefinition } from "./module-types.ts";

/** Falha ao baixar o pedaço da tela: quase sempre versão nova publicada enquanto a aba estava aberta, ou rede. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i.test(message);
}

export function ModuleError({ module }: { module: Pick<ModuleDefinition, "navLabel"> }) {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const chunk = !notFound && isChunkLoadError(error);
  return (
    <Card aria-labelledby="module-error-title">
      <h1 id="module-error-title">{notFound ? "Página não encontrada" : `Não foi possível abrir ${module.navLabel}`}</h1>
      <p>
        {notFound
          ? "O endereço pode ter mudado."
          : chunk
            ? "Saiu uma versão nova do Tinindo ou a conexão caiu. Recarregue a página para continuar."
            : "Algo deu errado nesta tela. Sua agenda, seus clientes e o caixa continuam no lugar."}
      </p>
      <div className="tn-actions">
        {notFound ? null : <Button onClick={() => window.location.reload()}>Recarregar a página</Button>}
        <LinkButton to="/app" variant="secondary">Voltar para Hoje</LinkButton>
      </div>
    </Card>
  );
}

/** Enquanto o app abre pela primeira vez numa rota carregada sob demanda. */
export function RouteLoading() {
  return (
    <p className="tn-shell-loading" role="status">
      Carregando…
    </p>
  );
}
