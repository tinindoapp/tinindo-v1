// Caminhos servidos pelo pacote público (src/app/public-app.tsx). /avaliar exige login e fica no app completo.
export const PUBLIC_PATH = /^\/(p\/|s\/|pagar(\/|$)|orcamento(\/|$)|avaliacoes\/|reserva(\/|$))/;

export const isPublicPath = (pathname: string) => PUBLIC_PATH.test(pathname);
