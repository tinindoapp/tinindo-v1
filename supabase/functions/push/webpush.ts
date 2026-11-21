// Web Push sem biblioteca (P34): só WebCrypto, que existe no Deno das Edge Functions e no Node dos testes.
// - Corpo cifrado no formato aes128gcm (RFC 8291 sobre a RFC 8188): só o aparelho assinado consegue ler.
// - Autorização VAPID (RFC 8292): JWT ES256 assinado com a chave privada do segredo VAPID_PRIVATE_KEY.
// As chaves nunca saem daqui nem vão para o banco; o log não leva endpoint nem conteúdo.

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

/** HKDF em dois passos (RFC 5869), saída de até 32 bytes. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

export interface VapidKeys {
  /** Ponto público P-256 não comprimido (65 bytes), em base64url. É o que o navegador recebe ao assinar. */
  publicKey: string;
  /** Escalar privado (32 bytes), em base64url. Só no segredo da função. */
  privateKey: string;
  /** Contato do remetente exigido pelos serviços de push: mailto: ou https:. */
  subject: string;
}

/** Confere o formato das chaves VAPID. Chave inválida = push desligado (sem quebrar a função). */
export function vapidFromEnv(env: { get(k: string): string | undefined }): VapidKeys | null {
  const publicKey = env.get("VAPID_PUBLIC_KEY")?.trim();
  const privateKey = env.get("VAPID_PRIVATE_KEY")?.trim();
  const subject = env.get("VAPID_SUBJECT")?.trim();
  if (!publicKey || !privateKey || !subject || !/^(mailto:|https:\/\/)/.test(subject)) return null;
  try {
    if (b64urlDecode(publicKey).length !== 65 || b64urlDecode(privateKey).length !== 32) return null;
  } catch {
    return null;
  }
  return { publicKey, privateKey, subject };
}

async function signingKey(v: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlDecode(v.publicKey);
  const jwk = { kty: "EC", crv: "P-256", d: v.privateKey, x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), ext: false };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** JWT ES256 do VAPID para a origem do serviço de push (aud), válido por 12 h. */
export async function vapidJwt(v: VapidKeys, endpoint: string, nowSeconds: number): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: nowSeconds + 12 * 3600, sub: v.subject })));
  const input = `${header}.${claims}`;
  // WebCrypto já devolve a assinatura no formato do JWT (r || s, 64 bytes).
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(v), enc.encode(input)));
  return `${input}.${b64urlEncode(sig)}`;
}

/**
 * Cifra o conteúdo para um aparelho (RFC 8291, aes128gcm, um registro só). `p256dh` e `auth` vêm da assinatura do
 * navegador. `salt` e `ephemeral` só são passados pelo teste; no envio, são novos a cada mensagem.
 */
export async function encryptPayload(
  plaintext: Uint8Array, p256dh: string, auth: string,
  opts: { salt?: Uint8Array; ephemeral?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  const as = opts.ephemeral ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  // 0x02: delimitador do último (e único) registro, sem preenchimento.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, concat(plaintext, new Uint8Array([2])) as BufferSource));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendResult = { result: "sent" | "gone" | "failed"; http: number | null };

/** Envia um aviso. 201/200/202 = entregue ao serviço; 404/410 = o aparelho saiu; o resto tenta de novo depois. */
export async function sendPush(
  target: PushTarget, message: { title: string; body: string; url: string; kind: string },
  vapid: VapidKeys, deps: { fetch: typeof fetch; nowSeconds: number; ttlSeconds?: number },
): Promise<SendResult> {
  let body: Uint8Array;
  try {
    body = await encryptPayload(enc.encode(JSON.stringify(message)), target.p256dh, target.auth);
  } catch {
    // Chave do aparelho estragada: não adianta tentar de novo.
    return { result: "gone", http: null };
  }
  let res: Response;
  try {
    res = await deps.fetch(target.endpoint, {
      method: "POST",
      headers: {
        TTL: String(deps.ttlSeconds ?? 86_400),
        Urgency: message.kind === "reminder_30" || message.kind === "booking_new" ? "high" : "normal",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        Authorization: `vapid t=${await vapidJwt(vapid, target.endpoint, deps.nowSeconds)}, k=${vapid.publicKey}`,
      },
      body: body as BodyInit,
    });
  } catch {
    return { result: "failed", http: null };
  }
  if (res.status === 404 || res.status === 410) return { result: "gone", http: res.status };
  if (res.status >= 200 && res.status < 300) return { result: "sent", http: res.status };
  return { result: "failed", http: res.status };
}
