// Commit publicado em toda resposta das funções (recado #135): o smoke da homologação confere que as 29 funções são do
// SHA que o release publicou, não só o frontend. O release grava o segredo BUILD_SHA no deploy das funções.
// O SHA já é público (o frontend o mostra em /version.json); nada além dele sai no cabeçalho.
export const BUILD_HEADER = "X-Tinindo-Build";

/** Só hexadecimal de 7 a 40 caracteres: valor estranho no segredo não vira cabeçalho. */
const SHA = /^[0-9a-f]{7,40}$/;

export function buildSha(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return SHA.test(v) ? v : null;
}

function envSha(): string | null {
  try {
    return buildSha((globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get("BUILD_SHA"));
  } catch {
    return null; // sem permissão de ler o ambiente: segue sem o cabeçalho
  }
}

/**
 * Embrulha o handler da função: toda resposta (inclusive OPTIONS, erro e resposta montada à mão) ganha
 * `X-Tinindo-Build: <sha>`. Sem BUILD_SHA válido, a resposta sai como veio.
 */
export function withBuild(
  handler: (req: Request) => Response | Promise<Response>,
  sha: string | null = envSha(),
): (req: Request) => Promise<Response> {
  return async (req) => {
    const res = await handler(req);
    if (!sha) return res;
    const headers = new Headers(res.headers);
    headers.set(BUILD_HEADER, sha);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
