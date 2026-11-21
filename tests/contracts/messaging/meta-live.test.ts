// Bloco 2 · teste com a Meta DE VERDADE (fora do CI). Só roda com WHATSAPP_LIVE=1 e as chaves no ambiente local;
// sem elas, aparece como pulado com o motivo. Ver release/WHATSAPP.md ("Teste com a Meta"):
//
//   WHATSAPP_LIVE=1 WHATSAPP_ACCESS_TOKEN=<token> WHATSAPP_APP_SECRET=<app secret> WHATSAPP_PHONE_NUMBER_ID=<id> \
//     npx vitest run --project contracts tests/contracts/messaging/meta-live.test.ts
//
// Opcional, MANDA uma mensagem de verdade (custa conversa na Meta): WHATSAPP_LIVE_TO=+55… (WhatsApp de quem testa) e
// WHATSAPP_LIVE_TEMPLATE=<modelo aprovado sem variáveis, ex.: hello_world> com WHATSAPP_LIVE_LANGUAGE (padrão en_US).
import { describe, expect, it } from "vitest";
import { createWhatsAppProvider } from "../../../supabase/functions/_shared/providers/meta.ts";

const env = process.env;
const REQUIRED = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_PHONE_NUMBER_ID"] as const;
const missing = REQUIRED.filter((k) => !env[k]?.trim());
const LIVE = env.WHATSAPP_LIVE === "1" && missing.length === 0;
const why = env.WHATSAPP_LIVE !== "1" ? "defina WHATSAPP_LIVE=1" : `faltam ${missing.join(", ")}`;
const SEND = LIVE && !!env.WHATSAPP_LIVE_TO && !!env.WHATSAPP_LIVE_TEMPLATE;

describe.skipIf(!LIVE)(`WhatsApp oficial com a Meta de verdade${LIVE ? "" : ` (pulado: ${why})`}`, () => {
  const meta = () => createWhatsAppProvider({ accessToken: env.WHATSAPP_ACCESS_TOKEN!, appSecret: env.WHATSAPP_APP_SECRET!, graphUrl: env.WHATSAPP_GRAPH_URL });

  it("a Graph reconhece o phone_number_id com o token (leitura, nada é enviado)", async () => {
    const r = await meta().lookup!(env.WHATSAPP_PHONE_NUMBER_ID!);
    expect(r.outcome, JSON.stringify(r)).toBe("found");
    if (r.outcome === "found") console.log(JSON.stringify({ numero: r.display_phone_number.replace(/\d(?=\d{4})/g, "•"), qualidade: r.quality_rating }));
  }, 20_000);

  it.skipIf(!SEND)(`envia um modelo aprovado e recebe o id da Meta${SEND ? "" : " (pulado: defina WHATSAPP_LIVE_TO e WHATSAPP_LIVE_TEMPLATE)"}`, async () => {
    const r = await meta().send({ ref: "live:1", provider: "whatsapp_cloud", external_account_id: env.WHATSAPP_PHONE_NUMBER_ID!, to: env.WHATSAPP_LIVE_TO!,
      body: "(teste)", kind: "template", template_code: null, template_params: null,
      provider_template: { name: env.WHATSAPP_LIVE_TEMPLATE!, language: env.WHATSAPP_LIVE_LANGUAGE ?? "en_US", category: "utility", params: [] } });
    expect(r.outcome, JSON.stringify(r)).toBe("sent");
  }, 20_000);
});

describe.skipIf(LIVE)("WhatsApp oficial com a Meta de verdade", () => {
  it.skip(`pulado: ${why} (só fora do CI; ver release/WHATSAPP.md)`, () => undefined);
});
