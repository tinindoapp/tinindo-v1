// Commit publicado em toda resposta das funções (recado #135): o smoke da homologação confere que as 29 funções são do
// SHA que o release publicou, não só o frontend. O release grava o segredo BUILD_SHA no deploy das funções.
// O SHA já é público (o frontend o mostra em /version.json); nada além dele sai no cabeçalho.
// P58: o mesmo embrulho registra em public.ops_errors toda resposta 5xx e toda exceção (capture.ts).
import { type CapturedError, captureException, captureResponse, envRecorder, inBackground, type Recorder } from "./capture.ts";
import { fail, requestIdFrom } from "./respond.ts";

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
 * P58: resposta 5xx é registrada; exceção sem resposta vira 500 INTERNAL_ERROR (envelope v1, com request_id) e também é
 * registrada. Sem gravador (OPS_CAPTURE=off, ou fora do Supabase), só o cabeçalho.
 */
export function withBuild(
  handler: (req: Request) => Response | Promise<Response>,
  sha: string | null = envSha(),
  record: Recorder | null = envRecorder(),
): (req: Request) => Promise<Response> {
  // O gravador nunca derruba a resposta, nem quando ele mesmo falha.
  const save = (row: CapturedError) => inBackground(record!(row).catch(() => undefined));
  return async (req) => {
    let res: Response;
    try {
      res = await handler(req);
      if (record && res.status >= 500) {
        const row = await captureResponse(req, res, sha);
        if (row) await save(row);
      }
    } catch {
      const requestId = requestIdFrom(req);
      console.error(JSON.stringify({ level: "error", request_id: requestId, status: 500, kind: "exception" }));
      res = fail("INTERNAL_ERROR", requestId);
      if (record) await save(captureException(req, sha, requestId));
    }
    if (!sha) return res;
    const headers = new Headers(res.headers);
    headers.set(BUILD_HEADER, sha);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
