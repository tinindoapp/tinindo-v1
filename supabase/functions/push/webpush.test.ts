// @vitest-environment node
// Web Push (P34): o corpo cifrado abre só com a chave do aparelho (RFC 8291, decifrado aqui de forma independente),
// o JWT do VAPID confere com a chave pública e o resultado do envio vira sent/gone/failed.
import { describe, expect, it, vi } from "vitest";
import { b64urlDecode, b64urlEncode, encryptPayload, sendPush, vapidFromEnv, vapidJwt, type VapidKeys } from "./webpush.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}
const cat = (...p: Uint8Array[]) => Uint8Array.from(p.flatMap((x) => [...x]));
const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) => (await hmac(await hmac(salt, ikm), cat(info, new Uint8Array([1])))).slice(0, n);

/** Aparelho de mentira: par de chaves P-256 e segredo de 16 bytes, como o navegador gera ao assinar. */
async function device() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, p256dh: b64urlEncode(pub), auth: b64urlEncode(auth), pub, authBytes: auth };
}

/** Decifra como o navegador faria (RFC 8291 + 8188), escrito à parte do código de envio. */
async function decrypt(body: Uint8Array, d: Awaited<ReturnType<typeof device>>) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20]!;
  const asPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPub as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, d.kp.privateKey, 256));
  const ikm = await hkdf(d.authBytes, shared, cat(enc.encode("WebPush: info\0"), d.pub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, cipher as BufferSource));
  return { rs, idlen, text: dec.decode(plain.slice(0, plain.lastIndexOf(2))), delimiter: plain.at(-1) };
}

async function vapidKeys(): Promise<VapidKeys & { verify: CryptoKey }> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d!, subject: "mailto:avisos@tinindo.test", verify: kp.publicKey };
}

describe("corpo cifrado (aes128gcm)", () => {
  it("o aparelho certo abre e lê exatamente a mensagem; registro único com delimitador 0x02 e rs 4096", async () => {
    const d = await device();
    const msg = JSON.stringify({ title: "Reserva nova pelo link", body: "Corte · Ana · qui 06/03, 14:00", url: "/app/agenda?dia=2031-03-06" });
    const body = await encryptPayload(enc.encode(msg), d.p256dh, d.auth);
    const out = await decrypt(body, d);
    expect(out).toMatchObject({ rs: 4096, idlen: 65, text: msg, delimiter: 2 });
    // O texto não aparece em claro no corpo.
    expect(Buffer.from(body).toString("latin1")).not.toContain("Ana");
  });

  it("outro aparelho não abre (a chave é do aparelho assinado)", async () => {
    const d = await device();
    const other = await device();
    const body = await encryptPayload(enc.encode("oi"), d.p256dh, d.auth);
    await expect(decrypt(body, { ...other, authBytes: d.authBytes })).rejects.toThrow();
  });

  it("cada envio tem sal e chave novos (mesma mensagem, corpos diferentes)", async () => {
    const d = await device();
    const a = await encryptPayload(enc.encode("x"), d.p256dh, d.auth);
    const b = await encryptPayload(enc.encode("x"), d.p256dh, d.auth);
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
  });
});

describe("VAPID", () => {
  it("JWT ES256 com aud = origem do serviço, exp em 12 h e sub; assinatura confere com a chave pública", async () => {
    const v = await vapidKeys();
    const jwt = await vapidJwt(v, "https://fcm.googleapis.com/fcm/send/abc", 1_800_000_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(dec.decode(b64urlDecode(h!)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(dec.decode(b64urlDecode(c!)))).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 43_200, sub: "mailto:avisos@tinindo.test" });
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, v.verify, b64urlDecode(s!) as BufferSource, enc.encode(`${h}.${c}`))).toBe(true);
  });

  it("chaves só do segredo; formato errado = push desligado", async () => {
    const v = await vapidKeys();
    const env = (o: Record<string, string>) => ({ get: (k: string) => o[k] });
    expect(vapidFromEnv(env({ VAPID_PUBLIC_KEY: v.publicKey, VAPID_PRIVATE_KEY: v.privateKey, VAPID_SUBJECT: v.subject }))).not.toBeNull();
    expect(vapidFromEnv(env({}))).toBeNull();
    expect(vapidFromEnv(env({ VAPID_PUBLIC_KEY: "curta", VAPID_PRIVATE_KEY: v.privateKey, VAPID_SUBJECT: v.subject }))).toBeNull();
    expect(vapidFromEnv(env({ VAPID_PUBLIC_KEY: v.publicKey, VAPID_PRIVATE_KEY: v.privateKey, VAPID_SUBJECT: "eu" }))).toBeNull();
  });
});

describe("envio", () => {
  const msg = { title: "Atendimento em 30 min", body: "Corte · Ana · hoje 14:00", url: "/app", kind: "reminder_30" };

  it("cabeçalhos do Web Push e resultado por status", async () => {
    const v = await vapidKeys();
    const d = await device();
    const target = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: d.p256dh, auth: d.auth };
    for (const [status, result] of [[201, "sent"], [410, "gone"], [404, "gone"], [429, "failed"], [500, "failed"]] as const) {
      const fetch = vi.fn(async () => new Response(null, { status }));
      expect(await sendPush(target, msg, v, { fetch: fetch as typeof globalThis.fetch, nowSeconds: 1_800_000_000, ttlSeconds: 1800 })).toEqual({ result, http: status });
      const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect(init.headers).toMatchObject({ TTL: "1800", Urgency: "high", "Content-Encoding": "aes128gcm" });
      expect((init.headers as Record<string, string>).Authorization).toMatch(new RegExp(`^vapid t=[^.]+\\.[^.]+\\.[^.]+, k=${v.publicKey}$`));
    }
    const down = vi.fn(async () => { throw new TypeError("rede"); });
    expect(await sendPush(target, msg, v, { fetch: down as typeof globalThis.fetch, nowSeconds: 0 })).toEqual({ result: "failed", http: null });
    expect(await sendPush({ ...target, p256dh: "chave-estragada" }, msg, v, { fetch: down as typeof globalThis.fetch, nowSeconds: 0 })).toEqual({ result: "gone", http: null });
  });
});
