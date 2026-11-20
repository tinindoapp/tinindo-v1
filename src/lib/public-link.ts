// Link público com token (orçamento, oferta de vaga, pagamento, convite): /rota#t=<token>.
// O token vem no fragmento, que o navegador não manda ao servidor nem ao histórico de referência. A página tira
// o token da URL assim que abre, guarda só na sessão da aba (para sobreviver a um recarregar) e o envia por POST.
const TOKEN = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/;

/** Token de 43 caracteres do fragmento da URL, ou null. Não altera a URL. */
export function readLinkToken(hash: string): string | null {
  return TOKEN.exec(hash)?.[1] ?? null;
}

/**
 * Lê o token do fragmento, apaga-o da barra de endereço e guarda na sessão da aba sob `storageKey`.
 * Sem token na URL, devolve o que estava guardado (página recarregada). Sem nenhum dos dois, null.
 */
export function takeLinkToken(storageKey: string): string | null {
  const token = readLinkToken(window.location.hash);
  if (token) {
    try {
      sessionStorage.setItem(storageKey, token);
    } catch {
      /* sem armazenamento: vale enquanto a página estiver aberta */
    }
    window.history.replaceState(window.history.state, "", window.location.pathname);
    return token;
  }
  try {
    return sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}
