import { describe, expect, it, vi } from "vitest";
import { PHOTO_MAX_INPUT_BYTES, PHOTO_TARGET_BYTES, PhotoError, type PhotoDeps, processPhoto, squareCrop } from "./photo.ts";

const file = (size: number, type = "image/jpeg") => new File([new Uint8Array(size)], "foto.jpg", { type });
const blob = (size: number, type: string) => new Blob([new Uint8Array(size)], { type });

function deps(sizes: Record<string, number[]>, opts: { webp?: boolean; width?: number; height?: number } = {}) {
  const close = vi.fn();
  const encode = vi.fn<PhotoDeps["encode"]>(async (_image, _crop, type) => {
    // Sem WebP, o canvas devolve PNG (comportamento dos navegadores).
    if (type === "image/webp" && opts.webp === false) return blob(10, "image/png");
    const next = sizes[type]!.shift()!;
    return blob(next, type);
  });
  const d: PhotoDeps = {
    decode: vi.fn(async () => ({ width: opts.width ?? 1600, height: opts.height ?? 1200, source: {} as CanvasImageSource, close })),
    encode,
  };
  return { d, encode, close };
}

describe("foto do perfil · preparo no navegador", () => {
  it("recorte quadrado ao centro", () => {
    expect(squareCrop(1600, 1200)).toEqual({ sx: 200, sy: 0, side: 1200 });
    expect(squareCrop(900, 1600)).toEqual({ sx: 0, sy: 350, side: 900 });
    expect(squareCrop(800, 800)).toEqual({ sx: 0, sy: 0, side: 800 });
  });

  it("WebP com qualidade 0,82 quando já cabe em 300 KB; libera a imagem decodificada", async () => {
    const { d, encode, close } = deps({ "image/webp": [120_000] });
    const out = await processPhoto(file(3_000_000), d);
    expect(out).toMatchObject({ type: "image/webp", ext: "webp" });
    expect(out.blob.size).toBe(120_000);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(expect.anything(), { sx: 200, sy: 0, side: 1200 }, "image/webp", 0.82);
    expect(close).toHaveBeenCalled();
  });

  it("acima de 300 KB, baixa a qualidade até caber", async () => {
    const { d, encode } = deps({ "image/webp": [500_000, 380_000, PHOTO_TARGET_BYTES] });
    const out = await processPhoto(file(5_000_000), d);
    expect(out.blob.size).toBe(PHOTO_TARGET_BYTES);
    expect(encode.mock.calls.map((c) => c[3])).toEqual([0.82, 0.72, 0.62]);
  });

  it("navegador sem WebP: JPEG", async () => {
    const { d } = deps({ "image/jpeg": [200_000] }, { webp: false });
    expect(await processPhoto(file(1_000_000), d)).toMatchObject({ type: "image/jpeg", ext: "jpg" });
  });

  it("recusa o que não é imagem, arquivo acima de 10 MB e imagem que não abre", async () => {
    const { d } = deps({ "image/webp": [1] });
    await expect(processPhoto(file(10, "application/pdf"), d)).rejects.toThrow("Escolha uma imagem");
    await expect(processPhoto(file(PHOTO_MAX_INPUT_BYTES + 1), d)).rejects.toThrow("passa de 10 MB");
    const broken: PhotoDeps = { decode: async () => { throw new Error("x"); }, encode: d.encode };
    await expect(processPhoto(file(100), broken)).rejects.toBeInstanceOf(PhotoError);
  });
});
